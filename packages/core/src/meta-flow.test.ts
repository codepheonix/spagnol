/**
 * Facebook + Instagram flow against a STAND-IN Graph API server (not Meta). It proves the app's own
 * logic — sign-in state handling, choosing accounts per brand, encrypted tokens, scheduled sending,
 * per-account results, retrying one account only, and checking the network before re-sending after
 * an interrupted send. It does NOT prove Meta accepts our requests: that needs real accounts and is
 * tracked as LIVE verification in docs/provider-capabilities.md.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.AUTH_SECRET ??= randomBytes(32).toString("base64");
process.env.META_APP_ID = "111222333444";
process.env.META_APP_SECRET = "test-app-secret";
process.env.META_CONTAINER_POLL_MS = "10";
process.env.PUBLIC_APP_URL = "http://localhost:3000";

// Instagram fetches media by URL; local disk storage cannot sign one, so the test supplies refs directly.
vi.mock("./media", async (orig) => ({
  ...(await orig<typeof import("./media")>()),
  mediaRefsFor: async (assets: Array<{ id: string; mimeType: string; sizeBytes: number; originalName: string }>) =>
    assets.map((a) => ({ id: a.id, mimeType: a.mimeType, sizeBytes: a.sizeBytes, filename: a.originalName, read: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]), signedUrl: async () => `https://media.example/${a.id}.jpg` })),
}));

const { prisma } = await import("@sm/db");
const core = await import("./index.js");

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch {
  dbOk = false;
}

// ---- stand-in Graph API -------------------------------------------------------------------------
interface FakePost { id: string; message: string; created_time: string }
interface FakeMedia { id: string; caption: string; timestamp: string }
const fake = {
  calls: [] as string[],
  fbPosts: [] as FakePost[],
  igMedia: [] as FakeMedia[],
  containers: new Map<string, string>(),
  igFail: false,
  /** "accept": publish then cut the connection; "lose": cut the connection without publishing. */
  fbDrop: null as null | "accept" | "lose",
  igDrop: null as null | "accept",
  pages: [
    { id: "PAGE1", name: "Spagnol Test Page", access_token: "PAGE_TOKEN_1", tasks: ["CREATE_CONTENT", "MODERATE"], instagram_business_account: { id: "IG1", username: "spagnol.test", name: "Spagnol Test" } },
    { id: "PAGE2", name: "Other Brand Page", access_token: "PAGE_TOKEN_2", tasks: ["CREATE_CONTENT"], instagram_business_account: { id: "IG2", username: "other.brand", name: "Other Brand" } },
  ],
  seq: 0,
};
const count = (needle: string) => fake.calls.filter((c) => c.includes(needle)).length;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("latin1")));
  });
}
function field(body: string, name: string): string {
  const mp = body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`));
  if (mp) return Buffer.from(mp[1]!, "latin1").toString("utf8");
  return new URLSearchParams(body).get(name) ?? "";
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
  const body = req.method === "POST" ? await readBody(req) : "";
  fake.calls.push(`${req.method} ${path}`);
  const send = (data: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (path === "/oauth/access_token") return send({ access_token: "USER_TOKEN", expires_in: 5_184_000 });
  if (path === "/me/permissions") return send({ data: ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "business_management", "instagram_basic", "instagram_content_publish"].map((permission) => ({ permission, status: "granted" })) });
  if (path === "/me/accounts") return send({ data: fake.pages });
  const seg = path.split("/").filter(Boolean);
  const page = fake.pages.find((p) => p.id === seg[0]);
  const ig = fake.pages.find((p) => p.instagram_business_account.id === seg[0]);
  if (page && seg[1] === "photos" && req.method === "POST") {
    if (fake.fbDrop === "lose") {
      fake.fbDrop = null;
      return req.socket.destroy();
    }
    const id = `${page.id}_${++fake.seq}`;
    fake.fbPosts.push({ id, message: field(body, "message"), created_time: new Date().toISOString() });
    if (fake.fbDrop === "accept") {
      fake.fbDrop = null;
      return req.socket.destroy(); // Facebook has the post, but our request never got its answer
    }
    return send({ id: `photo_${fake.seq}`, post_id: id });
  }
  if (page && seg[1] === "posts") return send({ data: fake.fbPosts.filter((p) => p.id.startsWith(page.id)).map((p) => ({ ...p, permalink_url: `https://www.facebook.com/${p.id}` })) });
  if (page && seg.length === 1) return send({ id: page.id, name: page.name });
  if (ig && seg[1] === "media" && req.method === "POST") {
    if (fake.igFail) return send({ error: { message: "The aspect ratio is not supported.", code: 100, fbtrace_id: "trace-1" } }, 400);
    const id = `container_${++fake.seq}`;
    fake.containers.set(id, field(body, "caption"));
    return send({ id });
  }
  if (ig && seg[1] === "media_publish") {
    const id = `media_${++fake.seq}`;
    fake.igMedia.push({ id, caption: fake.containers.get(field(body, "creation_id")) ?? "", timestamp: new Date().toISOString() });
    if (fake.igDrop === "accept") {
      fake.igDrop = null;
      return req.socket.destroy();
    }
    return send({ id });
  }
  if (ig && seg[1] === "media") return send({ data: fake.igMedia.map((m) => ({ ...m, permalink: `https://www.instagram.com/p/${m.id}/` })) });
  if (ig && seg.length === 1) return send({ id: ig.instagram_business_account.id, username: ig.instagram_business_account.username });
  if (seg[0]?.startsWith("container_")) return send({ status_code: "FINISHED" });
  if (seg[0]?.startsWith("media_")) return send({ id: seg[0], permalink: `https://www.instagram.com/p/${seg[0]}/` });
  if (fake.fbPosts.some((p) => p.id === seg[0])) return send({ id: seg[0], permalink_url: `https://www.facebook.com/${seg[0]}` });
  return send({ error: { message: `Unsupported get request (${path})`, code: 100 } }, 400);
}

