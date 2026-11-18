import { z } from "zod";
import { prisma } from "@sm/db";
import { hashPassword } from "@sm/security";
import { audit, checkPasswordStrength } from "@sm/core";
import { handle, json, parseJson, HttpError } from "@/lib/api";
import { setupState } from "@/lib/setup";

const schema = z.object({ email: z.string().email(), password: z.string().min(1).max(200), name: z.string().max(80).optional(), setupToken: z.string().optional() });

/** First-run owner creation, or claiming a pre-created owner that has no password yet. Optionally gated by SETUP_TOKEN. */
export const POST = handle(async (req) => {
  const state = await setupState();
  if (!state.needsSetup) throw new HttpError(409, "Setup already completed.", "already_setup");
  const input = await parseJson(req, schema);
  if (process.env.SETUP_TOKEN && input.setupToken !== process.env.SETUP_TOKEN) throw new HttpError(403, "Invalid setup token.", "setup_token");
  const strength = checkPasswordStrength(input.password, { email: input.email, name: input.name });
  if (!strength.ok) throw new HttpError(422, strength.problems.join(" "), "weak_password");
  // The owner has a week to turn two-factor sign-in on; after that nothing else opens until it is.
  const mfaGraceUntil = new Date(Date.now() + 7 * 24 * 3600_000);
  if (state.claimEmail) {
    if (input.email.toLowerCase() !== state.claimEmail.toLowerCase()) throw new HttpError(403, `This installation is reserved for ${state.claimEmail}.`, "wrong_email");
    const user = await prisma.user.update({ where: { email: state.claimEmail }, data: { passwordHash: await hashPassword(input.password), name: input.name || undefined, passwordChangedAt: new Date(), mfaGraceUntil } });
    await audit({ actorUserId: user.id, action: "auth.claim" });
    return json({ ok: true });
  }
  const user = await prisma.user.create({ data: { email: input.email.toLowerCase(), name: input.name, passwordHash: await hashPassword(input.password), timezone: process.env.DEFAULT_TIMEZONE ?? "Europe/Rome", locale: "en", passwordChangedAt: new Date(), mfaGraceUntil } });
  // No workspace is created here: a new installation starts neutral and the owner chooses what to add.
  await audit({ actorUserId: user.id, action: "auth.setup" });
  return json({ ok: true });
});

export const GET = handle(async () => json(await setupState()));
