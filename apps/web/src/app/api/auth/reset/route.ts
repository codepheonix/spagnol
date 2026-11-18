import { z } from "zod";
import { AppError, checkLoginAllowed, recordLoginFailure, resetPasswordWithToken } from "@sm/core";
import { handle, json, parseJson } from "@/lib/api";
import { clientIp } from "@/lib/auth";

const schema = z.object({ token: z.string().min(20).max(200), newPassword: z.string().min(1).max(200), code: z.string().max(12).optional(), recoveryCode: z.string().max(40).optional() });

/** Completes a reset. Bad links and bad second-factor codes are counted per network address. */
export const POST = handle(async (req) => {
  const ip = await clientIp();
  const input = await parseJson(req, schema);
  const key = `password-reset-use@${ip ?? "unknown"}`;
  const gate = await checkLoginAllowed(key, ip);
  if (!gate.allowed) return json({ error: "Too many attempts. Try again later.", code: "rate_limited" }, { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } });
  try {
    await resetPasswordWithToken(input.token, input.newPassword, { code: input.code, recoveryCode: input.recoveryCode }, { ip });
  } catch (err) {
    if (err instanceof AppError && (err.code === "reset_invalid" || err.code === "mfa_required")) await recordLoginFailure(key, ip);
    throw err;
  }
  return json({ ok: true });
});
