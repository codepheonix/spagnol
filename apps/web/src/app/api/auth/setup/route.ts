import { z } from "zod";
import { prisma } from "@sm/db";
import { hashPassword } from "@sm/security";
import { audit } from "@sm/core";
import { handle, json, parseJson, HttpError } from "@/lib/api";

const schema = z.object({ email: z.string().email(), password: z.string().min(10).max(200), name: z.string().max(80).optional(), brandName: z.string().min(1).max(80).default("Default brand"), setupToken: z.string().optional() });

/** First-run owner creation. Only works while no user exists; optionally gated by SETUP_TOKEN. */
export const POST = handle(async (req) => {
  const count = await prisma.user.count();
  if (count > 0) throw new HttpError(409, "Setup already completed.", "already_setup");
  const input = await parseJson(req, schema);
  if (process.env.SETUP_TOKEN && input.setupToken !== process.env.SETUP_TOKEN) throw new HttpError(403, "Invalid setup token.", "setup_token");
  const user = await prisma.user.create({ data: { email: input.email.toLowerCase(), name: input.name, passwordHash: await hashPassword(input.password), timezone: process.env.DEFAULT_TIMEZONE ?? "Europe/Rome", locale: process.env.DEFAULT_LOCALE ?? "it" } });
  await prisma.brand.create({ data: { ownerId: user.id, name: input.brandName, slug: input.brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "brand", timezone: user.timezone, locale: user.locale } });
  await audit({ actorUserId: user.id, action: "auth.setup" });
  return json({ ok: true });
});

export const GET = handle(async () => json({ needsSetup: (await prisma.user.count()) === 0 }));
