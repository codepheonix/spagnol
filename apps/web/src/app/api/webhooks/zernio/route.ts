import { ingestZernioWebhook, registerAllHandlers, processDueJobs } from "@sm/core";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Zernio webhook receiver: HMAC-verified when a secret is configured, deduplicated by event id. */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const headers: Record<string, string | null> = {};
  for (const k of ["x-zernio-event", "x-zernio-event-id", "x-zernio-signature", "x-late-event", "x-late-event-id", "x-late-signature"]) headers[k] = req.headers.get(k);
  const r = await ingestZernioWebhook({ rawBody, headers });
  if (r.status === "rejected") return json({ error: r.reason }, { status: 400 });
  // Process inline when no always-on worker exists (serverless): small, bounded.
  if (r.status === "stored" && process.env.WEBHOOK_INLINE_PROCESS !== "0") {
    registerAllHandlers();
    await processDueJobs(`webhook-${process.pid}`, 3).catch(() => undefined);
  }
  return json({ ok: true, status: r.status });
}

export async function GET() {
  return json({ ok: true, provider: "zernio" });
}
