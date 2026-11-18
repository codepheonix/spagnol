/**
 * Execution traces: maps one real run (a post, or a comment handled by Comment → DM) onto the nodes
 * of its diagram. States come from the stored records of that run; a stage the system does not have
 * yet is "skipped", never shown as done.
 */
import { prisma } from "@sm/db";

export type StageState = "completed" | "active" | "failed" | "skipped";
export interface RunSummary { id: string; diagram: "publishing-learning" | "messaging-leads"; label: string; status: string; at: string }
export interface RunTrace { run: RunSummary; stages: Record<string, { state: StageState; note?: string; at?: string | null }>; events: Array<{ at: string; text: string; level: "info" | "error" }> }

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function listRuns(userId: string, diagram: string, take = 25): Promise<RunSummary[]> {
  if (diagram === "publishing-learning") {
    const posts = await prisma.post.findMany({ where: { brand: { ownerId: userId } }, orderBy: { updatedAt: "desc" }, take, select: { id: true, title: true, body: true, status: true, updatedAt: true, brand: { select: { name: true } } } });
    return posts.map((p) => ({ id: p.id, diagram: "publishing-learning", label: `${p.brand.name} · ${(p.title || p.body || "(no text)").slice(0, 60)}`, status: p.status, at: p.updatedAt.toISOString() }));
  }
  if (diagram === "messaging-leads") {
    const rows = await prisma.privateReply.findMany({ where: { brand: { ownerId: userId } }, orderBy: { createdAt: "desc" }, take, select: { id: true, commentText: true, authorName: true, status: true, createdAt: true, provider: true } });
    return rows.map((r) => ({ id: r.id, diagram: "messaging-leads", label: `${r.provider} · ${r.authorName ?? "?"}: ${(r.commentText ?? "").slice(0, 50)}`, status: r.status, at: r.createdAt.toISOString() }));
  }
  return [];
}

export async function traceRun(userId: string, diagram: string, id: string): Promise<RunTrace | null> {
  if (diagram === "publishing-learning") return tracePost(userId, id);
  if (diagram === "messaging-leads") return traceComment(userId, id);
  return null;
}

async function tracePost(userId: string, id: string): Promise<RunTrace | null> {
  const post = await prisma.post.findFirst({ where: { id, brand: { ownerId: userId } }, include: { brand: { select: { name: true } }, media: true, targets: { include: { socialAccount: { select: { displayName: true, provider: true } }, publishAttempts: { orderBy: { startedAt: "asc" } } } } } });
  if (!post) return null;
  const t = post.targets;
  const name = (x: (typeof t)[number]) => `${x.socialAccount.provider} · ${x.socialAccount.displayName}`;
  const published = t.filter((x) => x.status === "published");
  const failed = t.filter((x) => x.status === "failed_permanent" || x.status === "needs_reconnect" || x.status === "blocked");
  const retrying = t.filter((x) => x.status === "failed_retryable");
  const flying = t.filter((x) => x.status === "queued" || x.status === "uploading" || x.status === "processing");
  const attempts = t.flatMap((x) => x.publishAttempts.map((a) => ({ ...a, target: name(x) })));
  const released = post.status !== "draft" && post.status !== "validated";
  const due = !post.scheduledAt || post.scheduledAt.getTime() <= Date.now();
  const metricCount = published.length ? await prisma.analyticsMetric.count({ where: { brandId: post.brandId, scope: "post", subjectId: { in: published.map((x) => x.remotePostId ?? "").filter(Boolean) } } }) : 0;
  const aiUsed = Boolean((post.metadata as { aiDraft?: unknown } | null)?.aiDraft);
  const validated = t.some((x) => x.validation) || released;
  const stages: RunTrace["stages"] = {
    trigger: { state: released ? "completed" : "active", note: post.scheduledAt ? `Scheduled for ${post.scheduledAt.toISOString()} (${post.scheduleTimezone ?? "UTC"})` : released ? "Published on demand" : "Still a draft", at: iso(post.scheduledAt ?? post.createdAt) },
    knowledge: { state: "skipped", note: "Brand knowledge base is not built yet." },
    history: { state: "skipped", note: "Past metrics are stored but not used for planning yet." },
    ai: { state: aiUsed ? "completed" : "skipped", note: aiUsed ? "Caption started from an AI draft." : "Written by a person (no AI draft recorded)." },
    creative: { state: post.media.length ? "completed" : "skipped", note: `${post.media.length} media file(s) attached.` },
    validate: { state: validated ? (t.some((x) => x.status === "blocked") ? "failed" : "completed") : "active", note: t.some((x) => x.status === "blocked") ? "A target is blocked by validation." : validated ? "Per-network checks passed." : "Not validated yet." },
    policy: { state: released ? "completed" : "active", note: "Released by the owner (no auto-approval policy yet)." },
    approval: { state: released ? "completed" : "active", note: released ? "Owner pressed Schedule / Publish." : "Waiting for the owner." },
    pqueue: { state: !released ? "skipped" : post.status === "canceled" ? "skipped" : !due ? "active" : "completed", note: !due ? "Waiting for the scheduled time." : `${t.length} account job(s).` },
    publish: { state: !released || !due ? "skipped" : flying.length || retrying.length ? "active" : published.length ? "completed" : failed.length ? "failed" : "skipped", note: t.map((x) => `${name(x)}: ${x.status}`).join(" · ") || "No target accounts." },
    verify: { state: published.length === 0 ? (failed.length && !flying.length ? "failed" : "skipped") : published.every((x) => x.remotePostId) ? (failed.length || retrying.length ? "active" : "completed") : "active", note: published.length ? `${published.filter((x) => x.remotePostId).length}/${published.length} carry a remote id.` : undefined },
    retry: { state: retrying.length ? "active" : attempts.some((a) => a.attemptNumber > 1 || a.status === "unknown") ? "completed" : failed.length ? "failed" : "skipped", note: retrying.length ? `${retrying.map(name).join(", ")} will be retried.` : failed.length ? `${failed.map((x) => `${name(x)}: ${x.lastError ?? x.status}`).join(" · ")}` : undefined },
    partial: { state: post.status === "partial" ? "active" : "skipped", note: post.status === "partial" ? `Published on ${published.length}, failed on ${failed.length}. Retry the failed account from the post page.` : undefined },
    collect: { state: metricCount > 0 ? "completed" : published.length ? "active" : "skipped", note: published.length ? `${metricCount} metric values stored for this post.` : undefined },
    learn: { state: "skipped", note: "Learning engine is not built yet." },
  };
  const events: RunTrace["events"] = [{ at: post.createdAt.toISOString(), text: "Post created", level: "info" }];
  if (post.scheduledAt) events.push({ at: post.scheduledAt.toISOString(), text: "Scheduled time", level: "info" });
  for (const a of attempts) events.push({ at: (a.finishedAt ?? a.startedAt).toISOString(), text: `${a.target}: attempt ${a.attemptNumber} ${a.status}${a.remotePostId ? ` → ${a.remotePostId}` : ""}${a.error ? ` — ${a.error.slice(0, 200)}` : ""}${a.providerRequestId ? ` (request ${a.providerRequestId})` : ""}`, level: a.status === "failed" || a.status === "unknown" ? "error" : "info" });
  for (const x of published) if (x.publishedAt) events.push({ at: x.publishedAt.toISOString(), text: `${name(x)}: published${x.remoteUrl ? ` ${x.remoteUrl}` : ""}`, level: "info" });
  events.sort((a, b) => a.at.localeCompare(b.at));
  return { run: { id: post.id, diagram: "publishing-learning", label: `${post.brand.name} · ${(post.title || post.body).slice(0, 60)}`, status: post.status, at: post.updatedAt.toISOString() }, stages, events };
}

