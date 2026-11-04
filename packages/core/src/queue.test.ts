/**
 * Integration tests against a real PostgreSQL (DATABASE_URL). Skipped when no database is reachable.
 * They prove: durable enqueue, SKIP LOCKED claiming, retry with backoff, dead-lettering,
 * orphan-lock recovery (worker restart) and brand isolation of the data model.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.AUTH_SECRET ??= randomBytes(32).toString("base64");

const { prisma } = await import("@sm/db");
const q = await import("./queue.js");
const { registerAllHandlers } = await import("./handlers.js");
const { localToUtc, nextAvailableSlot } = await import("./schedule.js");

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch {
  dbOk = false;
}

describe.skipIf(!dbOk)("postgres job queue", () => {
  beforeAll(async () => {
    registerAllHandlers();
    await prisma.job.deleteMany({ where: { type: { startsWith: "test_" } } });
    await prisma.job.deleteMany({ where: { type: "noop_permanent_fail" } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("enqueues, claims once, and records the result", async () => {
    const job = await q.enqueue("test_echo", { hello: "world" }, { dedupeKey: `test:echo:${Date.now()}` });
    const claimedA = await q.claimJobs("worker-a", 10);
    const claimedB = await q.claimJobs("worker-b", 10);
    expect(claimedA.some((j) => j.id === job.id)).toBe(true);
    expect(claimedB.some((j) => j.id === job.id)).toBe(false); // SKIP LOCKED + status flip prevents double claim
    for (const j of claimedA) await q.runJob(j, "worker-a");
    const done = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("succeeded");
    expect((done.result as { echoed: { hello: string } }).echoed.hello).toBe("world");
  });

  it("retries transient failures with backoff and then succeeds", async () => {
    const job = await q.enqueue("test_fail_once", {}, { dedupeKey: `test:failonce:${Date.now()}`, maxAttempts: 3 });
    await q.processDueJobs("w", 10);
    let row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(row.runAt.getTime()).toBeGreaterThan(Date.now());
    await prisma.job.update({ where: { id: job.id }, data: { runAt: new Date(Date.now() - 1000) } }); // fast-forward
    await q.processDueJobs("w", 10);
    row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("succeeded");
  });

  it("dead-letters permanent failures and allows manual retry", async () => {
    const job = await q.enqueue("noop_permanent_fail", {}, { dedupeKey: `test:perm:${Date.now()}` });
    await q.processDueJobs("w", 10);
    let row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("dead");
    await q.retryDeadJob(job.id);
    row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("queued");
    await q.processDueJobs("w", 10);
  });

  it("reclaims jobs orphaned by a crashed worker (restart survival)", async () => {
    const job = await q.enqueue("test_echo", { restart: true }, { dedupeKey: `test:orphan:${Date.now()}` });
    await prisma.job.update({ where: { id: job.id }, data: { status: "running", lockedBy: "dead-worker", lockedAt: new Date(Date.now() - 3 * 3600_000) } });
    const reclaimed = await q.reapOrphanedJobs();
    expect(reclaimed).toBeGreaterThanOrEqual(1);
    await q.processDueJobs("w2", 10);
    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("succeeded");
  });

  it("dedupeKey prevents duplicate queued jobs", async () => {
    const key = `test:dedupe:${Date.now()}`;
    const a = await q.enqueue("test_echo", {}, { dedupeKey: key, runAt: new Date(Date.now() + 3600_000) });
    const b = await q.enqueue("test_echo", {}, { dedupeKey: key, runAt: new Date(Date.now() + 3600_000) });
    expect(a.id).toBe(b.id);
    await q.cancelJob(a.id);
  });
});

describe.skipIf(!dbOk)("brand isolation", () => {
  it("two brands cannot see each other's accounts/posts through brand-scoped queries", async () => {
    const { hashPassword } = await import("@sm/security");
    const suffix = Date.now();
    const u1 = await prisma.user.create({ data: { email: `iso1-${suffix}@test.local`, passwordHash: await hashPassword("passwordpassword") } });
    const u2 = await prisma.user.create({ data: { email: `iso2-${suffix}@test.local`, passwordHash: await hashPassword("passwordpassword") } });
    const b1 = await prisma.brand.create({ data: { ownerId: u1.id, name: "B1", slug: "b1" } });
    const b2 = await prisma.brand.create({ data: { ownerId: u2.id, name: "B2", slug: "b2" } });
    const acc = await prisma.socialAccount.create({ data: { brandId: b1.id, provider: "telegram", externalAccountId: "-100", displayName: "T" } });
    const post = await prisma.post.create({ data: { brandId: b1.id, body: "hi" } });
    const { getPost } = await import("./posts.js");
    await expect(getPost(u2.id, post.id)).rejects.toThrow(/not found/i);
    await expect(getPost(u1.id, post.id)).resolves.toBeTruthy();
    const { createPost } = await import("./posts.js");
    await expect(createPost(u2.id, b2.id, { body: "x", tags: [], mediaIds: [], targets: [{ socialAccountId: acc.id, overrides: {} }] })).rejects.toThrow(/do not belong/);
    await prisma.user.deleteMany({ where: { id: { in: [u1.id, u2.id] } } });
  });
});

describe("schedule helpers", () => {
  it("converts Rome wall time to UTC across DST", () => {
    expect(localToUtc("2026-07-01", "10:00", "Europe/Rome").toISOString()).toBe("2026-07-01T08:00:00.000Z"); // CEST
    expect(localToUtc("2026-12-01", "10:00", "Europe/Rome").toISOString()).toBe("2026-12-01T09:00:00.000Z"); // CET
  });
  it("finds the next weekly slot", () => {
    const from = new Date("2026-11-04T12:00:00Z"); // Wednesday
    const next = nextAvailableSlot([{ weekday: 5, time: "09:30", timezone: "Europe/Rome" }], from, new Set());
    expect(next?.toISOString()).toBe("2026-11-06T08:30:00.000Z");
  });
});
