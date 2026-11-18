/**
 * Comment → DM ("Send private reply") on Meta's official APIs.
 *
 * Flow: Meta webhook (or the per-minute poll while webhooks are not yet approved) → one row per
 * comment in `PrivateReply` (unique on account + comment id = exactly-once) → job `send_private_reply`
 * → Meta Private Replies API (POST /{id}/messages, recipient.comment_id) → outcome on the row and in
 * the audit log (Activity).
 *
 * Truthfulness: a reply is `sent` only when Meta returns a message id. A timeout or a cut connection
 * is `uncertain` and is never re-sent automatically (Meta allows one private reply per comment; a
 * blind retry could double-message or fail noisily) — the owner checks the inbox and retries by hand.
 */
import { randomBytes } from "node:crypto";
import { prisma, type SocialAccount } from "@sm/db";
import { verifyMetaSignature } from "@sm/security";
import { ProviderError } from "@sm/integrations";
import { audit, notify } from "./audit";
import { adapterFor, buildAccountContext } from "./connections";
import { enqueue, PermanentJobError, RetryableJobError } from "./queue";
import { getProviderAppValue, getSecretSetting, setSecretSetting } from "./settings";

export const PRIVATE_REPLY_TRIGGER = "comment_keyword";
export const PRIVATE_REPLY_ACTION = "send_private_reply";
/** Meta accepts a private reply only within 7 days of the comment. */
const REPLY_WINDOW_MS = 7 * 24 * 3600_000;

export interface PrivateReplyRuleInput {
  socialAccountId: string;
  externalPostId: string;
  postLabel?: string | null;
  postUrl?: string | null;
  keyword: string;
  replyText: string;
  enabled: boolean;
  name?: string | null;
}

