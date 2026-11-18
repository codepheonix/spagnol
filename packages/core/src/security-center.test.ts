/** The Security Center must report records, not reassurance. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.AUTH_SECRET ??= randomBytes(32).toString("base64");

const { prisma } = await import("@sm/db");
const { getSecurityOverview } = await import("./security-center.js");
const { getArchitectureStatus } = await import("./architecture/status.js");
const { DIAGRAMS } = await import("./architecture/diagrams.js");

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch {
  dbOk = false;
}
const run = Date.now().toString(36);

describe.skipIf(!dbOk)("security overview", () => {
  let me = "";
  let other = "";
  beforeAll(async () => {
    me = (await prisma.user.create({ data: { email: `sec-${run}@example.com`, passwordHash: "x" } })).id;
    other = (await prisma.user.create({ data: { email: `sec-other-${run}@example.com`, passwordHash: "x" } })).id;
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ZzNoRls_${run}"`);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: [me, other] } }, { details: { path: ["run"], equals: run } }] } });
    await prisma.user.deleteMany({ where: { id: { in: [me, other] } } });
  });

  it("states what is owed and never dresses up a missing control as safe", async () => {
    const o = await getSecurityOverview(me, null);
    const by = (id: string) => o.controls.find((c) => c.id === id)!;
    expect(by("password").state).toBe("action"); // this account's password predates change tracking
    expect(by("mfa").state).not.toBe("ok");
    for (const id of ["roles", "rate-limits", "ai-guard", "ads-limits", "incidents"]) expect(by(id).state, id).toBe("not_built");
    expect(by("backups").state).not.toBe("ok");
    expect(by("scans").state).toBe("unknown"); // results live on GitHub; the app cannot see them
    expect(o.counts.ok + o.counts.attention + o.counts.action + o.counts.notBuilt + o.counts.unknown).toBe(o.controls.length);
    for (const c of o.controls) expect(c.detail.length, c.id).toBeGreaterThan(10);
  });

  it("counts refused sign-ins from the audit log, exactly", async () => {
    const before = await getSecurityOverview(me, null);
    for (let i = 0; i < 3; i++) await prisma.auditLog.create({ data: { action: "auth.login", outcome: "denied", details: { run, email: "someone@example.com" }, ip: "203.0.113.7" } });
    await prisma.auditLog.create({ data: { action: "auth.login", outcome: "ok", actorUserId: me, details: { run } } });
    const after = await getSecurityOverview(me, null);
    expect(after.signIn.failed24h - before.signIn.failed24h).toBe(3);
    expect(after.signIn.lastSuccessAt).not.toBeNull();
  });

  it("shows this account's events, hides another account's, and leaks no attempted address", async () => {
    await prisma.auditLog.create({ data: { action: "auth.password_change", outcome: "ok", actorUserId: other, details: { run } } });
    const o = await getSecurityOverview(me, null);
    const theirs = await prisma.auditLog.findMany({ where: { actorUserId: other }, select: { id: true } });
    expect(o.events.some((e) => theirs.some((t) => t.id === e.id))).toBe(false);
    expect(JSON.stringify(o.events)).not.toContain("someone@example.com");
    expect(o.events.length).toBeLessThanOrEqual(40);
  });

  it("notices at once when a table is open: the database control turns to 'act now'", async () => {
    expect((await getSecurityOverview(me, null)).controls.find((c) => c.id === "db-lock")!.state).toBe("ok");
    await prisma.$executeRawUnsafe(`CREATE TABLE "ZzNoRls_${run}" (id int)`);
    const open = (await getSecurityOverview(me, null)).controls.find((c) => c.id === "db-lock")!;
    expect(open.state).toBe("action");
    expect(open.detail).toContain("1 without row level security");
    await prisma.$executeRawUnsafe(`DROP TABLE "ZzNoRls_${run}"`);
  });

  it("feeds the security path diagram: every node with a probe gets a status, planned nodes never do", async () => {
    const { probes } = await getArchitectureStatus(me);
    const d = DIAGRAMS.find((x) => x.id === "security")!;
    for (const n of d.nodes) {
      if (n.probe) expect(probes[n.probe]?.status, n.id).toBeTruthy();
      if (n.state === "planned") expect(n.probe, n.id).toBeUndefined();
    }
    expect(probes.sec_signin.status).toBe("failed"); // the password change is owed
    expect(probes.sec_db.status).toBe("healthy");
  });
});
