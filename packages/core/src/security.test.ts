/**
 * Security regression tests for the Step 1 fixes. Each block tries the attack and expects refusal,
 * then the legitimate path and expects it to keep working.
 *   1. Database: row level security is on for every table and blocks a role that was (wrongly)
 *      given privileges — the exact situation that exposed one table to the public data API.
 *   2. Zernio webhook: closed without a secret; unsigned / wrongly signed deliveries are refused;
 *      a correctly signed one is accepted once.
 *   3. Sign-in throttle: counters shared through the database, per address + account, per address,
 *      per account; success clears; windows expire; concurrent failures are all counted.
 * The sign-in return check (browser session + workspace) is covered in meta-flow.test.ts and
 * workspace isolation in workspaces.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";

process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.AUTH_SECRET ??= randomBytes(32).toString("base64");

const { prisma } = await import("@sm/db");
const core = await import("./index.js");

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch {
  dbOk = false;
}
const run = Date.now().toString(36);

describe.skipIf(!dbOk)("database: nothing is reachable around the application", () => {
  const role = `probe_${run}`;
  let canCreateRole = false;
  let userId = "";
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `rls-${run}@example.com`, passwordHash: "x" } })).id;
    try {
      await prisma.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
      // Reproduce the mistake: hand the outside role full privileges on two tables.
      await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await prisma.$executeRawUnsafe(`GRANT ALL ON "User", "PrivateReply" TO ${role}`);
      canCreateRole = true;
    } catch {
      canCreateRole = false; // a database user that may not create roles: the structural test below still runs
    }
  });
  afterAll(async () => {
    if (canCreateRole) {
      await prisma.$executeRawUnsafe(`REVOKE ALL ON "User", "PrivateReply" FROM ${role}`).catch(() => undefined);
      await prisma.$executeRawUnsafe(`REVOKE USAGE ON SCHEMA public FROM ${role}`).catch(() => undefined);
      await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
    }
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("has row level security enabled on every table (a new table without it fails this test)", async () => {
    const open = await prisma.$queryRaw<Array<{ relname: string }>>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY 1`;
    expect(open.map((r) => r.relname)).toEqual([]);
  });

  it("gives the platform's public roles no privilege on any table (when those roles exist)", async () => {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`;
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it("an outside role sees no rows and cannot write, even with privileges granted by mistake", async (ctx) => {
    if (!canCreateRole) return ctx.skip();
    const seen = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      const r = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "User"`;
      return Number(r[0]!.n);
    });
    expect(seen).toBe(0); // rows exist (one was just created) but none is visible
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        await tx.$executeRawUnsafe(`INSERT INTO "User" ("id", "email", "passwordHash", "updatedAt") VALUES ('probe-${run}', 'probe-${run}@example.com', 'x', now())`);
      }),
    ).rejects.toThrow(/row-level security/i);
    const changed = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      return tx.$executeRawUnsafe(`UPDATE "User" SET "name" = 'taken over'`);
    });
    expect(changed).toBe(0);
    const removed = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      return tx.$executeRawUnsafe(`DELETE FROM "User"`);
    });
    expect(removed).toBe(0);
    // The application itself still reads and writes normally.
    expect((await prisma.user.findUnique({ where: { id: userId } }))?.name).toBeNull();
    expect(await prisma.user.count({ where: { id: `probe-${run}` } })).toBe(0);
  });
});

describe.skipIf(!dbOk)("Zernio webhook: signed deliveries only", () => {
  const secret = `whsec_${randomBytes(12).toString("hex")}`;
  const body = (id: string) => JSON.stringify({ id, type: "post.published", data: {} });
  const sign = (raw: string, key = secret) => createHmac("sha256", key).update(raw).digest("hex");
  const saved = { key: process.env.ZERNIO_API_KEY, secret: process.env.ZERNIO_WEBHOOK_SECRET };
  let dbConfigured = false;
  beforeAll(async () => {
    dbConfigured = Boolean(await core.getSecretSetting("zernio.apiKey")) || Boolean(await core.getSecretSetting("zernio.webhookSecret"));
  });
  afterAll(async () => {
    process.env.ZERNIO_API_KEY = saved.key;
    process.env.ZERNIO_WEBHOOK_SECRET = saved.secret;
    if (saved.key === undefined) delete process.env.ZERNIO_API_KEY;
    if (saved.secret === undefined) delete process.env.ZERNIO_WEBHOOK_SECRET;
    await prisma.webhookEvent.deleteMany({ where: { provider: "zernio", providerEventId: { startsWith: `sec-${run}` } } });
    await prisma.job.deleteMany({ where: { dedupeKey: { startsWith: `webhook:zernio:sec-${run}` } } });
  });
  const stored = (id: string) => prisma.webhookEvent.count({ where: { provider: "zernio", providerEventId: id } });

  it("is closed when no webhook secret is configured: nothing is stored", async (ctx) => {
    if (dbConfigured) return ctx.skip(); // this database has a real Zernio configuration; do not touch it
    delete process.env.ZERNIO_API_KEY;
    delete process.env.ZERNIO_WEBHOOK_SECRET;
    const raw = body(`sec-${run}-1`);
    expect((await core.ingestZernioWebhook({ rawBody: raw, headers: { "x-zernio-event-id": `sec-${run}-1`, "x-zernio-signature": sign(raw) } })).status).toBe("disabled");
    process.env.ZERNIO_API_KEY = "test-key"; // a key without a webhook secret is still closed
    expect((await core.ingestZernioWebhook({ rawBody: raw, headers: { "x-zernio-event-id": `sec-${run}-1` } })).status).toBe("disabled");
    expect(await stored(`sec-${run}-1`)).toBe(0);
  });

  it("refuses a missing or wrong signature, accepts a correct one once, and treats a replay as a duplicate", async (ctx) => {
    if (dbConfigured) return ctx.skip();
    process.env.ZERNIO_API_KEY = "test-key";
    process.env.ZERNIO_WEBHOOK_SECRET = secret;
    const id = `sec-${run}-2`;
    const raw = body(id);
    const h = (signature?: string) => ({ "x-zernio-event-id": id, "x-zernio-event": "post.published", "x-zernio-signature": signature });
    expect(await core.ingestZernioWebhook({ rawBody: raw, headers: h() })).toMatchObject({ status: "rejected", reason: "missing signature" });
    expect(await core.ingestZernioWebhook({ rawBody: raw, headers: h(sign(raw, "another-secret")) })).toMatchObject({ status: "rejected", reason: "bad signature" });
    expect(await core.ingestZernioWebhook({ rawBody: raw.replace("published", "failed"), headers: h(sign(raw)) })).toMatchObject({ status: "rejected" }); // body changed after signing
    expect(await stored(id)).toBe(0);
    expect((await core.ingestZernioWebhook({ rawBody: raw, headers: h(sign(raw)) })).status).toBe("stored");
    expect((await core.ingestZernioWebhook({ rawBody: raw, headers: h(sign(raw)) })).status).toBe("duplicate");
    expect(await stored(id)).toBe(1);
  });
});

describe.skipIf(!dbOk)("sign-in throttle shared through the database", () => {
  const email = `throttle-${run}@example.com`;
  const ip = `203.0.113.${(Date.now() % 200) + 1}`;
  const other = `198.51.100.${(Date.now() % 200) + 1}`;
  afterAll(async () => {
    await prisma.authThrottle.deleteMany({ where: { updatedAt: { gte: new Date(Date.now() - 6 * 3600_000) }, failures: { gte: 0 } } });
  });

  it("allows four wrong attempts and blocks from the fifth, with a wait time", async () => {
    for (let i = 0; i < 4; i++) {
      expect((await core.checkLoginAllowed(email, ip)).allowed).toBe(true);
      await core.recordLoginFailure(email, ip);
    }
    expect((await core.checkLoginAllowed(email, ip)).allowed).toBe(true);
    await core.recordLoginFailure(email, ip); // fifth
    const gate = await core.checkLoginAllowed(email, ip);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.retryAfterSeconds).toBeGreaterThan(14 * 60);
      expect(gate.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    }
  });

  it("does not lock the same account out for someone at another address", async () => {
    expect((await core.checkLoginAllowed(email, other)).allowed).toBe(true);
  });

  it("is case-insensitive about the e-mail and ends the block when its time has passed", async () => {
    expect((await core.checkLoginAllowed(email.toUpperCase(), ip)).allowed).toBe(false);
    expect((await core.checkLoginAllowed(email, ip, new Date(Date.now() + 16 * 60_000))).allowed).toBe(true);
  });

  it("clears the counter for this address after a correct sign-in", async () => {
    const e = `ok-${run}@example.com`;
    for (let i = 0; i < 3; i++) await core.recordLoginFailure(e, other);
    await core.recordLoginSuccess(e, other);
    for (let i = 0; i < 4; i++) await core.recordLoginFailure(e, other);
    expect((await core.checkLoginAllowed(e, other)).allowed).toBe(true); // 4 since the success, not 7
  });

  it("blocks an address that tries many different accounts", async () => {
    const spray = `192.0.2.${(Date.now() % 200) + 1}`;
    for (let i = 0; i < 20; i++) await core.recordLoginFailure(`victim${i}-${run}@example.com`, spray);
    expect((await core.checkLoginAllowed(`someone-new-${run}@example.com`, spray)).allowed).toBe(false);
  });

  it("slows guessing of one account spread over many addresses", async () => {
    const target = `spread-${run}@example.com`;
    for (let i = 0; i < 50; i++) await core.recordLoginFailure(target, `10.${run.length}.${Math.floor(i / 200)}.${i + 1}`);
    expect((await core.checkLoginAllowed(target, "10.99.99.99")).allowed).toBe(false);
  });

  it("counts failures that arrive at the same moment on different servers", async () => {
    const e = `race-${run}@example.com`;
    const a = `10.250.${run.length}.7`;
    await Promise.all(Array.from({ length: 8 }, () => core.recordLoginFailure(e, a)));
    expect((await core.checkLoginAllowed(e, a)).allowed).toBe(false);
  });

  it("starts a fresh count after the window has passed", async () => {
    const e = `window-${run}@example.com`;
    const a = `10.251.${run.length}.9`;
    const longAgo = new Date(Date.now() - 20 * 60_000);
    for (let i = 0; i < 4; i++) await core.recordLoginFailure(e, a, longAgo);
    await core.recordLoginFailure(e, a); // first failure of a new window, not the fifth
    expect((await core.checkLoginAllowed(e, a)).allowed).toBe(true);
  });
});