export interface RuleView {
  id: string;
  brandId: string;
  name: string;
  enabled: boolean;
  socialAccountId: string;
  externalPostId: string;
  postLabel: string | null;
  postUrl: string | null;
  keyword: string;
  replyText: string;
  createdAt: Date;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive whole-word match ("CATALOGO", "catalogo!", "il Catalogo?" match; "catalogone" does not). */
export function keywordMatches(text: string | null | undefined, keyword: string): boolean {
  const kw = keyword.trim();
  if (!kw || !text) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(kw)}(?=$|[^\\p{L}\\p{N}_])`, "iu");
  return re.test(text.normalize("NFC"));
}

function ruleView(r: { id: string; brandId: string; name: string; enabled: boolean; trigger: unknown; actions: unknown; createdAt: Date }): RuleView | null {
  const t = r.trigger as { type?: string; filters?: Record<string, unknown> };
  const a = (r.actions as Array<{ type?: string; params?: Record<string, unknown> }>) ?? [];
  const act = a.find((x) => x.type === PRIVATE_REPLY_ACTION);
  if (t?.type !== PRIVATE_REPLY_TRIGGER || !act) return null;
  const f = t.filters ?? {};
  if (typeof f.socialAccountId !== "string" || typeof f.externalPostId !== "string" || typeof f.keyword !== "string") return null;
  return { id: r.id, brandId: r.brandId, name: r.name, enabled: r.enabled, socialAccountId: f.socialAccountId, externalPostId: f.externalPostId, postLabel: (f.postLabel as string | undefined) ?? null, postUrl: (f.postUrl as string | undefined) ?? null, keyword: f.keyword, replyText: String(act.params?.text ?? ""), createdAt: r.createdAt };
}

export async function listPrivateReplyRules(brandId: string): Promise<RuleView[]> {
  const rows = await prisma.automationRule.findMany({ where: { brandId }, orderBy: { createdAt: "desc" } });
  return rows.map(ruleView).filter((x): x is RuleView => Boolean(x));
}

export async function createPrivateReplyRule(userId: string, brandId: string, input: PrivateReplyRuleInput): Promise<RuleView> {
  const account = await prisma.socialAccount.findFirst({ where: { id: input.socialAccountId, brandId, brand: { ownerId: userId } } });
  if (!account) throw new Error("Account not found for this brand.");
  if (account.provider !== "instagram" && account.provider !== "facebook") throw new Error("Comment → DM works on Instagram and Facebook accounts.");
  if (account.backend !== "native") throw new Error("Comment → DM uses Meta's own APIs; connect the account natively (not through the gateway).");
  const keyword = input.keyword.trim();
  if (!keyword) throw new Error("Keyword is required.");
  const rule = await prisma.automationRule.create({
    data: {
      brandId,
      name: input.name?.trim() || `${keyword} → DM · ${input.postLabel ?? input.externalPostId}`.slice(0, 120),
      trigger: { type: PRIVATE_REPLY_TRIGGER, filters: { socialAccountId: account.id, provider: account.provider, externalPostId: input.externalPostId, postLabel: input.postLabel ?? null, postUrl: input.postUrl ?? null, keyword } },
      actions: [{ type: PRIVATE_REPLY_ACTION, params: { text: input.replyText } }],
      enabled: input.enabled,
      cooldownMinutes: 1,
      perContactCap: 1,
    },
  });
  await audit({ actorUserId: userId, brandId, action: "automation.private_reply.create", targetType: "rule", targetId: rule.id, details: { account: account.displayName, post: input.externalPostId, keyword } });
  await ensurePollingArmed();
  return ruleView(rule)!;
}

export async function updatePrivateReplyRule(userId: string, ruleId: string, patch: Partial<Pick<PrivateReplyRuleInput, "enabled" | "keyword" | "replyText">>): Promise<RuleView> {
  const rule = await prisma.automationRule.findFirst({ where: { id: ruleId, brand: { ownerId: userId } } });
  const view = rule ? ruleView(rule) : null;
  if (!rule || !view) throw new Error("Rule not found.");
  const trigger = rule.trigger as { type: string; filters: Record<string, unknown> };
  if (patch.keyword !== undefined) trigger.filters.keyword = patch.keyword.trim();
  const actions = [{ type: PRIVATE_REPLY_ACTION, params: { text: patch.replyText ?? view.replyText } }];
  const updated = await prisma.automationRule.update({ where: { id: ruleId }, data: { enabled: patch.enabled ?? rule.enabled, trigger: trigger as object, actions: actions as object } });
  await audit({ actorUserId: userId, brandId: rule.brandId, action: patch.enabled === false ? "automation.private_reply.disable" : "automation.private_reply.update", targetType: "rule", targetId: ruleId });
  if (updated.enabled) await ensurePollingArmed();
  return ruleView(updated)!;
}

export async function deletePrivateReplyRule(userId: string, ruleId: string): Promise<void> {
  const rule = await prisma.automationRule.findFirst({ where: { id: ruleId, brand: { ownerId: userId } } });
  if (!rule) throw new Error("Rule not found.");
  await prisma.automationRule.delete({ where: { id: ruleId } });
  await audit({ actorUserId: userId, brandId: rule.brandId, action: "automation.private_reply.delete", targetType: "rule", targetId: ruleId });
}

// ---------------------------------------------------------------------------
// Webhook verify token (generated once, kept encrypted; shown on the Meta setup page)
// ---------------------------------------------------------------------------

export async function getOrCreateWebhookVerifyToken(): Promise<string> {
  const existing = (await getProviderAppValue("META_WEBHOOK_VERIFY_TOKEN")) ?? (await getSecretSetting("app.META_WEBHOOK_VERIFY_TOKEN").catch(() => null));
  if (existing) return existing;
  const token = randomBytes(24).toString("base64url");
  await setSecretSetting("app.META_WEBHOOK_VERIFY_TOKEN", token);
  return token;
}

// ---------------------------------------------------------------------------
// Incoming comments (webhook + poll share this path)
// ---------------------------------------------------------------------------

export interface IncomingComment {
  provider: "instagram" | "facebook";
  /** Instagram user id (instagram object) or Page id (page object) as sent by Meta. */
  subjectExternalId: string;
  externalPostId: string;
  externalCommentId: string;
  text: string | null;
  authorId?: string | null;
  authorName?: string | null;
  parentExternalId?: string | null;
  createdAt?: Date | null;
  source: "webhook" | "poll" | "manual";
}

/** Signature check + parse. Returns the comments found in a Meta webhook delivery (instagram or page object). */
export async function parseMetaWebhook(input: { rawBody: string; signature: string | null | undefined }): Promise<{ ok: true; object: string; comments: IncomingComment[]; entryIds: string[] } | { ok: false; reason: string; status: number }> {
  const secrets = [await getProviderAppValue("META_APP_SECRET"), await getProviderAppValue("INSTAGRAM_APP_SECRET")].filter((x): x is string => Boolean(x));
  if (secrets.length === 0) return { ok: false, reason: "Meta app secret is not configured (Connections → Meta app setup).", status: 503 };
  if (!secrets.some((s) => verifyMetaSignature(s, input.rawBody, input.signature))) return { ok: false, reason: "bad signature", status: 401 };
  let payload: { object?: string; entry?: Array<{ id: string; time?: number; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> };
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, reason: "invalid json", status: 400 };
  }
  const comments: IncomingComment[] = [];
  const entryIds: string[] = [];
  for (const entry of payload.entry ?? []) {
    entryIds.push(entry.id);
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      if (payload.object === "instagram" && ch.field === "comments") {
        const id = typeof v.id === "string" ? v.id : null;
        const media = v.media as { id?: string } | undefined;
        if (!id || !media?.id) continue;
        const from = v.from as { id?: string; username?: string } | undefined;
        comments.push({ provider: "instagram", subjectExternalId: entry.id, externalPostId: media.id, externalCommentId: id, text: typeof v.text === "string" ? v.text : null, authorId: from?.id ?? null, authorName: from?.username ?? null, parentExternalId: typeof v.parent_id === "string" ? v.parent_id : null, createdAt: entry.time ? new Date(entry.time * 1000) : new Date(), source: "webhook" });
      } else if (payload.object === "page" && ch.field === "feed" && v.item === "comment" && v.verb === "add") {
        const id = typeof v.comment_id === "string" ? v.comment_id : null;
        const postId = typeof v.post_id === "string" ? v.post_id : null;
        if (!id || !postId) continue;
        const from = v.from as { id?: string; name?: string } | undefined;
        const created = typeof v.created_time === "number" ? new Date(v.created_time * 1000) : entry.time ? new Date(entry.time * 1000) : new Date();
        comments.push({ provider: "facebook", subjectExternalId: entry.id, externalPostId: postId, externalCommentId: id, text: typeof v.message === "string" ? v.message : null, authorId: from?.id ?? null, authorName: from?.name ?? null, parentExternalId: typeof v.parent_id === "string" && v.parent_id !== postId ? v.parent_id : null, createdAt: created, source: "webhook" });
      }
    }
  }
  return { ok: true, object: payload.object ?? "", comments, entryIds };
}

/** Stores a Meta delivery (deduped on the comment ids it carries) and routes each comment. */
export async function ingestMetaWebhook(input: { rawBody: string; signature: string | null | undefined }): Promise<{ status: "ok" | "rejected"; reason?: string; httpStatus: number; handled: number; duplicates: number }> {
  const parsed = await parseMetaWebhook(input);
  if (!parsed.ok) return { status: "rejected", reason: parsed.reason, httpStatus: parsed.status, handled: 0, duplicates: 0 };
  let handled = 0;
  let duplicates = 0;
  for (const c of parsed.comments) {
    // One WebhookEvent per comment: a redelivery of the same comment is a duplicate before any logic runs.
    try {
      await prisma.webhookEvent.create({ data: { provider: "meta", providerEventId: `${c.provider}:${c.subjectExternalId}:${c.externalCommentId}`, eventType: `${parsed.object}.comment`, payload: c as object, signatureValid: true, status: "received" } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        duplicates++;
        continue;
      }
      throw err;
    }
    const r = await handleIncomingComment(c);
    await prisma.webhookEvent.update({ where: { provider_providerEventId: { provider: "meta", providerEventId: `${c.provider}:${c.subjectExternalId}:${c.externalCommentId}` } }, data: { status: r.outcome === "ignored" ? "ignored" : "processed", processedAt: new Date(), error: r.note ?? null } });
    handled++;
  }
  return { status: "ok", httpStatus: 200, handled, duplicates };
}

/**
 * The connected account an event belongs to. The same Page / Instagram account can be attached to
 * more than one brand; the one whose brand has a rule for this post wins (an enabled rule first), so
 * a comment is handled once, by the brand that asked for it.
 */
async function accountForSubject(provider: "instagram" | "facebook", subjectExternalId: string, externalPostId: string): Promise<SocialAccount | null> {
  const candidates = await prisma.socialAccount.findMany({ where: { provider, backend: "native", externalAccountId: subjectExternalId, status: { not: "disconnected" } }, orderBy: { createdAt: "asc" } });
  if (candidates.length <= 1) return candidates[0] ?? null;
  let withRule: SocialAccount | null = null;
  for (const acc of candidates) {
    const rules = (await listPrivateReplyRules(acc.brandId)).filter((r) => r.socialAccountId === acc.id && r.externalPostId === externalPostId);
    if (rules.some((r) => r.enabled)) return acc;
    if (rules.length && !withRule) withRule = acc;
  }
  return withRule ?? candidates[0]!;
}

/**
 * Matches a comment against the brand's enabled rules for that exact post and records the outcome.
 * Returns what happened; never throws for business reasons (a webhook must always be answered 200).
 */
export async function handleIncomingComment(c: IncomingComment): Promise<{ outcome: "queued" | "skipped" | "duplicate" | "ignored"; note?: string; privateReplyId?: string }> {
  const account = await accountForSubject(c.provider, c.subjectExternalId, c.externalPostId);
  if (!account) return { outcome: "ignored", note: `no connected ${c.provider} account ${c.subjectExternalId}` };
  if (c.authorId && c.authorId === account.externalAccountId) return { outcome: "ignored", note: "own comment" };
  const rules = (await listPrivateReplyRules(account.brandId)).filter((r) => r.socialAccountId === account.id && r.externalPostId === c.externalPostId);
  if (rules.length === 0) return { outcome: "ignored", note: "no rule for this post" };
  const enabled = rules.filter((r) => r.enabled);
  const match = enabled.find((r) => keywordMatches(c.text, r.keyword));
  // Comments older than the rule (or than Meta's 7-day window) are never answered — they predate the decision.
  const tooOld = (r: RuleView) => (c.createdAt ? c.createdAt.getTime() < r.createdAt.getTime() - 60_000 || Date.now() - c.createdAt.getTime() > REPLY_WINDOW_MS : false);
  const data = { brandId: account.brandId, socialAccountId: account.id, provider: c.provider, externalPostId: c.externalPostId, externalCommentId: c.externalCommentId, commentText: c.text, authorId: c.authorId ?? null, authorName: c.authorName ?? null, source: c.source, commentCreatedAt: c.createdAt ?? null };
  let row;
  try {
    if (!match) row = await prisma.privateReply.create({ data: { ...data, status: "skipped", error: enabled.length ? "no keyword match" : "rule is off" } });
    else if (tooOld(match)) row = await prisma.privateReply.create({ data: { ...data, ruleId: match.id, keyword: match.keyword, status: "skipped", error: "comment is older than the rule or than Meta's 7-day reply window" } });
    else row = await prisma.privateReply.create({ data: { ...data, ruleId: match.id, keyword: match.keyword, replyText: match.replyText, status: "queued" } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { outcome: "duplicate", note: "comment already handled" };
    throw err;
  }
  // The inbox keeps the comment too (what the owner sees under Inbox → comments).
  await prisma.comment.upsert({ where: { socialAccountId_externalCommentId: { socialAccountId: account.id, externalCommentId: c.externalCommentId } }, create: { brandId: account.brandId, socialAccountId: account.id, provider: c.provider, externalPostId: c.externalPostId, externalCommentId: c.externalCommentId, parentExternalId: c.parentExternalId ?? null, authorId: c.authorId ?? null, authorName: c.authorName ?? null, body: c.text ?? "", remoteCreatedAt: c.createdAt ?? new Date(), metadata: { source: c.source } }, update: {} }).catch(() => undefined);
  if (row.status !== "queued") {
    await audit({ brandId: account.brandId, action: "automation.private_reply.skipped", targetType: "comment", targetId: c.externalCommentId, details: { account: account.displayName, post: c.externalPostId, text: (c.text ?? "").slice(0, 120), reason: row.error, source: c.source } });
    return { outcome: "skipped", note: row.error ?? undefined, privateReplyId: row.id };
  }
  await enqueue("send_private_reply", { privateReplyId: row.id }, { dedupeKey: `private_reply:${row.id}`, once: true, priority: 8, maxAttempts: 4, brandId: account.brandId });
  return { outcome: "queued", privateReplyId: row.id };
}

// ---------------------------------------------------------------------------
// Sending (job)
// ---------------------------------------------------------------------------

export async function sendPrivateReplyJob(privateReplyId: string, attempt: number): Promise<unknown> {
  const row = await prisma.privateReply.findUnique({ where: { id: privateReplyId }, include: { socialAccount: true } });
  if (!row) return { skipped: "row gone" };
  if (row.status === "sent" || row.status === "uncertain" || row.status === "failed" || row.status === "skipped") return { skipped: row.status };
  if (!row.replyText) {
    await prisma.privateReply.update({ where: { id: row.id }, data: { status: "failed", error: "empty reply text" } });
    return { skipped: "empty" };
  }
  await prisma.privateReply.update({ where: { id: row.id }, data: { status: "sending", attempts: { increment: 1 } } });
  const account = row.socialAccount;
  const adapter = adapterFor(account);
  if (!adapter.sendPrivateReply) {
    await prisma.privateReply.update({ where: { id: row.id }, data: { status: "failed", error: "private replies are not supported for this account", errorCategory: "unsupported" } });
    throw new PermanentJobError("unsupported");
  }
  // Reading the stored token can fail (encryption key changed, row damaged). Nothing has been sent
  // at this point, so the row must not stay at `sending`: record it as failed and tell the owner.
  let ctx: Awaited<ReturnType<typeof buildAccountContext>>;
  try {
    ctx = await buildAccountContext(account);
  } catch {
    const msg = "The saved sign-in for this account could not be read. Reconnect the account, then press Retry. Nothing was sent.";
    await prisma.privateReply.update({ where: { id: row.id }, data: { status: "failed", error: msg, errorCategory: "auth_expired" } });
    await audit({ brandId: row.brandId, action: "automation.private_reply.failed", targetType: "comment", targetId: row.externalCommentId, outcome: "error", details: { account: account.displayName, post: row.externalPostId, category: "auth_expired", error: "stored credentials unreadable" } });
    await notify({ brandId: row.brandId, level: "error", title: `Comment → DM failed on ${account.displayName}`, body: msg, link: "/accounts" });
    throw new PermanentJobError("stored credentials unreadable");
  }
  try {
    const r = await adapter.sendPrivateReply(ctx, { externalCommentId: row.externalCommentId, text: row.replyText });
    await prisma.privateReply.update({ where: { id: row.id }, data: { status: "sent", sentAt: new Date(), providerMessageId: r.providerMessageId, providerRecipientId: r.providerRecipientId ?? null, error: null, errorCategory: null } });
    await prisma.comment.updateMany({ where: { socialAccountId: account.id, externalCommentId: row.externalCommentId }, data: { repliedAt: new Date() } });
    await audit({ brandId: row.brandId, action: "automation.private_reply.sent", targetType: "comment", targetId: row.externalCommentId, details: { account: account.displayName, post: row.externalPostId, keyword: row.keyword, author: row.authorName, messageId: r.providerMessageId, source: row.source } });
    return { sent: true, messageId: r.providerMessageId };
  } catch (err) {
    const e = err instanceof ProviderError ? err : new ProviderError((err as Error).message, { category: "unknown", retryable: false });
    const cat = e.options.category;
    // Reached Meta, answered no: permission / token / validation → final, shown to the owner.
    if (cat === "permission" || cat === "auth_expired" || cat === "validation" || cat === "not_found" || cat === "unsupported") {
      await prisma.privateReply.update({ where: { id: row.id }, data: { status: "failed", error: e.message, errorCategory: cat } });
      await audit({ brandId: row.brandId, action: "automation.private_reply.failed", targetType: "comment", targetId: row.externalCommentId, outcome: "error", details: { account: account.displayName, post: row.externalPostId, category: cat, error: e.message, providerCode: e.options.providerCode ?? null } });
      await notify({ brandId: row.brandId, level: "error", title: `Comment → DM failed on ${account.displayName}`, body: e.message, link: "/automations" });
      throw new PermanentJobError(e.message);
    }
    // Did not reach Meta for sure (connection refused / DNS) or Meta said retry (rate limit, 5xx) → retry, nothing was sent.
    const notSent = e.options.notSent === true || cat === "rate_limited" || cat === "provider_error";
    if (notSent) {
      if (attempt < 4) {
        await prisma.privateReply.update({ where: { id: row.id }, data: { status: "queued", error: e.message, errorCategory: cat } });
        throw new RetryableJobError(e.message, e.options.retryAfterSeconds);
      }
      await prisma.privateReply.update({ where: { id: row.id }, data: { status: "failed", error: `${e.message} (retries used up — nothing was sent)`, errorCategory: cat } });
      await audit({ brandId: row.brandId, action: "automation.private_reply.failed", targetType: "comment", targetId: row.externalCommentId, outcome: "error", details: { account: account.displayName, post: row.externalPostId, category: cat, error: e.message } });
      throw new PermanentJobError(e.message);
    }
    // Timeout / reset mid-request: Meta may or may not have delivered it. Never resend blindly.
    await prisma.privateReply.update({ where: { id: row.id }, data: { status: "uncertain", error: `${e.message} — Meta may have delivered this reply. Check the Instagram/Facebook inbox before pressing Retry.`, errorCategory: cat } });
    await audit({ brandId: row.brandId, action: "automation.private_reply.uncertain", targetType: "comment", targetId: row.externalCommentId, outcome: "error", details: { account: account.displayName, post: row.externalPostId, category: cat, error: e.message } });
    await notify({ brandId: row.brandId, level: "warning", title: `Comment → DM outcome unknown on ${account.displayName}`, body: "Check the inbox before retrying.", link: "/automations" });
    throw new PermanentJobError(e.message);
  }
}

/** Owner-initiated retry for `failed` / `uncertain` rows (after checking the inbox). */
export async function retryPrivateReply(userId: string, privateReplyId: string): Promise<void> {
  const row = await prisma.privateReply.findFirst({ where: { id: privateReplyId, brand: { ownerId: userId } } });
  if (!row) throw new Error("Not found.");
  if (row.status === "sent") throw new Error("Already sent.");
  if (row.status === "skipped") throw new Error("This comment did not match a rule.");
  await prisma.privateReply.update({ where: { id: row.id }, data: { status: "queued", error: null, errorCategory: null } });
  await enqueue("send_private_reply", { privateReplyId: row.id }, { dedupeKey: `private_reply:${row.id}:retry:${Date.now()}`, priority: 8, maxAttempts: 2, brandId: row.brandId });
  await audit({ actorUserId: userId, brandId: row.brandId, action: "automation.private_reply.retry", targetType: "comment", targetId: row.externalCommentId });
}

// ---------------------------------------------------------------------------
// Webhook subscription per account
// ---------------------------------------------------------------------------

export async function subscribeAccountWebhooks(userId: string, socialAccountId: string): Promise<{ subscribedFields: string[] }> {
  const account = await prisma.socialAccount.findFirst({ where: { id: socialAccountId, brand: { ownerId: userId } } });
  if (!account) throw new Error("Account not found.");
  const adapter = adapterFor(account);
  if (!adapter.subscribeWebhooks) throw new Error("This provider has no webhook subscription.");
  const ctx = await buildAccountContext(account);
  try {
    const r = await adapter.subscribeWebhooks(ctx);
    await prisma.socialAccount.update({ where: { id: account.id }, data: { metadata: { ...(account.metadata as object), webhookFields: r.subscribedFields, webhookSubscribedAt: new Date().toISOString(), webhookError: null } } });
    await audit({ actorUserId: userId, brandId: account.brandId, action: "webhook.subscribe", targetType: "account", targetId: account.id, details: { fields: r.subscribedFields } });
    return r;
  } catch (err) {
    const msg = (err as Error).message;
    await prisma.socialAccount.update({ where: { id: account.id }, data: { metadata: { ...(account.metadata as object), webhookError: msg } } });
    await audit({ actorUserId: userId, brandId: account.brandId, action: "webhook.subscribe", targetType: "account", targetId: account.id, outcome: "error", details: { error: msg } });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Poll fallback: while Meta has not approved live comment webhooks, read the watched posts' comments
// every minute with the account's own token (Standard Access covers the owner's own media).
// ---------------------------------------------------------------------------

export async function ensurePollingArmed(): Promise<void> {
  const minute = Math.floor(Date.now() / 60_000);
  await enqueue("poll_private_reply_rules", {}, { dedupeKey: `poll_private_reply_rules:${minute + 1}`, runAt: new Date((minute + 1) * 60_000), once: true, priority: 3 });
}

export async function pollPrivateReplyRulesJob(): Promise<unknown> {
  const rules = (await prisma.automationRule.findMany({ where: { enabled: true } })).map(ruleView).filter((x): x is RuleView => Boolean(x));
  if (rules.length === 0) return { rules: 0 };
  let seen = 0;
  const byAccount = new Map<string, RuleView[]>();
  for (const r of rules) byAccount.set(r.socialAccountId, [...(byAccount.get(r.socialAccountId) ?? []), r]);
  for (const [accountId, accountRules] of byAccount) {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId } });
    if (!account || account.status === "disconnected") continue;
    const adapter = adapterFor(account);
    if (!adapter.fetchComments) continue;
    // One account whose saved sign-in cannot be read must not stop the poll for every other account.
    let ctx: Awaited<ReturnType<typeof buildAccountContext>>;
    try {
      ctx = await buildAccountContext(account);
    } catch {
      await prisma.socialAccount.update({ where: { id: account.id }, data: { metadata: { ...(account.metadata as object), pollError: "saved sign-in could not be read — reconnect the account", pollErrorAt: new Date().toISOString() } } }).catch(() => undefined);
      continue;
    }
    for (const post of new Set(accountRules.map((r) => r.externalPostId))) {
      try {
        const page = await adapter.fetchComments(ctx, { externalPostId: post });
        for (const c of page.comments) {
          seen++;
          await handleIncomingComment({ provider: account.provider as "instagram" | "facebook", subjectExternalId: account.externalAccountId, externalPostId: post, externalCommentId: c.externalCommentId, text: c.body, authorId: c.authorId ?? null, authorName: c.authorName ?? null, parentExternalId: c.parentExternalId ?? null, createdAt: c.createdAt, source: "poll" });
        }
      } catch (err) {
        await prisma.socialAccount.update({ where: { id: account.id }, data: { metadata: { ...(account.metadata as object), pollError: (err as Error).message, pollErrorAt: new Date().toISOString() } } }).catch(() => undefined);
      }
    }
  }
  await ensurePollingArmed();
  return { rules: rules.length, comments: seen };
}
