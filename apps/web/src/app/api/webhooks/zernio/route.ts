import { ingestZernioWebhook, registerAllHandlers, processDueJobs } from "@sm/core";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Zernio webhook receiver. Closed (503) until a webhook secret is saved; then every delivery must carry a valid signature. */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const headers: Record<string, string | null> = {};
  for (const k of ["x-zernio-event", "x-zernio-event-id", "x-zernio-signature", "x-late-event", "x-late-event-id", "x-late-signature"]) headers[k] = req.headers.get(k);
  const r = await ingestZernioWebhook({ rawBody, headers });
  if (r.status === "disabled") return json({ error: "Zernio webhooks are not enabled on this installation.", code: "webhook_disabled" }, { status: 503 });
  if (r.status === "rejected") return json({ error: "Signature check failed.", code: "bad_signature" }, { status: 401 });
  // Process inline when no always-on worker exists (serverless): small, bounded.
  if (r.status === "stored" && process.env.WEBHOOK_INLINE_PROCESS !== "0") {
    registerAllHandlers();
    await processDueJobs(`webhook-${process.pid}`, 3).catch(() => undefined);
  }
  return json({ ok: true, status: r.status });
}

export async function GET() {
  return json({ error: "Method not allowed." }, { status: 405 });
}
