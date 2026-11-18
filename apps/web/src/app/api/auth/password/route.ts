import { z } from "zod";
import { changePassword } from "@sm/core";
import { apiSession, handle, json, parseJson } from "@/lib/api";
import { clientIp } from "@/lib/auth";

const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

/**
 * Password change. Works while the account is held at "change your password" (`gate: false`).
 * Rules, reuse and breach checks are in packages/core/src/account-security.ts; every other session
 * is signed out.
 */
export const POST = handle(async (req) => {
  const { user, session } = await apiSession({ gate: false });
  const { currentPassword, newPassword } = await parseJson(req, schema);
  await changePassword(user.id, { current: currentPassword, next: newPassword, keepSessionId: session.id, ip: await clientIp() });
  return json({ ok: true });
});
