import { z } from "zod";
import { confirmTotpEnrollment } from "@sm/core";
import { apiSession, handle, json, parseJson } from "@/lib/api";

/** The first correct code turns two-factor sign-in on. The recovery codes in the answer are shown once and never again. */
export const POST = handle(async (req) => {
  const { user, session } = await apiSession({ gate: false });
  const { code } = await parseJson(req, z.object({ code: z.string().min(6).max(12) }));
  const { recoveryCodes } = await confirmTotpEnrollment(user.id, code, session.id);
  return json({ ok: true, recoveryCodes }, { headers: { "cache-control": "no-store" } });
});
