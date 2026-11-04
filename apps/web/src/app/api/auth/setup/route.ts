import { z } from "zod";
import { prisma } from "@sm/db";
import { hashPassword } from "@sm/security";
import { audit } from "@sm/core";
import { handle, json, parseJson, HttpError } from "@/lib/api";
import { setupState } from "@/lib/setup";

const schema = z.object({ email: z.string().email(), password: z.string().min(10).max(200), name: z.string().max(80).optional(), brandName: z.string().min(1).max(80).default("Default brand"), setupToken: z.string().optional() });

/** First-run owner creation, or claiming a pre-created owner that has no password yet. Optionally gated by SETUP_TOKEN. */
export const POST = handle(async (req) => {
  const state = await setupState();
  if (!state.needsSetup) throw new HttpError(409, "Setup already completed.", "already_setup");
  const input = await parseJson(req, schema);
  if (process.env.SETUP_TOKEN && input.setupToken !== process.env.SETUP_TOKEN) throw new HttpError(403, "Invalid setup token.", "setup_token");
  if (state.claimEmail) {
    if (input.email.toLowerCase() !== state.claimEmail.toLowerCase()) throw new HttpError(403, `This installation is reserved for ${state.claimEmail}.`, "wrong_email");
    const user = await prisma.user.update({ where: { email: state.claimEmail }, data: { passwordHash: await hashPassword(input.password), name: input.name || undefined } });
    await audit({ actorUserId: user.id, action: "auth.claim" });
    return json({ ok: true });
  }
  const user = await prisma.user.create({ data: { email: input.email.toLowerCase(), name: input.name, passwordHash: await hashPassword(input.password), timezone: process.env.DEFAULT_TIMEZONE ?? "Europe/Rome", locale: process.env.DEFAULT_LOCALE ?? "it" } });
  await prisma.brand.create({ data: { ownerId: user.id, name: input.brandName, slug: input.brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "brand", timezone: user.timezone, locale: user.locale } });
  await audit({ actorUserId: user.id, action: "auth.setup" });
  return json({ ok: true });
});

export const GET = handle(async () => json(await setupState()));
