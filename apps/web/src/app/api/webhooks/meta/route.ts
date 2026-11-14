import { getOrCreateWebhookVerifyToken, ingestMetaWebhook, registerAllHandlers, processDueJobs } from "@sm/core";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Meta webhook receiver (Instagram `comments`, Facebook Page `feed`).
 * GET  = Meta's one-time verification handshake (hub.mode / hub.verify_token / hub.challenge).
 * POST = event deliveries, verified with X-Hub-Signature-256 (HMAC-SHA256 of the raw body, app secret).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && challenge) {
    const expected = await getOrCreateWebhookVerifyToken();
    if (token === expected) return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
    return json({ error: "verify token mismatch" }, { status: 403 });
  }
  return json({ ok: true, provider: "meta", fields: ["instagram.comments", "page.feed"] });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const r = await ingestMetaWebhook({ rawBody, signature: req.headers.get("x-hub-signature-256") });
  if (r.status === "rejected") return json({ error: r.reason }, { status: r.httpStatus });
  // Serverless: send the queued private replies right away (bounded), instead of waiting for the next tick.
  if (r.handled > 0 && process.env.WEBHOOK_INLINE_PROCESS !== "0") {
    registerAllHandlers();
    await processDueJobs(`webhook-meta-${process.pid}`, 5).catch(() => undefined);
  }
  return json({ ok: true, handled: r.handled, duplicates: r.duplicates });
}
