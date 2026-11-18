/**
 * Live status and run traces are computed from stored records. These tests check the honest
 * defaults (nothing connected → waiting / disabled, never healthy), that real records move the
 * statuses, that a run trace mirrors the stored attempts, and that one owner cannot read another's runs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.AUTH_SECRET ??= randomBytes(32).toString("base64");
delete process.env.META_APP_ID;
delete process.env.META_APP_SECRET;
delete process.env.AI_API_KEY;
delete process.env.ZERNIO_API_KEY;

const { prisma } = await import("@sm/db");
const core = await import("../index.js");

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch {
  dbOk = false;
}

const stamp = Date.now();
const emails = [`arch-a-${stamp}@example.com`, `arch-b-${stamp}@example.com`];
let a: { id: string };
let b: { id: string };
let brand: { id: string };

describe.skipIf(!dbOk)("architecture live status and traces", () => {
  beforeAll(async () => {
    a = await prisma.user.create({ data: { email: emails[0]!, name: "A", passwordHash: "x" } });
    b = await prisma.user.create({ data: { email: emails[1]!, name: "B", passwordHash: "x" } });
    brand = await prisma.brand.create({ data: { ownerId: a.id, name: "Arch Brand", slug: `arch-${stamp}` } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("reports nothing as healthy that has no evidence", async () => {
    const { probes } = await core.getArchitectureStatus(a.id);
    expect(probes.db.status).toBe("healthy");
    expect(probes.connections.status).toBe("waiting");
    expect(probes.publishing.status).toBe("waiting");
    expect(probes.private_replies.status).toBe("waiting");
    expect(probes.ads.status).toBe("disabled");
    // Credentials are reported by name and boolean only.
    const json = JSON.stringify(probes);
    expect(json).not.toContain(process.env.TOKEN_ENCRYPTION_KEY!);
    expect(json).not.toContain(process.env.AUTH_SECRET!);
    for (const p of Object.values(probes)) for (const c of p.credentials ?? []) expect(Object.keys(c).sort()).toEqual(["configured", "name"]);
  });

  it("every probe used by a diagram exists in the status map", async () => {
    const { probes } = await core.getArchitectureStatus(a.id);
    for (const d of core.DIAGRAMS) for (const n of d.nodes) if (n.probe) expect(probes[n.probe], `${d.id}/${n.id} → ${n.probe}`).toBeDefined();
  });

  it("stored publish attempts drive the publishing status and the run trace", async () => {
    const fb = await prisma.socialAccount.create({ data: { brandId: brand.id, provider: "facebook", backend: "native", externalAccountId: `P${stamp}`, displayName: "Page", metadata: {} } });
    const ig = await prisma.socialAccount.create({ data: { brandId: brand.id, provider: "instagram", backend: "native", externalAccountId: `I${stamp}`, displayName: "Insta", metadata: {} } });
    const post = await prisma.post.create({ data: { brandId: brand.id, body: "Trace me", status: "partial", scheduledAt: new Date(Date.now() - 60_000) } });
    const ok = await prisma.postTarget.create({ data: { postId: post.id, socialAccountId: fb.id, status: "published", remotePostId: "R1", publishedAt: new Date() } });
    await prisma.publishAttempt.create({ data: { postTargetId: ok.id, idempotencyKey: `k1-${stamp}`, attemptNumber: 1, status: "succeeded", remotePostId: "R1", finishedAt: new Date() } });
    const bad = await prisma.postTarget.create({ data: { postId: post.id, socialAccountId: ig.id, status: "failed_permanent", lastError: "(#10) permission" } });
    await prisma.publishAttempt.create({ data: { postTargetId: bad.id, idempotencyKey: `k2-${stamp}`, attemptNumber: 1, status: "failed", error: "(#10) permission", finishedAt: new Date() } });

    const { probes } = await core.getArchitectureStatus(a.id);
    expect(probes.connections.status).toBe("healthy");
    expect(probes.publishing.status).toBe("warning");
    expect(probes.publishing.lastError).toContain("(#10)");
    expect(probes.publishing.retryable).toBe(true);

    const runs = await core.listRuns(a.id, "publishing-learning");
    expect(runs.map((r) => r.id)).toContain(post.id);
    const trace = (await core.traceRun(a.id, "publishing-learning", post.id))!;
    expect(trace.stages.publish!.state).toBe("completed");
    expect(trace.stages.partial!.state).toBe("active");
    expect(trace.stages.retry!.state).toBe("failed");
    expect(trace.stages.knowledge!.state).toBe("skipped"); // not built → never shown as done
    expect(trace.stages.learn!.state).toBe("skipped");
    expect(trace.events.some((e) => e.level === "error" && e.text.includes("(#10)"))).toBe(true);
    // every traced stage is a node of the diagram
    const ids = new Set(core.getDiagram("publishing-learning")!.nodes.map((n) => n.id));
    for (const k of Object.keys(trace.stages)) expect(ids.has(k), k).toBe(true);

    // another owner sees neither the run nor its trace
    expect(await core.listRuns(b.id, "publishing-learning")).toEqual([]);
    expect(await core.traceRun(b.id, "publishing-learning", post.id)).toBeNull();
  });

  it("a handled comment traces through the messaging diagram", async () => {
    const acc = await prisma.socialAccount.findFirstOrThrow({ where: { brandId: brand.id, provider: "instagram" } });
    const sent = await prisma.privateReply.create({ data: { brandId: brand.id, socialAccountId: acc.id, provider: "instagram", externalPostId: "M1", externalCommentId: `c1-${stamp}`, commentText: "CATALOGO", authorName: "cliente", keyword: "CATALOGO", status: "sent", providerMessageId: "m_9", sentAt: new Date(), source: "poll" } });
    const unsure = await prisma.privateReply.create({ data: { brandId: brand.id, socialAccountId: acc.id, provider: "instagram", externalPostId: "M1", externalCommentId: `c2-${stamp}`, commentText: "catalogo", status: "uncertain", error: "timeout", errorCategory: "network", keyword: "CATALOGO" } });
    const t1 = (await core.traceRun(a.id, "messaging-leads", sent.id))!;
    expect(t1.stages.poll!.state).toBe("completed");
    expect(t1.stages.webhook!.state).toBe("skipped");
    expect(t1.stages.send!.state).toBe("completed");
    expect(t1.stages.intent!.state).toBe("skipped");
    const t2 = (await core.traceRun(a.id, "messaging-leads", unsure.id))!;
    expect(t2.stages.send!.state).toBe("failed");
    expect(t2.stages.review!.state).toBe("active");
    const ids = new Set(core.getDiagram("messaging-leads")!.nodes.map((n) => n.id));
    for (const k of Object.keys(t1.stages)) expect(ids.has(k), k).toBe(true);
    const { probes } = await core.getArchitectureStatus(a.id);
    expect(probes.private_replies.status).toBe("warning");
    expect(await core.traceRun(b.id, "messaging-leads", sent.id)).toBeNull();
  });
});
