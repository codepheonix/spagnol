import { z } from "zod";
import { cookies, headers } from "next/headers";
import { handle, json, parseJson } from "@/lib/api";
import { audit, checkLoginAllowed, isKnownDevice, notify, recordLoginFailure, recordLoginSuccess } from "@sm/core";
import { login, rememberDevice, SESSION_COOKIE, DEVICE_COOKIE, sessionCookieOptions, clientIp } from "@/lib/auth";

const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });

/**
 * Sign-in, step one. Failed attempts are counted in the database (packages/core/src/auth-throttle.ts)
 * so the limit holds across every server instance, and repeated blocks last longer each time. The
 * answer never says whether the e-mail exists. An account with two-factor sign-in gets
 * `secondFactor: true` and a ten-minute waiting session that opens nothing until `/api/auth/mfa`.
 */
export const POST = handle(async (req) => {
  const ip = await clientIp();
  const { email, password } = await parseJson(req, schema);
  const jar = await cookies();
  // A browser that signed in to this account before is exempt from the account-wide limit only, so
  // an attacker hammering the address cannot lock its owner out.
  const knownDevice = await isKnownDevice(email, jar.get(DEVICE_COOKIE)?.value);
  const gate = await checkLoginAllowed(email, ip, new Date(), { knownDevice });
  if (!gate.allowed) {
    await audit({ action: "auth.login", outcome: "denied", details: { reason: "blocked: too many failed attempts" }, ip });
    return json({ error: "Too many failed attempts. Wait a few minutes and try again.", code: "rate_limited" }, { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } });
  }
  const h = await headers();
  const r = await login(email, password, { userAgent: h.get("user-agent"), ip, knownDevice });
  if (!r.ok) {
    await recordLoginFailure(email, ip);
    const after = await checkLoginAllowed(email, ip, new Date(), { knownDevice });
    if (!after.allowed) await notify({ level: "warning", title: "Sign-in attempts were blocked", body: `Repeated wrong passwords from ${ip ?? "an unknown address"}. Nothing was opened. If this was not you, no action is needed; if it keeps happening, change your password.`, link: "/account/security" }).catch(() => undefined);
    return json({ error: "Invalid email or password.", code: r.error }, { status: 401 });
  }
  jar.set(SESSION_COOKIE, r.token, sessionCookieOptions(r.maxAge));
  if (r.needsSecondFactor) return json({ ok: true, secondFactor: true });
  await recordLoginSuccess(email, ip);
  await rememberDevice(r.userId);
  return json({ ok: true });
});
