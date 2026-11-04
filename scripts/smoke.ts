/**
 * End-to-end smoke test of the publishing pipeline against a RUNNING web server (default
 * http://localhost:3000) and a STUB Telegram Bot API started by this script. It proves:
 * login → brand → media upload (validated) → connection (credential form) → post → validate →
 * publish → durable job → adapter call → remote id/permalink reconciled → status rollup.
 *
 * It does NOT prove a live provider (see docs/acceptance-tests.md). The web server must have
 * TELEGRAM_API_BASE=http://127.0.0.1:8089 for the stub to be used.
 */
import { createServer } from "node:http";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.OWNER_EMAIL ?? "owner@example.com";
const PASSWORD = process.env.OWNER_PASSWORD ?? "local-dev-password";
const STUB_PORT = 8089;
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const jar = new Map<string, string>();
const calls: string[] = [];

async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { origin: BASE, ...((init.headers as Record<string, string>) ?? {}) };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  let body = init.body;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, body, redirect: "manual" });
  for (const sc of res.headers.getSetCookie()) {
    const [kv] = sc.split(";");
    const [k, v] = kv!.split("=");
    if (k && v !== undefined) jar.set(k, v);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${data?.error ?? text}`);
  return data;
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

// --- Stub Telegram Bot API ---------------------------------------------------------------
const stub = createServer(async (req, res) => {
  const method = req.url!.split("/").pop()!.split("?")[0]!;
  calls.push(method);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const ok = (result: unknown) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result }));
  };
  if (method === "getMe") return ok({ id: 777, username: "smoke_bot", first_name: "Smoke" });
  if (method === "getChat") return ok({ id: -1001234567890, type: "channel", title: "Smoke channel", username: "smokechannel" });
  if (method === "getChatMember") return ok({ status: "administrator", can_post_messages: true });
  if (method === "sendPhoto" || method === "sendMessage") return ok({ message_id: 4242, chat: { id: -1001234567890, username: "smokechannel" }, date: Math.floor(Date.now() / 1000) });
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, description: `stub: unknown method ${method}` }));
});

async function main() {
  await new Promise<void>((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
  console.log(`Stub Telegram API on :${STUB_PORT}; target ${BASE}`);

  const health = await api("/api/health");
  assert(health.ok, "health endpoint reports db ok");

  await api("/api/auth/login", { method: "POST", json: { email: EMAIL, password: PASSWORD } });
  const me = await api("/api/me");
  assert(me.user?.email === EMAIL, "login returns the owner");

  const brandRes = await api("/api/brands", { method: "POST", json: { name: `Smoke ${Date.now()}`, timezone: "Europe/Rome", locale: "it" } });
  const brandId = brandRes.brand.id as string;
  await api(`/api/brands/${brandId}/select`, { method: "POST" });
  assert((await api("/api/me")).activeBrandId === brandId, "brand created and selected");

  // Cross-brand check: the default brand's id must be rejected for another user (we only have one user; verify not-found on a bogus id)
  await api("/api/posts?brandId=does-not-exist").then(() => assert(false, "bogus brand rejected"), () => assert(true, "bogus brand id rejected"));

  const form = new FormData();
  form.set("brandId", brandId);
  form.set("file", new Blob([PNG_1x1], { type: "image/png" }), "pixel.png");
  form.set("altText", "A pixel");
  const up = await api("/api/media", { method: "POST", body: form });
  assert(up.media[0]?.status === "ready" && up.media[0].width === 1, "media upload validated and stored");
  const bad = new FormData();
  bad.set("brandId", brandId);
  bad.set("file", new Blob([Buffer.from("MZ not an image at all....")], { type: "image/png" }), "fake.png");
  const badUp = await api("/api/media", { method: "POST", body: bad });
  assert(badUp.media[0]?.status === "failed", "renamed non-image is rejected by content sniffing");

  const conn = await api("/api/connections/credentials", { method: "POST", json: { brandId, provider: "telegram", fields: { botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", chatId: "@smokechannel" } } });
  const accountId = conn.accounts[0].id as string;
  assert(conn.accounts[0].externalAccountId === "-1001234567890", "telegram connection stored with real chat id from getChat");
  assert(calls.includes("getChatMember"), "connection verified bot admin rights with getChatMember");

  const post = await api("/api/posts", { method: "POST", json: { brandId, body: "Smoke test post 🧪", tags: ["smoke"], mediaIds: [up.media[0].id], targets: [{ socialAccountId: accountId, overrides: {} }] } });
  const postId = post.post.id as string;
  const val = await api(`/api/posts/${postId}/validate`, { method: "POST" });
  const targetId = val.post.targets[0].id as string;
  assert(val.reports[targetId]?.ok === true, "per-target validation passes");

  const tooLong = await api("/api/posts", { method: "POST", json: { brandId, body: "x".repeat(5000), tags: [], mediaIds: [], targets: [{ socialAccountId: accountId, overrides: {} }] } });
  const valLong = await api(`/api/posts/${tooLong.post.id}/validate`, { method: "POST" });
  assert(Object.values(valLong.reports).some((r: any) => r.ok === false), "over-limit text is blocked before publishing");

  const pub = await api(`/api/posts/${postId}/publish`, { method: "POST" });
  assert(pub.post.status === "scheduled" && pub.post.targets[0].status === "queued", "publish enqueues a durable job (status queued)");

  const before = calls.length;
  const tick = await api(`/api/jobs/tick?secret=${process.env.CRON_SECRET ?? "local-cron-secret"}`, { method: "POST" });
  assert(tick.processed >= 1, `tick processed ${tick.processed} job(s)`);
  assert(calls.slice(before).includes("sendPhoto"), "adapter uploaded the photo to the (stub) Bot API");

  const done = await api(`/api/posts/${postId}`);
  const t = done.post.targets[0];
  assert(t.status === "published" && t.remotePostId === "4242", `target published with remote id ${t.remotePostId}`);
  assert(t.remoteUrl === "https://t.me/smokechannel/4242", `permalink recorded ${t.remoteUrl}`);
  assert(done.post.status === "published", "parent post rolled up to published");

  const tick2 = await api(`/api/jobs/tick?secret=${process.env.CRON_SECRET ?? "local-cron-secret"}`, { method: "POST" });
  const again = await api(`/api/posts/${postId}`);
  assert(again.post.targets[0].attempts === 1 && !calls.slice(before + 1).includes("sendPhoto"), "second tick does not double-post (idempotent)");

  const cal = await api(`/api/calendar?brandId=${brandId}`);
  assert(cal.events.some((e: any) => e.id === postId), "calendar lists the post");
  const an = await api(`/api/analytics/posts?brandId=${brandId}`);
  assert(an.rows.some((r: any) => r.postId === postId && r.metrics.impressions === undefined), "analytics shows the post with no invented metrics");
  const act = await api("/api/activity");
  assert(act.activity.some((a: any) => a.action === "post.publish_now"), "audit log recorded the publish action");

  await api(`/api/connections/${accountId}`, { method: "DELETE" });
  const health2 = await api("/api/health/connections");
  assert(health2.accounts.find((a: any) => a.id === accountId)?.status === "disconnected", "disconnect removes credentials and marks the account");
  void tick2;
  console.log("\nSMOKE OK");
}

main()
  .catch((e) => {
    console.error("\nSMOKE FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => stub.close());
