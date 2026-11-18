import { z } from "zod";
import { cookies, headers } from "next/headers";
import { handle, json, parseJson } from "@/lib/api";
import { audit, checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from "@sm/core";
import { login, SESSION_COOKIE, sessionCookieOptions, clientIp } from "@/lib/auth";

const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });

/**
 * Sign-in. Failed attempts are counted in the database (see packages/core/src/auth-throttle.ts), so
 * the limit holds across every server instance. The answer never says whether the e-mail exists.
 */
export const POST = handle(async (req) => {
  const ip = await clientIp();
  const { email, password } = await parseJson(req, schema);
  const gate = await checkLoginAllowed(email, ip);
  if (!gate.allowed) {
    await audit({ action: "auth.login", outcome: "denied", details: { reason: "blocked: too many failed attempts" }, ip });
    return json({ error: "Too many failed attempts. Wait a few minutes and try again.", code: "rate_limited" }, { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } });
  }
  const h = await headers();
  const r = await login(email, password, { userAgent: h.get("user-agent"), ip });
  if (!r.ok) {
    await recordLoginFailure(email, ip);
    return json({ error: "Invalid email or password.", code: r.error }, { status: 401 });
  }
  await recordLoginSuccess(email, ip);
  (await cookies()).set(SESSION_COOKIE, r.token, sessionCookieOptions());
  return json({ ok: true });
});
