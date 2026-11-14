/** Registers every job handler. Imported by the worker and by the serverless tick endpoint. */
import { prisma } from "@sm/db";
import { registerJobHandler, enqueue, PermanentJobError } from "./queue";
import { publishTargetJob, reconcileTargetJob, rollupPostStatus } from "./posts";
import { checkAccountHealth } from "./connections";
import { syncAccountAnalytics } from "./analytics";
import { syncComments, syncInbox } from "./inbox";
import { processWebhookEventJob } from "./webhooks";
import { cleanupOrphanMedia } from "./media";
import { syncAdAccounts } from "./ads";

let registered = false;

export function registerAllHandlers(): void {
  if (registered) return;
  registered = true;

  registerJobHandler("test_echo", async (job) => ({ echoed: job.payload, at: new Date().toISOString() }));
  registerJobHandler("test_fail_once", async (job) => {
    if (job.attempts < 2) throw new Error("transient failure (expected)");
    return { recoveredOnAttempt: job.attempts };
  });

  registerJobHandler("publish_target", async (job) => publishTargetJob(String((job.payload as { postTargetId: string }).postTargetId)));
  registerJobHandler("reconcile_target", async (job) => reconcileTargetJob(String((job.payload as { postTargetId: string }).postTargetId)));
  registerJobHandler("check_account_health", async (job) => {
    const a = await checkAccountHealth(String((job.payload as { socialAccountId: string }).socialAccountId));
    return { status: a.status, health: a.healthStatus };
  });
  registerJobHandler("sync_analytics", async (job) => syncAccountAnalytics(String((job.payload as { socialAccountId: string }).socialAccountId)));
  registerJobHandler("sync_comments", async (job) => syncComments(String((job.payload as { socialAccountId: string }).socialAccountId)));
  registerJobHandler("sync_inbox", async (job) => syncInbox(String((job.payload as { socialAccountId: string }).socialAccountId)));
  registerJobHandler("sync_ads", async (job) => syncAdAccounts(String((job.payload as { brandId: string }).brandId)));
  registerJobHandler("process_webhook_event", async (job) => {
    const p = job.payload as { provider: string; providerEventId: string };
    return processWebhookEventJob(p.provider, p.providerEventId);
  });
  registerJobHandler("cleanup_media", async () => ({ removed: await cleanupOrphanMedia() }));

  /** Periodic fan-out: health + analytics + inbox for every connected account; also re-arms itself. */
  registerJobHandler("periodic_sync", async (job) => {
    const accounts = await prisma.socialAccount.findMany({ where: { status: "connected" } });
    const hour = Math.floor(Date.now() / 3_600_000);
    for (const a of accounts) {
      // Time-bucketed keys run once per bucket, however often the tick fires.
      await enqueue("check_account_health", { socialAccountId: a.id }, { dedupeKey: `health:${a.id}:${Math.floor(hour / 6)}`, brandId: a.brandId, once: true });
      await enqueue("sync_analytics", { socialAccountId: a.id }, { dedupeKey: `analytics:${a.id}:${Math.floor(hour / 6)}`, brandId: a.brandId, once: true });
      await enqueue("sync_comments", { socialAccountId: a.id }, { dedupeKey: `comments:${a.id}:${hour}`, brandId: a.brandId, once: true });
      await enqueue("sync_inbox", { socialAccountId: a.id }, { dedupeKey: `inbox:${a.id}:${hour}`, brandId: a.brandId, once: true });
    }
    // Catch targets stuck in processing without a reconcile job.
    const stuck = await prisma.postTarget.findMany({ where: { status: "processing", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, take: 50 });
    for (const t of stuck) await enqueue("reconcile_target", { postTargetId: t.id }, { dedupeKey: `reconcile:${t.id}`, maxAttempts: 20 });
    // Targets left mid-flight whose job is gone (retries exhausted during a check, or a lost row):
    // waiting ones are re-queued (the publish job checks the network before re-sending); the rest stop
    // pretending to retry and ask for a manual Retry.
    const limbo = await prisma.postTarget.findMany({ where: { status: { in: ["queued", "uploading", "failed_retryable"] }, updatedAt: { lt: new Date(Date.now() - 30 * 60_000) } }, include: { post: { select: { brandId: true, scheduledAt: true } } }, take: 100 });
    for (const t of limbo) {
      if (t.post.scheduledAt && t.post.scheduledAt.getTime() > Date.now()) continue;
      const j = await prisma.job.findUnique({ where: { dedupeKey: `publish:${t.id}` } });
      if (j && (j.status === "queued" || j.status === "running")) continue;
      if (t.status === "failed_retryable") {
        await prisma.postTarget.update({ where: { id: t.id }, data: { status: "failed_permanent", lastError: `${t.lastError ?? "Publishing failed."} Automatic retries are used up — press Retry.` } });
        await rollupPostStatus(t.postId);
      } else await enqueue("publish_target", { postTargetId: t.id }, { dedupeKey: `publish:${t.id}`, maxAttempts: 6, priority: 10, brandId: t.post.brandId });
    }
    const interval = Number((job.payload as { intervalMinutes?: number }).intervalMinutes ?? 60);
    await enqueue("periodic_sync", { intervalMinutes: interval }, { runAt: new Date(Date.now() + interval * 60_000), dedupeKey: `periodic_sync:${hour + 1}`, once: true });
    // Housekeeping: finished job rows and used sign-in states are only history after a week.
    const pruned = await prisma.job.deleteMany({ where: { status: { in: ["succeeded", "canceled"] }, finishedAt: { lt: new Date(Date.now() - 7 * 24 * 3600_000) } } });
    await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 24 * 3600_000) } } });
    return { accounts: accounts.length, stuck: stuck.length, prunedJobs: pruned.count };
  });

  registerJobHandler("noop_permanent_fail", async () => {
    throw new PermanentJobError("always fails (test)");
  });
}