const stamp = Date.now();
const emailA = `meta-test-a-${stamp}@example.com`;
const emailB = `meta-test-b-${stamp}@example.com`;
let server: Server;
let userA: { id: string };
let userB: { id: string };
let brand: { id: string };
let otherBrand: { id: string };
let fb: { id: string };
let igAcc: { id: string };
let mediaId: string;

async function drain() {
  for (let i = 0; i < 10; i++) if ((await core.processDueJobs("meta-test", 20)) === 0) break;
}
async function makePost(body: string, accountIds: string[]) {
  const post = await core.createPost(userA.id, brand.id, { title: null, body, link: null, tags: [], campaignTag: null, mediaIds: [mediaId], targets: accountIds.map((socialAccountId) => ({ socialAccountId, overrides: {} })), scheduledAt: null, scheduleTimezone: "Europe/Rome" });
  return post.id;
}
const dueNow = (targetId: string) => prisma.job.updateMany({ where: { dedupeKey: `publish:${targetId}` }, data: { runAt: new Date(Date.now() - 1000) } });

describe.skipIf(!dbOk)("Facebook + Instagram via a stand-in Graph API", () => {
  beforeAll(async () => {
    core.registerAllHandlers();
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.META_GRAPH_BASE = base;
    process.env.META_DIALOG_BASE = base;
    // Leftover due jobs from other suites would call the stand-in server for unrelated accounts.
    await prisma.job.updateMany({ where: { status: "queued", type: { in: ["publish_target", "reconcile_target", "check_account_health", "sync_analytics", "sync_comments", "sync_inbox", "periodic_sync"] } }, data: { status: "canceled", finishedAt: new Date() } });
    userA = await prisma.user.create({ data: { email: emailA, name: "A", passwordHash: "x" } });
    userB = await prisma.user.create({ data: { email: emailB, name: "B", passwordHash: "x" } });
    brand = await prisma.brand.create({ data: { ownerId: userA.id, name: "Test Brand", slug: `test-brand-${stamp}` } });
    otherBrand = await prisma.brand.create({ data: { ownerId: userA.id, name: "Second Brand", slug: `second-brand-${stamp}` } });
    const asset = await prisma.mediaAsset.create({ data: { brandId: brand.id, storageKey: `test/${stamp}.jpg`, originalName: "sofa.jpg", mimeType: "image/jpeg", sizeBytes: 4, status: "ready" } });
    mediaId = asset.id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  });

  it("opens the official sign-in with the brand bound to a single-use state", async () => {
    const start = await core.startConnection({ brandId: brand.id, userId: userA.id, provider: "instagram", backend: "native", options: { loginMethod: "facebook_login" } });
    const url = new URL(start.redirectUrl!);
    expect(url.pathname).toMatch(/\/v\d+\.\d+\/dialog\/oauth$/);
    expect(url.searchParams.get("client_id")).toBe("111222333444");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/oauth/instagram/callback");
    expect(url.searchParams.get("scope")!.split(",")).toEqual(expect.arrayContaining(["pages_manage_posts", "instagram_content_publish"]));
    expect(url.toString()).not.toContain("test-app-secret");
    const state = url.searchParams.get("state")!;

    // Several assets were granted → nothing is attached until the owner chooses.
    const outcome = await core.completeOAuthCallback("instagram", { code: "auth-code", state });
    expect(outcome.pendingState).toBe(state);
    expect(await prisma.socialAccount.count({ where: { brandId: brand.id } })).toBe(0);
    await expect(core.completeOAuthCallback("instagram", { code: "auth-code", state })).rejects.toThrow(/already used/);

    // Only the owner can see the choice, and it lists identities — never tokens.
    await expect(core.getPendingSelection(userB.id, state)).rejects.toThrow();
    const pending = await core.getPendingSelection(userA.id, state);
    expect(pending.brandId).toBe(brand.id);
    expect(pending.options.map((o) => o.key).sort()).toEqual(["facebook:PAGE1", "facebook:PAGE2", "instagram:IG1", "instagram:IG2"]);
    expect(JSON.stringify(pending)).not.toContain("PAGE_TOKEN");

    const chosen = await core.confirmPendingSelection(userA.id, state, ["instagram:IG1", "facebook:PAGE1"]);
    expect(chosen.accounts.map((a) => `${a.provider}:${a.externalAccountId}`).sort()).toEqual(["facebook:PAGE1", "instagram:IG1"]);
    await expect(core.confirmPendingSelection(userA.id, state, ["facebook:PAGE2"])).rejects.toThrow(/already completed/);
    expect(await prisma.socialAccount.count({ where: { brandId: otherBrand.id } })).toBe(0); // the other brand got nothing
    fb = chosen.accounts.find((a) => a.provider === "facebook")!;
    igAcc = chosen.accounts.find((a) => a.provider === "instagram")!;

    // Tokens are encrypted at rest.
    const token = await prisma.socialAccountToken.findUniqueOrThrow({ where: { socialAccountId: fb.id } });
    expect(token.ciphertext).not.toContain("PAGE_TOKEN_1");
    expect((await core.loadCredentials(fb.id)).pageAccessToken).toBe("PAGE_TOKEN_1");
    await drain(); // health checks
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: fb.id } })).healthStatus).toBe("healthy");
  });

  it("sends a scheduled photo only when due, and reports Facebook published / Instagram failed as partial", async () => {
    fake.igFail = true;
    const postId = await makePost(`New collection ${stamp} #1`, [fb.id, igAcc.id]);
    const scheduled = await core.schedulePost(userA.id, postId, { scheduledAt: new Date(Date.now() + 3600_000), scheduleTimezone: "Europe/Rome" });
    expect(scheduled.status).toBe("scheduled");
    await drain();
    expect(count("/PAGE1/photos")).toBe(0); // not due yet: nothing was sent

    for (const t of scheduled.targets) await dueNow(t.id);
    await drain(); // no browser, no session: only the queue runner
    const post = await core.getPost(userA.id, postId);
    const fbT = post.targets.find((t) => t.socialAccountId === fb.id)!;
    const igT = post.targets.find((t) => t.socialAccountId === igAcc.id)!;
    expect(fbT.status).toBe("published");
    expect(fbT.remotePostId).toMatch(/^PAGE1_/);
    expect(fbT.remoteUrl).toBe(`https://www.facebook.com/${fbT.remotePostId}`);
    expect(igT.status).toBe("failed_permanent");
    expect(igT.lastError).toContain("aspect ratio");
    expect(post.status).toBe("partial");
    expect(count("/PAGE1/photos")).toBe(1);

    // Retry Instagram alone: Facebook must not receive a second copy.
    fake.igFail = false;
    await expect(core.retryTarget(userA.id, postId, fbT.id)).rejects.toThrow(/Already published/);
    await core.retryTarget(userA.id, postId, igT.id);
    await drain();
    const after = await core.getPost(userA.id, postId);
    expect(after.targets.find((t) => t.id === igT.id)!.status).toBe("published");
    expect(after.targets.find((t) => t.id === igT.id)!.remoteUrl).toMatch(/^https:\/\/www\.instagram\.com\/p\/media_/);
    expect(after.status).toBe("published");
    expect(count("/PAGE1/photos")).toBe(1);
    expect(fake.fbPosts.filter((p) => p.message.includes("#1")).length).toBe(1);
  });

  it("after an interrupted send, finds the post on Facebook instead of sending it twice", async () => {
    const postId = await makePost(`Interrupted ${stamp} #2`, [fb.id]);
    fake.fbDrop = "accept";
    const p = await core.schedulePost(userA.id, postId, { now: true });
    await drain();
    let t = (await core.getPost(userA.id, postId)).targets[0]!;
    expect(t.status).toBe("failed_retryable");
    expect(t.errorCategory).toBe("uncertain");
    expect((await prisma.publishAttempt.findFirstOrThrow({ where: { postTargetId: t.id } })).status).toBe("unknown");
    const sends = count("/PAGE1/photos");

    await dueNow(p.targets[0]!.id);
    await drain();
    t = (await core.getPost(userA.id, postId)).targets[0]!;
    expect(t.status).toBe("published");
    expect(t.remoteUrl).toContain("facebook.com/PAGE1_");
    expect(count("/PAGE1/photos")).toBe(sends); // checked, not re-sent
    expect(fake.fbPosts.filter((x) => x.message.includes("#2")).length).toBe(1);
  });

  it("after an interrupted send that did NOT publish, sends exactly once more", async () => {
    const postId = await makePost(`Lost ${stamp} #3`, [fb.id]);
    fake.fbDrop = "lose";
    const p = await core.schedulePost(userA.id, postId, { now: true });
    await drain();
    expect((await core.getPost(userA.id, postId)).targets[0]!.errorCategory).toBe("uncertain");
    await dueNow(p.targets[0]!.id);
    await drain();
    expect((await core.getPost(userA.id, postId)).targets[0]!.status).toBe("published");
    expect(fake.fbPosts.filter((x) => x.message.includes("#3")).length).toBe(1);
  });

  it("reconciles Instagram when the worker stopped mid-send (attempt left 'started')", async () => {
    const postId = await makePost(`Worker died ${stamp} #4`, [igAcc.id]);
    fake.igDrop = "accept";
    const p = await core.schedulePost(userA.id, postId, { now: true });
    await drain();
    const targetId = p.targets[0]!.id;
    // Simulate a killed worker: the attempt never got a final status.
    await prisma.publishAttempt.updateMany({ where: { postTargetId: targetId }, data: { status: "started", finishedAt: null } });
    await prisma.postTarget.update({ where: { id: targetId }, data: { status: "uploading" } });
    const publishes = count("/IG1/media_publish");
    await dueNow(targetId);
    await drain();
    const t = (await core.getPost(userA.id, postId)).targets[0]!;
    expect(t.status).toBe("published");
    expect(t.remoteUrl).toMatch(/instagram\.com\/p\/media_/);
    expect(count("/IG1/media_publish")).toBe(publishes);
    expect(fake.igMedia.filter((m) => m.caption.includes("#4")).length).toBe(1);
  });

  it("reconnect keeps the same record and refuses a different identity", async () => {
    await prisma.socialAccount.update({ where: { id: fb.id }, data: { status: "needs_reconnect" } });
    const postId = await makePost(`Needs reconnect ${stamp} #5`, [fb.id]);
    await expect(core.schedulePost(userA.id, postId, { now: true })).rejects.toThrow(); // blocked before anything is sent

    const start = await core.startConnection({ brandId: brand.id, userId: userA.id, provider: "facebook", backend: "native", reconnectAccountId: fb.id });
    const state = new URL(start.redirectUrl!).searchParams.get("state")!;
    const r = await core.completeOAuthCallback("facebook", { code: "c", state });
    expect(r.reconnected).toBe(true);
    expect(r.accounts.map((a) => a.id)).toEqual([fb.id]);
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: fb.id } })).status).toBe("connected");
    expect(await prisma.socialAccount.count({ where: { brandId: brand.id } })).toBe(2); // nothing extra attached

    const saved = fake.pages;
    fake.pages = [saved[1]!]; // the person signs in but only allows a different Page
    const start2 = await core.startConnection({ brandId: brand.id, userId: userA.id, provider: "facebook", backend: "native", reconnectAccountId: fb.id });
    await expect(core.completeOAuthCallback("facebook", { code: "c", state: new URL(start2.redirectUrl!).searchParams.get("state")! })).rejects.toThrow(/Nothing was changed/);
    fake.pages = saved;
    expect((await core.loadCredentials(fb.id)).pageAccessToken).toBe("PAGE_TOKEN_1");
  });

  it("asks for the one-time setup when the Meta app is not configured", async () => {
    const id = process.env.META_APP_ID;
    delete process.env.META_APP_ID;
    await expect(core.startConnection({ brandId: brand.id, userId: userA.id, provider: "facebook", backend: "native" })).rejects.toMatchObject({ code: "provider_app_missing" });
    process.env.META_APP_ID = id;
  });
});
