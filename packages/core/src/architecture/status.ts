/**
 * Live status for the architecture diagrams. Every value here is read from the system's own
 * records (jobs, attempts, webhook events, accounts, settings) at request time — nothing is
 * simulated. A probe that has no evidence yet says so ("waiting"); a part that is not configured or
 * not built is "disabled".
 */
import { prisma } from "@sm/db";
import { getSecurityOverview, type ControlState } from "../security-center";
import { queueStats } from "../queue";
import { getAiConfig, getZernioConfig, providerAppStatus } from "../settings";
import { listPrivateReplyRules } from "../private-replies";
import type { ProbeKey } from "./diagrams";

export type LiveStatus = "healthy" | "running" | "waiting" | "needs_approval" | "warning" | "failed" | "disabled";

export interface JobRef { id: string; type: string; status: string; at: string; error?: string | null }
export interface ProbeResult {
  status: LiveStatus;
  /** One line, plain words. */
  summary: string;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastError?: string | null;
  recentJobs?: JobRef[];
  /** Names only — values never leave the server. */
  credentials?: Array<{ name: string; configured: boolean }>;
  retryable?: boolean;
  metrics?: Record<string, string | number>;
  nextStep?: string;
}
export type StatusMap = Record<ProbeKey, ProbeResult>;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const DAY = 24 * 3600_000;

async function jobsOf(types: string[], brandIds: string[], take = 6): Promise<{ recent: JobRef[]; lastOk: Date | null; lastFail: Date | null; lastError: string | null; running: number; queued: number; dead: number }> {
  const scope = { type: { in: types }, OR: [{ brandId: { in: brandIds } }, { brandId: null }] };
  const [recent, ok, fail, running, queued, dead] = await Promise.all([
    prisma.job.findMany({ where: scope, orderBy: { updatedAt: "desc" }, take }),
    prisma.job.findFirst({ where: { ...scope, status: "succeeded" }, orderBy: { finishedAt: "desc" } }),
    prisma.job.findFirst({ where: { ...scope, status: { in: ["dead", "failed"] } }, orderBy: { updatedAt: "desc" } }),
    prisma.job.count({ where: { ...scope, status: "running" } }),
    prisma.job.count({ where: { ...scope, status: "queued", runAt: { lte: new Date() } } }),
    prisma.job.count({ where: { ...scope, status: "dead", updatedAt: { gte: new Date(Date.now() - 7 * DAY) } } }),
  ]);
  return { recent: recent.map((j) => ({ id: j.id, type: j.type, status: j.status, at: j.updatedAt.toISOString(), error: j.lastError?.slice(0, 240) ?? null })), lastOk: ok?.finishedAt ?? null, lastFail: fail?.updatedAt ?? null, lastError: fail?.lastError?.slice(0, 400) ?? null, running, queued, dead };
}

