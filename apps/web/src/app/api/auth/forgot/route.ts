import { z } from "zod";
import { checkLoginAllowed, mailConfigured, recordLoginFailure, requestPasswordReset } from "@sm/core";
import { handle, json, parseJson } from "@/lib/api";
import { clientIp } from "@/lib/auth";

const schema = z.object({ email: z.string().email().max(254) });

/**
 * Starts a password reset. The answer is identical for known and unknown addresses. Requests are
 * limited per network address here and per account inside `requestPasswordReset`.
 */
export const POST = handle(async (req) => {
  const ip = await clientIp();
  const { email } = await parseJson(req, schema);
  const key = `password-reset@${ip ?? "unknown"}`; // counted per address, never per target account
  const gate = await checkLoginAllowed(key, ip);
  if (!gate.allowed) return json({ error: "Too many requests. Try again later.", code: "rate_limited" }, { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } });
  await recordLoginFailure(key, ip);
  const base = process.env.PUBLIC_APP_URL ?? new URL(req.url).origin;
  await requestPasswordReset(email, ip, base);
  return json({ ok: true, mail: mailConfigured() });
});
