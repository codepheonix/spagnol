import { z } from "zod";
import { disableTotp } from "@sm/core";
import { apiSession, handle, json, parseJson } from "@/lib/api";

const schema = z.object({ password: z.string().min(1).max(200), code: z.string().max(12).optional(), recoveryCode: z.string().max(40).optional() });

/** Turning two-factor off needs the password and a second factor: a stolen password alone cannot remove it. */
export const POST = handle(async (req) => {
  const { user } = await apiSession();
  await disableTotp(user.id, await parseJson(req, schema));
  return json({ ok: true });
});