async function traceComment(userId: string, id: string): Promise<RunTrace | null> {
  const r = await prisma.privateReply.findFirst({ where: { id, brand: { ownerId: userId } }, include: { socialAccount: { select: { displayName: true } } } });
  if (!r) return null;
  const viaWebhook = r.source === "webhook";
  const matched = r.status !== "skipped" || Boolean(r.ruleId);
  const allowed = r.status !== "skipped";
  const sent = r.status === "sent";
  const bad = r.status === "failed" || r.status === "uncertain";
  const lead = sent && r.authorId ? await prisma.contactRecord.count({ where: { brandId: r.brandId, externalId: r.authorId } }) : 0;
  const stages: RunTrace["stages"] = {
    event: { state: "completed", note: `${r.authorName ?? "Someone"} commented: “${(r.commentText ?? "").slice(0, 120)}”`, at: iso(r.commentCreatedAt) },
    webhook: { state: viaWebhook ? "completed" : "skipped", note: viaWebhook ? "Signed delivery accepted." : "This comment was found by the poll, not pushed by Meta." },
    poll: { state: viaWebhook ? "skipped" : "completed", note: viaWebhook ? undefined : "Read with the account’s own token." },
    identify: { state: "completed", note: `Account ${r.socialAccount.displayName}, post ${r.externalPostId}.` },
    rules: { state: "completed", note: matched ? `Keyword “${r.keyword ?? ""}” matched.` : `No rule matched (${r.error ?? "no keyword match"}).` },
    intent: { state: "skipped", note: "AI intent analysis is not built yet." },
    allowed: { state: "completed", note: allowed ? "One reply per comment, inside Meta’s 7-day window." : `Not allowed: ${r.error ?? "no match"}.` },
    send: { state: !allowed ? "skipped" : sent ? "completed" : bad ? "failed" : "active", note: sent ? `Meta message id ${r.providerMessageId}` : bad ? r.error ?? r.status : allowed ? `Status ${r.status}, attempt ${r.attempts}.` : undefined, at: iso(r.sentAt) },
    blocked: { state: allowed ? "skipped" : "completed", note: allowed ? undefined : "Recorded as “no DM”." },
    review: { state: bad ? "active" : "skipped", note: bad ? (r.status === "uncertain" ? "Outcome unknown — check the inbox before Retry." : `Meta refused (${r.errorCategory ?? "error"}). Fix the cause, then Retry.`) : undefined },
    lead: { state: lead > 0 ? "completed" : "skipped", note: lead > 0 ? "A lead record exists for this person." : "Lead creation from private replies is not wired yet." },
    assign: { state: "skipped", note: "Dealer hand-off is not built yet." },
    outcome: { state: "skipped", note: "Lead outcome tracking is not built yet." },
  };
  const events: RunTrace["events"] = [];
  if (r.commentCreatedAt) events.push({ at: r.commentCreatedAt.toISOString(), text: "Comment written", level: "info" });
  events.push({ at: r.createdAt.toISOString(), text: `Seen via ${r.source}; ${matched ? "rule matched" : "no rule matched"}`, level: "info" });
  if (r.sentAt) events.push({ at: r.sentAt.toISOString(), text: `Private reply sent (${r.providerMessageId})`, level: "info" });
  if (bad) events.push({ at: r.updatedAt.toISOString(), text: `${r.status}: ${r.error ?? ""}`, level: "error" });
  return { run: { id: r.id, diagram: "messaging-leads", label: `${r.authorName ?? "?"}: ${(r.commentText ?? "").slice(0, 60)}`, status: r.status, at: r.createdAt.toISOString() }, stages, events };
}
