/**
 * Durable job queue on PostgreSQL.
 *
 * Design: jobs live in the `Job` table. Workers claim due jobs transactionally with
 * `FOR UPDATE SKIP LOCKED`, so several workers (or serverless ticks) never run the same job twice.
 * Retries use exponential backoff with jitter and honour provider `Retry-After`. A job whose lock
 * is older than LOCK_TTL is considered orphaned (worker crash) and is re-queued, so work survives
 * restarts. Permanently failed jobs become `dead` (dead-letter) and can be retried manually.
 *
 * This replaces Redis/BullMQ: same durability guarantees for this scale, one fewer paid service,
 * and it runs on serverless hosts through `/api/jobs/tick`.
 */
import { prisma, type Job, type Prisma } from "@sm/db";
import { logger } from "./logger";

export type JobHandler = (job: Job, ctx: { workerId: string }) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();
const LOCK_TTL_MS = Number(process.env.JOB_LOCK_TTL_MS ?? 10 * 60_000);

export function registerJobHandler(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()];
}

export class RetryableJobError extends Error {
  constructor(
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "RetryableJobError";
  }
}

export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export interface EnqueueOptions {
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
  priority?: number;
  brandId?: string;
}

export async function enqueue(type: string, payload: Prisma.InputJsonValue, opts: EnqueueOptions = {}): Promise<Job> {
  if (opts.dedupeKey) {
    const existing = await prisma.job.findUnique({ where: { dedupeKey: opts.dedupeKey } });
    if (existing && (existing.status === "queued" || existing.status === "running")) return existing;
    if (existing) {
      // Re-use the row for a fresh run (e.g. manual retry) to keep the dedupe key unique.
      return prisma.job.update({
        where: { id: existing.id },
        data: { type, payload, status: "queued", runAt: opts.runAt ?? new Date(), attempts: 0, lastError: null, lockedAt: null, lockedBy: null, finishedAt: null, result: undefined, maxAttempts: opts.maxAttempts ?? existing.maxAttempts, priority: opts.priority ?? existing.priority },
      });
    }
  }
  return prisma.job.create({
    data: { type, payload, runAt: opts.runAt ?? new Date(), dedupeKey: opts.dedupeKey, maxAttempts: opts.maxAttempts ?? 5, priority: opts.priority ?? 0, brandId: opts.brandId },
  });
}

export async function cancelJob(id: string): Promise<void> {
  await prisma.job.updateMany({ where: { id, status: { in: ["queued", "running"] } }, data: { status: "canceled", finishedAt: new Date() } });
}

export async function cancelJobsByDedupePrefix(prefix: string): Promise<number> {
  const r = await prisma.job.updateMany({ where: { dedupeKey: { startsWith: prefix }, status: "queued" }, data: { status: "canceled", finishedAt: new Date() } });
  return r.count;
}

/** Claims up to `limit` due jobs atomically. */
export async function claimJobs(workerId: string, limit = 5): Promise<Job[]> {
  const rows = await prisma.$queryRaw<Job[]>`
    UPDATE "Job" SET status = 'running', "lockedAt" = now(), "lockedBy" = ${workerId}, attempts = attempts + 1, "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE status = 'queued' AND "runAt" <= now()
      ORDER BY priority DESC, "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
  return rows;
}

/** Re-queues jobs whose worker died while holding the lock. */
export async function reapOrphanedJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - LOCK_TTL_MS);
  const r = await prisma.job.updateMany({ where: { status: "running", lockedAt: { lt: cutoff } }, data: { status: "queued", lockedAt: null, lockedBy: null, lastError: "orphaned lock reclaimed" } });
  if (r.count) logger.warn({ count: r.count }, "reclaimed orphaned jobs");
  return r.count;
}

function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds) return retryAfterSeconds * 1000 + Math.random() * 1000;
  const base = Math.min(30 * 60_000, 15_000 * 2 ** (attempt - 1));
  return base + Math.random() * base * 0.25; // jitter
}

export async function runJob(job: Job, workerId: string): Promise<void> {
  const handler = handlers.get(job.type);
  const log = logger.child({ jobId: job.id, type: job.type, attempt: job.attempts });
  if (!handler) {
    await prisma.job.update({ where: { id: job.id }, data: { status: "dead", lastError: `no handler for ${job.type}`, finishedAt: new Date() } });
    log.error("no handler registered");
    return;
  }
  try {
    const result = await handler(job, { workerId });
    await prisma.job.update({ where: { id: job.id }, data: { status: "succeeded", finishedAt: new Date(), result: (result as Prisma.InputJsonValue) ?? undefined, lockedAt: null, lockedBy: null } });
    log.info("job succeeded");
  } catch (err) {
    const e = err as Error & { retryAfterSeconds?: number; options?: { retryable?: boolean; retryAfterSeconds?: number } };
    const permanent = e instanceof PermanentJobError || (e.options && e.options.retryable === false);
    const retryAfter = e instanceof RetryableJobError ? e.retryAfterSeconds : e.options?.retryAfterSeconds;
    const exhausted = job.attempts >= job.maxAttempts;
    if (permanent || exhausted) {
      await prisma.job.update({ where: { id: job.id }, data: { status: "dead", lastError: e.message.slice(0, 2000), finishedAt: new Date(), lockedAt: null, lockedBy: null } });
      log.error({ err: e.message, permanent, exhausted }, "job dead-lettered");
    } else {
      const runAt = new Date(Date.now() + backoffMs(job.attempts, retryAfter));
      await prisma.job.update({ where: { id: job.id }, data: { status: "queued", runAt, lastError: e.message.slice(0, 2000), lockedAt: null, lockedBy: null } });
      log.warn({ err: e.message, runAt }, "job failed, retry scheduled");
    }
  }
}

/** One processing pass: reap orphans, claim due jobs, run them. Returns the number processed. */
export async function processDueJobs(workerId: string, limit = 5): Promise<number> {
  await reapOrphanedJobs();
  const jobs = await claimJobs(workerId, limit);
  for (const job of jobs) await runJob(job, workerId);
  return jobs.length;
}

export async function retryDeadJob(id: string): Promise<Job> {
  return prisma.job.update({ where: { id }, data: { status: "queued", runAt: new Date(), attempts: 0, lastError: null, finishedAt: null } });
}

export interface QueueStats {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  dead: number;
  canceled: number;
  oldestDueAt: Date | null;
  lagSeconds: number;
}

export async function queueStats(): Promise<QueueStats> {
  const rows = await prisma.job.groupBy({ by: ["status"], _count: { _all: true } });
  const out = { queued: 0, running: 0, succeeded: 0, failed: 0, dead: 0, canceled: 0 };
  for (const r of rows) out[r.status] = r._count._all;
  const oldestDue = await prisma.job.findFirst({ where: { status: "queued", runAt: { lte: new Date() } }, orderBy: { runAt: "asc" }, select: { runAt: true } });
  return { ...out, oldestDueAt: oldestDue?.runAt ?? null, lagSeconds: oldestDue ? Math.round((Date.now() - oldestDue.runAt.getTime()) / 1000) : 0 };
}
