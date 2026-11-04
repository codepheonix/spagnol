import { prisma } from "@sm/db";
import { enqueue, processDueJobs, registerAllHandlers, queueStats } from "@sm/core";
import { handle, json, requireCronSecret } from "@/lib/api";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Serverless job runner. Call it from Vercel Cron or any external scheduler (cron-job.org, a
 * Mac launchd job, UptimeRobot...) with `Authorization: Bearer $CRON_SECRET`. It drains due jobs
 * for up to ~4 minutes. An always-on worker (apps/worker) does the same without needing a pinger.
 */
async function tick(req: Request) {
  requireCronSecret(req);
  registerAllHandlers();
  const started = Date.now();
  const budgetMs = Number(new URL(req.url).searchParams.get("budgetMs") ?? 240_000);
  const workerId = `tick-${process.env.VERCEL_REGION ?? "local"}-${process.pid}`;
  await enqueue("periodic_sync", { intervalMinutes: 60 }, { dedupeKey: `periodic_sync:${Math.floor(Date.now() / 3_600_000) + 1}`, runAt: new Date() });
  let processed = 0;
  while (Date.now() - started < budgetMs) {
    const n = await processDueJobs(workerId, 5);
    processed += n;
    if (n === 0) break;
  }
  await prisma.systemSetting.upsert({ where: { key: "jobs.lastTick" }, create: { key: "jobs.lastTick", value: { at: new Date().toISOString(), processed, workerId } }, update: { value: { at: new Date().toISOString(), processed, workerId } } });
  return json({ processed, elapsedMs: Date.now() - started, stats: await queueStats() });
}

export const GET = handle(tick);
export const POST = handle(tick);
