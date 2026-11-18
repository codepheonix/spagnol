/**
 * Comment → DM against a STAND-IN Graph API server (not Meta). Proves this app's own logic:
 * webhook signature check, exactly one private reply per comment even when Meta delivers the event
 * twice (and when the poll sees the same comment), case-insensitive whole-word keyword, unrelated
 * comments get nothing, permission errors are recorded and shown, a cut connection is `uncertain`
 * and never re-sent blindly, Facebook Page comments go through the Page's private reply.
 * It does NOT prove Meta's acceptance — that is the live test in docs/meta-comment-dm.md.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SocialAccount } from "@sm/db";
import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.AUTH_SECRET ??= randomBytes(32).toString("base64");
process.env.META_APP_ID = "111222333444";
process.env.META_APP_SECRET = "test-app-secret";
process.env.PUBLIC_APP_URL = "http://localhost:3000";

// Unique provider ids per run: rows left in a developer database can never collide with the test.
const RUN = Date.now().toString(36);
const IG = `IG${RUN}`;
const PAGE = `PG${RUN}`;
const MEDIA = `MEDIA${RUN}`;
const FBPOST = `${PAGE}_POST9`;

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
const fake = {
  calls: [] as Array<{ method: string; path: string; body: string; auth: string | undefined }>,
  messagesMode: "ok" as "ok" | "permission" | "drop" | "rate",
  igComments: [] as Array<{ id: string; text: string; timestamp: string; from: { id: string; username: string } }>,
  seq: 0,
};
const messageCalls = () => fake.calls.filter((c) => c.path.endsWith("/messages") && c.method === "POST");

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
  const body = req.method === "POST" ? await readBody(req) : "";
  fake.calls.push({ method: req.method ?? "GET", path, body, auth: req.headers.authorization });
  const send = (data: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  const seg = path.split("/").filter(Boolean);
  if (seg[1] === "messages" && req.method === "POST") {
    if (fake.messagesMode === "permission") return send({ error: { message: "(#10) Application does not have permission for this action", type: "OAuthException", code: 10, fbtrace_id: "trace-p" } }, 403);
    if (fake.messagesMode === "rate") return send({ error: { message: "(#4) Application request limit reached", code: 4 } }, 400);
    if (fake.messagesMode === "drop") {
      fake.messagesMode = "ok";
      return req.socket.destroy(); // Meta got the request; our side never saw the answer
    }
    return send({ recipient_id: "RECIP_1", message_id: `m_${++fake.seq}` });
  }
  if (seg[0] === IG && seg[1] === "media") return send({ data: [{ id: MEDIA, caption: "Divano Boston", permalink: `https://www.instagram.com/p/${MEDIA}/`, timestamp: "2026-11-14T10:00:00+0000", media_type: "IMAGE" }] });
  if (seg[0] === MEDIA && seg[1] === "comments") return send({ data: fake.igComments });
  if (seg[0] === PAGE && seg[1] === "posts") return send({ data: [{ id: FBPOST, message: "Nuova collezione", permalink_url: `https://www.facebook.com/${FBPOST}`, created_time: "2026-11-14T10:00:00+0000" }] });
  if (seg[1] === "subscribed_apps" && req.method === "POST") return send({ success: true });
  return send({ error: { message: `Unsupported (${req.method} ${path})`, code: 100 } }, 400);
}

const sign = (raw: string) => "sha256=" + createHmac("sha256", "test-app-secret").update(raw).digest("hex");
const igWebhook = (commentId: string, text: string, from = { id: "USER_77", username: "cliente.curioso" }, mediaId = MEDIA) =>
  JSON.stringify({ object: "instagram", entry: [{ id: IG, time: Math.floor(Date.now() / 1000), changes: [{ field: "comments", value: { from, media: { id: mediaId, media_product_type: "FEED" }, id: commentId, text } }] }] });
const fbWebhook = (commentId: string, message: string) =>
  JSON.stringify({ object: "page", entry: [{ id: PAGE, time: Math.floor(Date.now() / 1000), changes: [{ field: "feed", value: { from: { id: "USER_88", name: "Maria Rossi" }, post_id: FBPOST, comment_id: commentId, created_time: Math.floor(Date.now() / 1000), item: "comment", parent_id: FBPOST, verb: "add", message } }] }] });

const stamp = Date.now();
const email = `pr-test-${stamp}@example.com`;
let server: Server;
let user: { id: string };
let brand: { id: string };
let ig: SocialAccount;
let fb: SocialAccount;

async function drain() {
  for (let i = 0; i < 10; i++) if ((await core.processDueJobs("pr-test", 20)) === 0) break;
}
// Scoped to this run's two accounts: a developer database may hold other rows with the same comment id.
const row = (commentId: string) => prisma.privateReply.findFirst({ where: { externalCommentId: commentId, socialAccountId: { in: [ig.id, fb.id] } } });

describe.skipIf(!dbOk)("Comment → DM via a stand-in Graph API", () => {
  beforeAll(async () => {
    core.registerAllHandlers();
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.META_GRAPH_BASE = base;
    process.env.INSTAGRAM_GRAPH_BASE = base;
    await prisma.job.updateMany({ where: { status: "queued" }, data: { status: "canceled", finishedAt: new Date() } });
    await prisma.job.deleteMany({ where: { type: { in: ["poll_private_reply_rules", "send_private_reply"] } } });
    await prisma.webhookEvent.deleteMany({ where: { provider: "meta", OR: [{ providerEventId: { contains: `:${IG}:` } }, { providerEventId: { contains: `:${PAGE}:` } }] } });
    user = await prisma.user.create({ data: { email, name: "PR", passwordHash: "x" } });
    brand = await prisma.brand.create({ data: { ownerId: user.id, name: "PR Brand", slug: `pr-brand-${stamp}` } });
    ig = await prisma.socialAccount.create({ data: { brandId: brand.id, provider: "instagram", backend: "native", externalAccountId: IG, accountType: "professional", displayName: "spagnol.test", username: "spagnol.test", metadata: { pageId: PAGE, loginMethod: "facebook_login", grantedScopes: ["instagram_basic", "instagram_manage_comments"] } } });
    await core.storeCredentials(ig.id, { pageAccessToken: "PAGE_TOKEN_1", pageId: PAGE });
    fb = await prisma.socialAccount.create({ data: { brandId: brand.id, provider: "facebook", backend: "native", externalAccountId: PAGE, accountType: "page", displayName: "Spagnol Test Page", metadata: { loginMethod: "facebook_login" } } });
    await core.storeCredentials(fb.id, { pageAccessToken: "PAGE_TOKEN_1" });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.webhookEvent.deleteMany({ where: { provider: "meta", OR: [{ providerEventId: { contains: `:${IG}:` } }, { providerEventId: { contains: `:${PAGE}:` } }] } });
    await new Promise<void>((r) => server.close(() => r()));
    await prisma.$disconnect();
  });

  it("lists the account's posts for the picker and saves the rule", async () => {
    const adapter = core.adapterFor(ig);
    const posts = await adapter.listRecentPosts!(await core.buildAccountContext(ig));
    expect(posts.map((p) => p.externalPostId)).toEqual([MEDIA]);
    const rule = await core.createPrivateReplyRule(user.id, brand.id, { socialAccountId: ig.id, externalPostId: MEDIA, postLabel: posts[0]!.label, postUrl: posts[0]!.url, keyword: "CATALOGO", replyText: "Ecco il catalogo: https://spagnolmobili.it/catalogo", enabled: true });
    expect(rule.keyword).toBe("CATALOGO");
    expect(rule.enabled).toBe(true);
    expect(await prisma.job.count({ where: { type: "poll_private_reply_rules", status: "queued" } })).toBe(1);
  });

  it("matches the keyword whole-word and case-insensitively", () => {
    expect(core.keywordMatches("catalogo", "CATALOGO")).toBe(true);
    expect(core.keywordMatches("Vorrei il Catalogo!", "CATALOGO")).toBe(true);
    expect(core.keywordMatches("CATALOGO 🙏", "catalogo")).toBe(true);
    expect(core.keywordMatches("catalogone", "CATALOGO")).toBe(false);
    expect(core.keywordMatches("bellissimo divano", "CATALOGO")).toBe(false);
    expect(core.keywordMatches("", "CATALOGO")).toBe(false);
  });

  it("rejects unsigned and badly signed deliveries", async () => {
    const raw = igWebhook("C_bad", "CATALOGO");
    expect((await core.ingestMetaWebhook({ rawBody: raw, signature: null })).status).toBe("rejected");
    expect((await core.ingestMetaWebhook({ rawBody: raw, signature: "sha256=" + "0".repeat(64) })).status).toBe("rejected");
    expect(await row("C_bad")).toBeNull();
    expect(messageCalls().length).toBe(0);
  });

  it("sends exactly one private reply even when Meta delivers the same comment twice", async () => {
    const raw = igWebhook("C_1", "catalogo per favore");
    const first = await core.ingestMetaWebhook({ rawBody: raw, signature: sign(raw) });
    expect(first).toMatchObject({ status: "ok", handled: 1, duplicates: 0 });
    const second = await core.ingestMetaWebhook({ rawBody: raw, signature: sign(raw) });
    expect(second).toMatchObject({ status: "ok", handled: 0, duplicates: 1 });
    await drain();
    await drain();
    const r = await row("C_1");
    expect(r?.status).toBe("sent");
    expect(r?.providerMessageId).toMatch(/^m_/);
    expect(r?.source).toBe("webhook");
    const sent = messageCalls();
    expect(sent.length).toBe(1);
    expect(sent[0]!.path).toBe(`/${IG}/messages`); // Instagram via Facebook Login: graph.facebook.com/{ig-user-id}/messages
    expect(sent[0]!.auth).toBe("Bearer PAGE_TOKEN_1");
    expect(JSON.parse(sent[0]!.body)).toEqual({ recipient: { comment_id: "C_1" }, message: { text: "Ecco il catalogo: https://spagnolmobili.it/catalogo" } });
    // Activity shows the outcome.
    const log = await prisma.auditLog.findFirst({ where: { action: "automation.private_reply.sent", targetId: "C_1", brandId: brand.id } });
    expect(log?.outcome).toBe("ok");
    // The comment is also in the inbox, marked replied.
    expect((await prisma.comment.findFirst({ where: { externalCommentId: "C_1", socialAccountId: ig.id } }))?.repliedAt).toBeTruthy();
  });

  it("gives an unrelated comment no DM, visibly", async () => {
    const raw = igWebhook("C_2", "Bellissimo divano 😍");
    await core.ingestMetaWebhook({ rawBody: raw, signature: sign(raw) });
    await drain();
    expect((await row("C_2"))?.status).toBe("skipped");
    expect(messageCalls().length).toBe(1);
  });

  it("ignores the account's own comments and comments on other posts", async () => {
    const own = igWebhook("C_3", "CATALOGO", { id: IG, username: "spagnol.test" });
    await core.ingestMetaWebhook({ rawBody: own, signature: sign(own) });
    const other = igWebhook("C_4", "CATALOGO", undefined, "MEDIA_Z");
    await core.ingestMetaWebhook({ rawBody: other, signature: sign(other) });
    await drain();
    expect(await row("C_3")).toBeNull();
    expect(await row("C_4")).toBeNull();
    expect(messageCalls().length).toBe(1);
  });

  it("the per-minute poll sees the same comment and does not send again", async () => {
    fake.igComments = [
      { id: "C_1", text: "catalogo per favore", timestamp: new Date().toISOString(), from: { id: "USER_77", username: "cliente.curioso" } },
      { id: "C_5", text: "Catalogo?", timestamp: new Date().toISOString(), from: { id: "USER_78", username: "altra.cliente" } },
      { id: "C_old", text: "CATALOGO", timestamp: "2026-10-01T10:00:00+0000", from: { id: "USER_79", username: "vecchio" } },
    ];
    await core.pollPrivateReplyRulesJob();
    await drain();
    expect((await row("C_1"))?.status).toBe("sent");
    expect((await row("C_5"))?.status).toBe("sent");
    expect((await row("C_5"))?.source).toBe("poll");
    expect((await row("C_old"))?.status).toBe("skipped"); // older than the rule: never answered
    expect(messageCalls().length).toBe(2);
  });

  it("an account whose saved sign-in cannot be read fails cleanly and does not block other accounts", async () => {
    const broken = await prisma.socialAccount.create({ data: { brandId: brand.id, provider: "instagram", backend: "native", externalAccountId: `${IG}X`, accountType: "professional", displayName: "broken.token", metadata: { loginMethod: "facebook_login" } } });
    await core.storeCredentials(broken.id, { pageAccessToken: "PAGE_TOKEN_X", pageId: PAGE });
    await prisma.socialAccountToken.updateMany({ where: { socialAccountId: broken.id }, data: { ciphertext: "AAAA" } });
    const brokenRule = await core.createPrivateReplyRule(user.id, brand.id, { socialAccountId: broken.id, externalPostId: `${MEDIA}X`, keyword: "catalogo", replyText: "x", enabled: true });
    const before = messageCalls().length;
    const pr = await prisma.privateReply.create({ data: { brandId: brand.id, socialAccountId: broken.id, provider: "instagram", externalPostId: `${MEDIA}X`, externalCommentId: "C_broken", commentText: "catalogo", source: "webhook", keyword: "catalogo", replyText: "x", status: "queued" } });
    await expect(core.sendPrivateReplyJob(pr.id, 1)).rejects.toThrow();
    const after = await prisma.privateReply.findUnique({ where: { id: pr.id } });
    expect(after?.status).toBe("failed");
    expect(after?.errorCategory).toBe("auth_expired");
    expect(messageCalls().length).toBe(before); // nothing left the app
    // the poll still serves the healthy account
    fake.igComments = [{ id: "C_after_broken", text: "CATALOGO", timestamp: new Date().toISOString(), from: { id: "USER_90", username: "dopo" } }];
    await core.pollPrivateReplyRulesJob();
    await drain();
    expect((await row("C_after_broken"))?.status).toBe("sent");
    await core.deletePrivateReplyRule(user.id, brokenRule.id);
    await prisma.socialAccount.delete({ where: { id: broken.id } });
  });

  it("records a permission error instead of pretending", async () => {
    fake.messagesMode = "permission";
    const raw = igWebhook("C_6", "CATALOGO");
    await core.ingestMetaWebhook({ rawBody: raw, signature: sign(raw) });
    await drain();
    const r = await row("C_6");
    expect(r?.status).toBe("failed");
    expect(r?.errorCategory).toBe("permission");
    expect(r?.error).toContain("(#10)");
    const log = await prisma.auditLog.findFirst({ where: { action: "automation.private_reply.failed", targetId: "C_6", brandId: brand.id } });
    expect(log?.outcome).toBe("error");
    expect(await prisma.notification.count({ where: { brandId: brand.id, level: "error" } })).toBeGreaterThan(0);
    fake.messagesMode = "ok";
    // No automatic retry happened; the owner can retry by hand once the permission is fixed.
    const before = messageCalls().length;
    await drain();
    expect(messageCalls().length).toBe(before);
    await core.retryPrivateReply(user.id, r!.id);
    await drain();
    expect((await row("C_6"))?.status).toBe("sent");
  });

  it("treats a cut connection as uncertain and never re-sends blindly", async () => {
    fake.messagesMode = "drop";
    const raw = igWebhook("C_7", "CATALOGO");
    await core.ingestMetaWebhook({ rawBody: raw, signature: sign(raw) });
    await drain();
    await drain();
    const r = await row("C_7");
    expect(r?.status).toBe("uncertain");
    expect(r?.error).toContain("Check the Instagram/Facebook inbox");
    const n = messageCalls().filter((c) => c.body.includes("C_7")).length;
    expect(n).toBe(1);
    // Redelivery of the same event after the uncertain outcome changes nothing.
    await core.ingestMetaWebhook({ rawBody: raw, signature: sign(raw) });
    await drain();
    expect(messageCalls().filter((c) => c.body.includes("C_7")).length).toBe(1);
  });

  it("retries a rate limit (nothing was sent) and then sends once", async () => {
    fake.messagesMode = "rate";
    const raw = igWebhook("C_8", "CATALOGO");
    await core.ingestMetaWebhook({ rawBody: raw, signature: sign(raw) });
    await drain();
    expect((await row("C_8"))?.status).toBe("queued");
    fake.messagesMode = "ok";
    await prisma.job.updateMany({ where: { dedupeKey: `private_reply:${(await row("C_8"))!.id}` }, data: { runAt: new Date(Date.now() - 1000) } });
    await drain();
    expect((await row("C_8"))?.status).toBe("sent");
    expect(messageCalls().filter((c) => c.body.includes("C_8") && !c.auth?.includes("x")).length).toBe(2); // one refused, one accepted
  });

  it("switching the rule off stops replies", async () => {
    const [rule] = await core.listPrivateReplyRules(brand.id);
    await core.updatePrivateReplyRule(user.id, rule!.id, { enabled: false });
    const raw = igWebhook("C_9", "CATALOGO");
    await core.ingestMetaWebhook({ rawBody: raw, signature: sign(raw) });
    await drain();
    expect((await row("C_9"))?.status).toBe("skipped");
    expect((await row("C_9"))?.error).toBe("rule is off");
    await core.updatePrivateReplyRule(user.id, rule!.id, { enabled: true });
  });

  it("Facebook Page comment → Messenger private reply through the Page", async () => {
    await core.createPrivateReplyRule(user.id, brand.id, { socialAccountId: fb.id, externalPostId: FBPOST, postLabel: "Nuova collezione", postUrl: null, keyword: "catalogo", replyText: "Ciao Maria, ecco il catalogo.", enabled: true });
    const raw = fbWebhook(`${FBPOST}_C1`, "Vorrei il CATALOGO grazie");
    await core.ingestMetaWebhook({ rawBody: raw, signature: sign(raw) });
    await core.ingestMetaWebhook({ rawBody: raw, signature: sign(raw) });
    await drain();
    const r = await row(`${FBPOST}_C1`);
    expect(r?.status).toBe("sent");
    expect(r?.provider).toBe("facebook");
    const calls = messageCalls().filter((c) => c.body.includes(`${FBPOST}_C1`));
    expect(calls.length).toBe(1);
    expect(calls[0]!.path).toBe(`/${PAGE}/messages`);
    const unrelated = fbWebhook(`${FBPOST}_C2`, "Che bello");
    await core.ingestMetaWebhook({ rawBody: unrelated, signature: sign(unrelated) });
    await drain();
    expect((await row(`${FBPOST}_C2`))?.status).toBe("skipped");
  });

  it("subscribes the account to the webhook fields at Meta", async () => {
    const r = await core.subscribeAccountWebhooks(user.id, ig.id);
    expect(r.subscribedFields).toEqual(["feed"]); // Facebook Login path: the linked Page is subscribed
    const sub = fake.calls.find((c) => c.path.endsWith("/subscribed_apps"));
    expect(sub?.path).toBe(`/${PAGE}/subscribed_apps`);
    const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id: ig.id } });
    expect((acc.metadata as { webhookFields?: string[] }).webhookFields).toEqual(["feed"]);
  });
});
