/** Workspaces: creation, the three kinds, archive/restore, and isolation between two users. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

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
const emails = [`ws-a-${run}@example.com`, `ws-b-${run}@example.com`];
let a: { id: string };
let b: { id: string };

describe.skipIf(!dbOk)("workspaces", () => {
  beforeAll(async () => {
    a = await prisma.user.create({ data: { email: emails[0]!, passwordHash: "x" } });
    b = await prisma.user.create({ data: { email: emails[1]!, passwordHash: "x" } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("starts empty: a new user has no workspace and nothing preselected", async () => {
    expect(await core.listWorkspaces(a.id)).toEqual([]);
    expect(await core.listAllAccounts(a.id)).toEqual([]);
  });

  it("creates personal, business and client workspaces with their profile", async () => {
    const me = await core.createWorkspace(a.id, { name: "My accounts", kind: "personal" });
    const co = await core.createWorkspace(a.id, { name: "Acme Studio", kind: "business", industry: "Design", country: "Italy", websiteUrl: "https://acme.example", brandVoice: "Plain and warm", targetAudience: "Architects" });
    const cl = await core.createWorkspace(a.id, { name: "Acme Studio", kind: "client" });
    expect(me.kind).toBe("personal");
    expect(co.industry).toBe("Design");
    expect(cl.slug).not.toBe(co.slug); // same name twice gets its own slug
    const list = await core.listWorkspaces(a.id);
    expect(list.map((w) => w.kind)).toEqual(["personal", "business", "client"]);
    expect(list.every((w) => w.accounts === 0 && w.scheduledPosts === 0)).toBe(true);
  });

  it("rejects an unknown kind and an empty name", async () => {
    await expect(core.createWorkspace(a.id, { name: "x", kind: "agency" as never })).rejects.toThrow();
    await expect(core.createWorkspace(a.id, { name: "   ", kind: "personal" })).rejects.toThrow();
  });

  it("keeps two users' workspaces and accounts apart", async () => {
    const mine = (await core.listWorkspaces(a.id))[1]!;
    const theirs = await core.createWorkspace(b.id, { name: "Other Co", kind: "business" });
    await prisma.socialAccount.create({ data: { brandId: mine.id, provider: "instagram", backend: "native", externalAccountId: `A${run}`, displayName: "acme.ig", accountType: "professional" } });
    await prisma.socialAccount.create({ data: { brandId: theirs.id, provider: "instagram", backend: "native", externalAccountId: `B${run}`, displayName: "other.ig", accountType: "professional" } });
    const rowsA = await core.listAllAccounts(a.id);
    const rowsB = await core.listAllAccounts(b.id);
    expect(rowsA.map((r) => r.displayName)).toEqual(["acme.ig"]);
    expect(rowsB.map((r) => r.displayName)).toEqual(["other.ig"]);
    // asking for someone else's workspace returns nothing, and it cannot be edited
    expect(await core.listAllAccounts(a.id, { workspaceId: theirs.id })).toEqual([]);
    await expect(core.updateWorkspace(a.id, theirs.id, { name: "taken" })).rejects.toThrow();
    expect((await prisma.brand.findUnique({ where: { id: theirs.id } }))?.name).toBe("Other Co");
  });

  it("reports unknown values as unknown, not as zero or no", async () => {
    const [row] = await core.listAllAccounts(a.id);
    expect(row!.followers).toBeNull(); // no follower count received
    expect(row!.canPublish).toBeNull(); // capabilities not checked yet
    expect(row!.adsEligible).toBe(false);
    expect(core.summarizeAccounts([row!])).toMatchObject({ total: 1, business: 1, personal: 0, needReconnect: 0 });
  });

  it("filters by platform, workspace kind and status", async () => {
    expect((await core.listAllAccounts(a.id, { provider: "facebook" })).length).toBe(0);
    expect((await core.listAllAccounts(a.id, { kind: "personal" })).length).toBe(0);
    expect((await core.listAllAccounts(a.id, { kind: "business" })).length).toBe(1);
    expect((await core.listAllAccounts(a.id, { status: "needs_reconnect" })).length).toBe(0);
  });

  it("archiving hides a workspace and its accounts without deleting them; restoring brings them back", async () => {
    const co = (await core.listWorkspaces(a.id))[1]!;
    await core.updateWorkspace(a.id, co.id, { archived: true });
    expect((await core.listWorkspaces(a.id)).some((w) => w.id === co.id)).toBe(false);
    expect(await core.listAllAccounts(a.id)).toEqual([]);
    expect(await prisma.socialAccount.count({ where: { brandId: co.id } })).toBe(1); // kept
    expect((await core.listWorkspaces(a.id, { includeArchived: true })).find((w) => w.id === co.id)?.archived).toBe(true);
    await core.updateWorkspace(a.id, co.id, { archived: false });
    expect((await core.listAllAccounts(a.id)).length).toBe(1);
  });
});
