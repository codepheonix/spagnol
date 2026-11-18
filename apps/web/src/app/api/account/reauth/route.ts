import { z } from "zod";
import { reauthenticate } from "@sm/core";
import { apiSession, handle, json, parseJson } from "@/lib/api";

const schema = z.object({ password: z.string().min(1).max(200), code: z.string().max(12).optional(), recoveryCode: z.string().max(40).optional() });

/** Confirms the password (and the second factor, when the account has one) for the next ten minutes of sensitive changes. */
export const POST = handle(async (req) => {
  const { user, session } = await apiSession();
  await reauthenticate(user.id, session.id, await parseJson(req, schema));
  return json({ ok: true });
});
