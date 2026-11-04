/**
 * Always-on worker: polls the Postgres job queue. Run it on any Node host (your Mac, a VPS,
 * Railway/Fly/Render) with the same DATABASE_URL as the web app. Safe to run several copies.
 */
import "dotenv/config";
import { hostname } from "node:os";
import { prisma } from "@sm/db";
import { enqueue, logger, processDueJobs, queueStats, registerAllHandlers } from "@sm/core";

const workerId = `${hostname()}-${process.pid}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const BATCH = Number(process.env.WORKER_BATCH ?? 5);
let stopping = false;

async function heartbeat() {
  await prisma.systemSetting.upsert({ where: { key: `worker.heartbeat.${workerId}` }, create: { key: `worker.heartbeat.${workerId}`, value: { at: new Date().toISOString(), pid: process.pid } }, update: { value: { at: new Date().toISOString(), pid: process.pid } } });
}

async function main() {
  registerAllHandlers();
  await prisma.$queryRaw`SELECT 1`;
  await enqueue("periodic_sync", { intervalMinutes: 60 }, { dedupeKey: `periodic_sync:${Math.floor(Date.now() / 3_600_000) + 1}`, runAt: new Date(Date.now() + 60_000) });
  logger.info({ workerId, pollMs: POLL_MS }, "worker started");
  let tick = 0;
  while (!stopping) {
    try {
      const n = await processDueJobs(workerId, BATCH);
      if (tick++ % 12 === 0) {
        await heartbeat();
        logger.debug(await queueStats(), "queue stats");
      }
      if (n === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      logger.error({ err: (err as Error).message }, "worker loop error");
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  await prisma.$disconnect();
  logger.info("worker stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));
main().catch((err) => {
  logger.fatal({ err: (err as Error).message }, "worker crashed");
  process.exit(1);
});