export async function getArchitectureStatus(userId: string): Promise<{ at: string; version: string; probes: StatusMap }> {
  const brands = await prisma.brand.findMany({ where: { ownerId: userId, archivedAt: null }, select: { id: true } });
  const brandIds = brands.map((b) => b.id);
  const inBrand = { brandId: { in: brandIds } };
  const week = new Date(Date.now() - 7 * DAY);

  // --- database -----------------------------------------------------------------------------
  const t0 = Date.now();
  let db: ProbeResult;
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ms = Date.now() - t0;
    db = { status: ms > 1500 ? "warning" : "healthy", summary: `Answered in ${ms} ms.`, lastSuccessAt: new Date().toISOString(), metrics: { latencyMs: ms }, credentials: [{ name: "DATABASE_URL", configured: Boolean(process.env.DATABASE_URL) }] };
  } catch (err) {
    db = { status: "failed", summary: "The database did not answer.", lastFailureAt: new Date().toISOString(), lastError: (err as Error).message.slice(0, 300), nextStep: "Check the Supabase project (paused free-tier projects need Restore) and DATABASE_URL." };
  }

  // --- queue + scheduler ----------------------------------------------------------------------
  const [stats, lastTick, heartbeats, apps, ai, zernio] = await Promise.all([
    queueStats(),
    prisma.systemSetting.findUnique({ where: { key: "jobs.lastTick" } }),
    prisma.systemSetting.findMany({ where: { key: { startsWith: "worker.heartbeat." } } }),
    providerAppStatus(),
    getAiConfig().catch(() => null),
    getZernioConfig().catch(() => null),
  ]);
  const allJobs = await jobsOf((await prisma.job.groupBy({ by: ["type"] })).map((g) => g.type), brandIds, 8);
  const queue: ProbeResult = {
    status: stats.dead > 0 ? "warning" : stats.lagSeconds > 300 ? "warning" : stats.running > 0 ? "running" : "healthy",
    summary: `${stats.queued} queued (oldest due ${stats.lagSeconds}s ago), ${stats.running} running, ${stats.dead} dead-letter.`,
    lastSuccessAt: iso(allJobs.lastOk), lastFailureAt: iso(allJobs.lastFail), lastError: allJobs.lastError, recentJobs: allJobs.recent, retryable: stats.dead > 0,
    metrics: { queued: stats.queued, running: stats.running, dead: stats.dead, succeeded: stats.succeeded, lagSeconds: stats.lagSeconds },
    nextStep: stats.dead > 0 ? "Health → Dead-letter jobs: read the error, fix the cause, press Retry." : stats.lagSeconds > 300 ? "Due jobs are waiting: check the scheduler node." : undefined,
  };
  const tickAt = (lastTick?.value as { at?: string; processed?: number } | null)?.at ?? null;
  const beatAt = heartbeats.map((h) => (h.value as { at?: string }).at).filter(Boolean).sort().pop() ?? null;
  const newest = [tickAt, beatAt].filter(Boolean).sort().pop() ?? null;
  const ageMin = newest ? (Date.now() - new Date(newest).getTime()) / 60_000 : Infinity;
  const scheduler: ProbeResult = {
    status: ageMin < 3 ? "healthy" : ageMin < 15 ? "warning" : newest ? "failed" : "waiting",
    summary: newest ? `Last run ${Math.round(ageMin)} min ago (${tickAt === newest ? "database cron tick" : "worker heartbeat"}).` : "No tick or worker heartbeat recorded yet.",
    lastSuccessAt: newest, metrics: { minutesSinceLastRun: Number.isFinite(ageMin) ? Math.round(ageMin) : "never" },
    credentials: [{ name: "CRON_SECRET", configured: Boolean(process.env.CRON_SECRET) }],
    nextStep: ageMin >= 3 ? "Supabase → Integrations → Cron: job sm-job-tick must be active (supabase/scheduler.sql), or run the worker." : undefined,
  };

  // --- credentials / providers ----------------------------------------------------------------
  const metaReady = apps.META_APP_ID && apps.META_APP_SECRET;
  const meta_app: ProbeResult = {
    status: metaReady ? "healthy" : "waiting",
    summary: metaReady ? "Meta app ID and secret are saved (verified with Meta when entered)." : "No Meta app registered yet — Facebook and Instagram cannot be connected.",
    credentials: [{ name: "META_APP_ID", configured: apps.META_APP_ID }, { name: "META_APP_SECRET", configured: apps.META_APP_SECRET }, { name: "META_WEBHOOK_VERIFY_TOKEN", configured: apps.META_WEBHOOK_VERIFY_TOKEN }, { name: "INSTAGRAM_APP_ID (Instagram Login, optional)", configured: apps.INSTAGRAM_APP_ID && apps.INSTAGRAM_APP_SECRET }],
    nextStep: metaReady ? undefined : "Connections → Meta setup: create the app at Meta and paste App ID + App secret.",
  };
  const accounts = brandIds.length ? await prisma.socialAccount.findMany({ where: inBrand, select: { id: true, provider: true, backend: true, status: true, healthStatus: true, lastError: true, lastCheckedAt: true, displayName: true } }) : [];
  const badAcc = accounts.filter((a) => a.status === "needs_reconnect" || a.status === "error" || a.healthStatus === "error");
  const healthJobs = await jobsOf(["check_account_health"], brandIds);
  const connections: ProbeResult = accounts.length === 0
    ? { status: "waiting", summary: "No social account is connected yet.", nextStep: metaReady ? "Connections → Connect with Facebook." : "Register the Meta app first (Connections → Meta setup).", recentJobs: healthJobs.recent }
    : { status: badAcc.length ? (badAcc.length === accounts.length ? "failed" : "warning") : "healthy", summary: `${accounts.length} connected (${accounts.filter((a) => a.backend === "native").length} direct, ${accounts.filter((a) => a.backend === "zernio").length} via Zernio); ${badAcc.length} need attention.`, lastSuccessAt: iso(healthJobs.lastOk), lastFailureAt: iso(healthJobs.lastFail), lastError: badAcc[0] ? `${badAcc[0].displayName}: ${badAcc[0].lastError ?? badAcc[0].status}` : null, recentJobs: healthJobs.recent, retryable: badAcc.length > 0, metrics: { accounts: accounts.length, needAttention: badAcc.length }, nextStep: badAcc.length ? "Connections → Reconnect on the flagged account." : undefined };
  const zernioProbe: ProbeResult = zernio
    ? { status: "healthy", summary: "API key configured. Used only for accounts explicitly connected through Zernio (billed per account).", credentials: [{ name: "zernio.apiKey", configured: true }, { name: "zernio.webhookSecret", configured: Boolean(zernio.webhookSecret) }], metrics: { accountsViaZernio: accounts.filter((a) => a.backend === "zernio").length } }
    : { status: "disabled", summary: "Off: no Zernio API key. Nothing is routed to Zernio and nothing is billed.", credentials: [{ name: "zernio.apiKey", configured: false }], nextStep: "Optional. To enable, add the key in Settings — Zernio charges per connected account." };

  // --- publishing + verification ----------------------------------------------------------------
  const pubJobs = await jobsOf(["publish_target"], brandIds);
  const [attOk, attFail, attUnknown, failedTargets, inFlight, publishedCount] = brandIds.length
    ? await Promise.all([
        prisma.publishAttempt.findFirst({ where: { status: "succeeded", postTarget: { post: inBrand } }, orderBy: { finishedAt: "desc" } }),
        prisma.publishAttempt.findFirst({ where: { status: "failed", postTarget: { post: inBrand } }, orderBy: { startedAt: "desc" } }),
        prisma.publishAttempt.count({ where: { status: { in: ["unknown", "started"] }, startedAt: { lt: new Date(Date.now() - 10 * 60_000) }, postTarget: { post: inBrand, status: { notIn: ["published", "canceled"] } } } }),
        prisma.postTarget.count({ where: { post: inBrand, status: { in: ["failed_permanent", "needs_reconnect"] }, updatedAt: { gte: week } } }),
        // "In flight" = being sent now. A target queued for a future scheduled time is waiting, not running.
        prisma.postTarget.count({ where: { OR: [{ post: inBrand, status: { in: ["uploading", "processing", "failed_retryable"] } }, { post: { ...inBrand, OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] }, status: "queued" }] } }),
        prisma.postTarget.count({ where: { post: inBrand, status: "published" } }),
      ])
    : [null, null, 0, 0, 0, 0];
  const publishing: ProbeResult = publishedCount === 0 && !attFail && inFlight === 0
    ? { status: "waiting", summary: "No post has been published yet.", recentJobs: pubJobs.recent, nextStep: accounts.length ? "Posts → New post → schedule one photo a few minutes ahead." : "Connect an account first." }
    : { status: inFlight > 0 ? "running" : failedTargets > 0 ? "warning" : "healthy", summary: `${publishedCount} account publications confirmed; ${inFlight} in flight; ${failedTargets} failed in the last 7 days.`, lastSuccessAt: iso(attOk?.finishedAt), lastFailureAt: iso(attFail?.startedAt), lastError: attFail?.error?.slice(0, 400) ?? pubJobs.lastError, recentJobs: pubJobs.recent, retryable: failedTargets > 0, metrics: { published: publishedCount, inFlight, failed7d: failedTargets }, nextStep: failedTargets > 0 ? "Posts → open the failed post → Retry on the failed account only." : undefined };
  const recJobs = await jobsOf(["reconcile_target"], brandIds);
  const verification: ProbeResult = publishedCount === 0 && attUnknown === 0
    ? { status: "waiting", summary: "Nothing to verify yet.", recentJobs: recJobs.recent }
    : { status: attUnknown > 0 ? "warning" : recJobs.running > 0 ? "running" : "healthy", summary: `${publishedCount} publications carry a remote id; ${attUnknown} attempts have an unknown outcome older than 10 minutes.`, lastSuccessAt: iso(recJobs.lastOk ?? attOk?.finishedAt), lastFailureAt: iso(recJobs.lastFail), lastError: recJobs.lastError, recentJobs: recJobs.recent, metrics: { unknownAttempts: attUnknown }, nextStep: attUnknown > 0 ? "The publish job looks the post up on the network before re-sending; open the post to see the result." : undefined };

  // --- webhooks, private replies, rules, inbox ----------------------------------------------------
  const [whLast, whFailed, whCount] = await Promise.all([
    prisma.webhookEvent.findFirst({ where: { provider: "meta" }, orderBy: { receivedAt: "desc" } }),
    prisma.webhookEvent.findFirst({ where: { provider: "meta", status: "failed" }, orderBy: { receivedAt: "desc" } }),
    prisma.webhookEvent.count({ where: { provider: "meta", receivedAt: { gte: week } } }),
  ]);
  const webhooks: ProbeResult = !metaReady
    ? { status: "disabled", summary: "Cannot verify signatures until the Meta app secret is saved.", credentials: [{ name: "META_APP_SECRET", configured: false }], nextStep: "Connections → Meta setup." }
    : whLast
      ? { status: whFailed && whFailed.receivedAt.getTime() === whLast.receivedAt.getTime() ? "warning" : "healthy", summary: `${whCount} signed deliveries in the last 7 days; last ${whLast.eventType ?? "event"} was ${whLast.status}.`, lastSuccessAt: iso(whLast.receivedAt), lastFailureAt: iso(whFailed?.receivedAt), lastError: whFailed?.error ?? null, metrics: { deliveries7d: whCount }, credentials: [{ name: "META_WEBHOOK_VERIFY_TOKEN", configured: apps.META_WEBHOOK_VERIFY_TOKEN }] }
      : { status: "waiting", summary: "Endpoint is up; Meta has not delivered a comment event yet. Unsigned deliveries are rejected and not stored.", credentials: [{ name: "META_WEBHOOK_VERIFY_TOKEN", configured: apps.META_WEBHOOK_VERIFY_TOKEN }], nextStep: "Meta app → Webhooks → Instagram → callback /api/webhooks/meta + verify token → subscribe “comments”. Live events need the app Live with Advanced Access; the per-minute poll covers the gap." };
  const rules = (await Promise.all(brandIds.map((id) => listPrivateReplyRules(id)))).flat();
  const rulesOn = rules.filter((r) => r.enabled).length;
  const automation_rules: ProbeResult = rules.length === 0
    ? { status: "waiting", summary: "No Comment → DM rule exists.", nextStep: "Automations → New rule (account, post, keyword, reply)." }
    : { status: rulesOn ? "healthy" : "disabled", summary: `${rulesOn} of ${rules.length} rules are on.`, metrics: { rules: rules.length, enabled: rulesOn } };
  const prJobs = await jobsOf(["send_private_reply", "poll_private_reply_rules"], brandIds);
  const prCounts = brandIds.length ? await prisma.privateReply.groupBy({ by: ["status"], where: { ...inBrand, createdAt: { gte: week } }, _count: { _all: true } }) : [];
  const c = (s: string) => prCounts.find((x) => x.status === s)?._count._all ?? 0;
  const [prSent, prBad] = brandIds.length
    ? await Promise.all([
        prisma.privateReply.findFirst({ where: { ...inBrand, status: "sent" }, orderBy: { sentAt: "desc" } }),
        prisma.privateReply.findFirst({ where: { ...inBrand, status: { in: ["failed", "uncertain"] } }, orderBy: { updatedAt: "desc" } }),
      ])
    : [null, null];
  const open = c("failed") + c("uncertain");
  const private_replies: ProbeResult = rules.length === 0 && !prSent && !prBad
    ? { status: "waiting", summary: "No rule yet, so no comment is being watched.", recentJobs: prJobs.recent, nextStep: "Automations → New rule." }
    : { status: open > 0 ? "warning" : c("queued") + c("sending") > 0 ? "running" : rulesOn ? "healthy" : "disabled", summary: `Last 7 days: ${c("sent")} DMs sent, ${c("skipped")} comments left alone, ${c("failed")} refused by Meta, ${c("uncertain")} uncertain.`, lastSuccessAt: iso(prSent?.sentAt), lastFailureAt: iso(prBad?.updatedAt), lastError: prBad?.error?.slice(0, 400) ?? null, recentJobs: prJobs.recent, retryable: open > 0, metrics: { sent7d: c("sent"), skipped7d: c("skipped"), failed7d: c("failed"), uncertain7d: c("uncertain") }, nextStep: open > 0 ? "Automations → Comments seen: read the error; for “uncertain” check the inbox before Retry." : undefined };
  const inboxJobs = await jobsOf(["sync_inbox", "sync_comments"], brandIds);
  const inbox: ProbeResult = accounts.length === 0
    ? { status: "waiting", summary: "No account to read comments or messages from.", recentJobs: inboxJobs.recent }
    : { status: inboxJobs.dead > 0 ? "warning" : inboxJobs.lastOk ? "healthy" : "waiting", summary: inboxJobs.lastOk ? "Comments and inbox sync hourly." : "Sync has not completed yet (runs hourly).", lastSuccessAt: iso(inboxJobs.lastOk), lastFailureAt: iso(inboxJobs.lastFail), lastError: inboxJobs.lastError, recentJobs: inboxJobs.recent, retryable: inboxJobs.dead > 0 };

  // --- analytics, ads, media, leads, AI -----------------------------------------------------------
  const anJobs = await jobsOf(["sync_analytics"], brandIds);
  const metricCount = brandIds.length ? await prisma.analyticsMetric.count({ where: inBrand }) : 0;
  const analytics: ProbeResult = accounts.length === 0
    ? { status: "waiting", summary: "No account to read metrics from.", recentJobs: anJobs.recent }
    : { status: anJobs.dead > 0 ? "warning" : metricCount > 0 ? "healthy" : "waiting", summary: `${metricCount} metric values stored; sync runs every six hours.`, lastSuccessAt: iso(anJobs.lastOk), lastFailureAt: iso(anJobs.lastFail), lastError: anJobs.lastError, recentJobs: anJobs.recent, metrics: { metricValues: metricCount }, nextStep: metricCount === 0 ? "Insights permissions are optional: add them in Meta, tick the option in Meta setup, reconnect." : undefined };
  const adAccounts = brandIds.length ? await prisma.adAccount.count({ where: inBrand }) : 0;
  const adJobs = await jobsOf(["sync_ads"], brandIds);
  const ads: ProbeResult = adAccounts === 0
    ? { status: "disabled", summary: "No ad account connected. The native Meta Marketing adapter is not built; reading works only through the optional Zernio gateway. Activation is disabled by design.", recentJobs: adJobs.recent, nextStep: "Planned: Connect Meta Ads (ads_read) → pick ad account → read campaigns → drafts → explicit launch." }
    : { status: adJobs.dead > 0 ? "warning" : "needs_approval", summary: `${adAccounts} ad account(s) in read-only mode. Creating or activating campaigns needs a person’s confirmation and is switched off until read sync is verified live.`, lastSuccessAt: iso(adJobs.lastOk), lastFailureAt: iso(adJobs.lastFail), lastError: adJobs.lastError, recentJobs: adJobs.recent, metrics: { adAccounts } };
  const [mediaReady, mediaBad, mediaLast] = brandIds.length
    ? await Promise.all([prisma.mediaAsset.count({ where: { ...inBrand, status: "ready" } }), prisma.mediaAsset.count({ where: { ...inBrand, status: "failed" } }), prisma.mediaAsset.findFirst({ where: { ...inBrand, status: "ready" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })])
    : [0, 0, null];
  const driver = process.env.STORAGE_DRIVER ?? "local";
  const media: ProbeResult = { status: driver === "local" && process.env.VERCEL ? "warning" : mediaReady > 0 ? "healthy" : "waiting", summary: `${mediaReady} files ready; storage driver “${driver}”.`, lastSuccessAt: iso(mediaLast?.createdAt), metrics: { ready: mediaReady, failed: mediaBad }, credentials: [{ name: "STORAGE_DRIVER", configured: Boolean(process.env.STORAGE_DRIVER) }, { name: "MEDIA_GATEWAY_URL", configured: Boolean(process.env.MEDIA_GATEWAY_URL) }], nextStep: driver === "local" && process.env.VERCEL ? "Local disk cannot serve signed URLs on Vercel — set STORAGE_DRIVER=supabase-edge." : undefined };
  const leadCount = brandIds.length ? await prisma.contactRecord.count({ where: inBrand }) : 0;
  const leads: ProbeResult = { status: leadCount > 0 ? "healthy" : "waiting", summary: `${leadCount} lead records. Leads are created from lead forms today; creation from private replies is planned.`, metrics: { leads: leadCount } };
  const [aiOk, aiCount] = await Promise.all([
    prisma.auditLog.findFirst({ where: { action: "ai.draft", OR: [{ brandId: { in: brandIds } }, { actorUserId: userId }] }, orderBy: { createdAt: "desc" } }),
    prisma.auditLog.count({ where: { action: "ai.draft", createdAt: { gte: week }, OR: [{ brandId: { in: brandIds } }, { actorUserId: userId }] } }),
  ]);
  const aiProbe: ProbeResult = ai
    ? { status: aiOk ? "healthy" : "waiting", summary: aiOk ? `${aiCount} drafts in the last 7 days; model ${ai.model}.` : `Key saved, model ${ai.model}; no draft requested yet.`, lastSuccessAt: iso(aiOk?.createdAt), credentials: [{ name: "ai.apiKey (OpenRouter)", configured: true }], metrics: { drafts7d: aiCount } }
    : { status: "disabled", summary: "Off: no OpenRouter key saved, so no AI call is made and nothing is billed.", credentials: [{ name: "ai.apiKey (OpenRouter)", configured: false }], nextStep: "Settings → AI: paste the OpenRouter key and pick a model." };

  // --- the app itself -----------------------------------------------------------------------------
  const version = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? "local").slice(0, 7);
  const frontend: ProbeResult = { status: "healthy", summary: `Serving this page (build ${version}).`, lastSuccessAt: new Date().toISOString(), metrics: { build: version, region: process.env.VERCEL_REGION ?? "local" } };
  const api: ProbeResult = { status: db.status === "failed" ? "failed" : "healthy", summary: db.status === "failed" ? "Answering, but the database is unreachable." : "Answered this status request.", lastSuccessAt: new Date().toISOString() };
  const [users, lastLogin] = await Promise.all([prisma.user.count(), prisma.auditLog.findFirst({ where: { action: { startsWith: "auth." } }, orderBy: { createdAt: "desc" } })]);
  const auth: ProbeResult = { status: "healthy", summary: `Session valid; ${users} user account(s), ${brandIds.length} brand(s) owned by you. Organizations and roles are not built yet.`, lastSuccessAt: iso(lastLogin?.createdAt) ?? new Date().toISOString(), credentials: [{ name: "AUTH_SECRET", configured: Boolean(process.env.AUTH_SECRET) }, { name: "TOKEN_ENCRYPTION_KEY", configured: Boolean(process.env.TOKEN_ENCRYPTION_KEY) }], metrics: { users, brands: brandIds.length } };

  // --- security path: the same records the Security Center reports -----------------------------
  const sec = await getSecurityOverview(userId, null);
  const control = (...ids: string[]): ProbeResult => {
    const found = sec.controls.filter((c) => ids.includes(c.id));
    const rank: Record<ControlState, number> = { action: 4, attention: 3, unknown: 2, not_built: 1, ok: 0 };
    const worst = found.sort((x, y) => rank[y.state] - rank[x.state])[0];
    if (!worst) return { status: "disabled", summary: "No record." };
    const status: LiveStatus = worst.state === "ok" ? "healthy" : worst.state === "attention" ? "warning" : worst.state === "action" ? "failed" : worst.state === "unknown" ? "waiting" : "disabled";
    return { status, summary: found.map((c) => `${c.title}: ${c.detail}`).join(" ").slice(0, 600), lastSuccessAt: status === "healthy" ? sec.at : null, nextStep: worst.state === "ok" ? undefined : worst.action ? `${worst.action} (${worst.href})` : `See ${worst.source}.` };
  };
  const secProbes = { sec_browser: control("browser"), sec_signin: control("password", "signin-limits"), sec_mfa: control("mfa"), sec_session: control("sessions"), sec_connections: control("tokens", "token-expiry", "oauth"), sec_db: control("db-lock"), sec_env: control("environment"), sec_keys: control("server-keys"), sec_webhooks: control("webhooks"), sec_ads: control("ads-write") };

  return { at: new Date().toISOString(), version, probes: { ...secProbes, frontend, auth, api, db, queue, scheduler, ai: aiProbe, publishing, verification, inbox, webhooks, private_replies, ads, media, connections, meta_app, zernio: zernioProbe, analytics, leads, automation_rules } };
}
