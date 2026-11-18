import { z } from "zod";
import { regenerateRecoveryCodes } from "@sm/core";
import { apiSession, handle, json, parseJson } from "@/lib/api";

/** Replaces all recovery codes. Needs a current authenticator code; the old codes stop working. */
export const POST = handle(async (req) => {
  const { user } = await apiSession();
  const { code } = await parseJson(req, z.object({ code: z.string().min(6).max(12) }));
  return json({ recoveryCodes: await regenerateRecoveryCodes(user.id, { code }) }, { headers: { "cache-control": "no-store" } });
});
