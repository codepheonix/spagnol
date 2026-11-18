import { z } from "zod";
import { cookies, headers } from "next/headers";
import { handle, json, parseJson, HttpError } from "@/lib/api";
import { checkLoginAllowed, isKnownDevice, recordLoginFailure, recordLoginSuccess, recoveryCodesLeft } from "@sm/core";
import { completeSecondFactor, getPendingSession, rememberDevice, SESSION_COOKIE, DEVICE_COOKIE, sessionCookieOptions, clientIp } from "@/lib/auth";

const schema = z.object({ code: z.string().max(12).optional(), recoveryCode: z.string().max(40).optional() }).refine((v) => v.code || v.recoveryCode, "Enter a code.");

/** Sign-in, step two: the authenticator code or a recovery code. Wrong codes count against the same limits as wrong passwords. */
export const POST = handle(async (req) => {
  const ip = await clientIp();
  const proof = await parseJson(req, schema);
  const pending = await getPendingSession();
  if (!pending) throw new HttpError(401, "Sign in with your password first.", "no_pending");
  const jar = await cookies();
  const knownDevice = await isKnownDevice(pending.user.email, jar.get(DEVICE_COOKIE)?.value);
  const gate = await checkLoginAllowed(pending.user.email, ip, new Date(), { knownDevice });
  if (!gate.allowed) return json({ error: "Too many failed attempts. Wait a few minutes and try again.", code: "rate_limited" }, { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } });
  const h = await headers();
  const r = await completeSecondFactor(proof, { userAgent: h.get("user-agent"), ip, knownDevice });
  if (!r.ok) {
    await recordLoginFailure(pending.user.email, ip);
    return json({ error: "That code is not correct.", code: "mfa_bad_code" }, { status: 401 });
  }
  await recordLoginSuccess(pending.user.email, ip);
  jar.set(SESSION_COOKIE, r.token, sessionCookieOptions(r.maxAge));
  await rememberDevice(r.userId);
  return json({ ok: true, method: r.method, recoveryCodesLeft: r.method === "recovery" ? await recoveryCodesLeft(r.userId) : undefined });
});
