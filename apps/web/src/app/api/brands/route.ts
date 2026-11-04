import { z } from "zod";
import { prisma } from "@sm/db";
import { audit, isValidTimeZone } from "@sm/core";
import { apiUser, handle, json, parseJson, HttpError } from "@/lib/api";

const schema = z.object({ name: z.string().min(1).max(80), websiteUrl: z.string().url().optional().nullable().or(z.literal("")), timezone: z.string().default("Europe/Rome"), locale: z.enum(["it", "en"]).default("it"), color: z.string().max(16).optional().nullable() });

export const GET = handle(async () => {
  const user = await apiUser();
  return json({ brands: await prisma.brand.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: "asc" }, include: { _count: { select: { socialAccounts: true, posts: true } } } }) });
});

export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  if (!isValidTimeZone(input.timezone)) throw new HttpError(422, "Invalid timezone.", "validation");
  const base = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "brand";
  let slug = base;
  for (let i = 2; await prisma.brand.findFirst({ where: { ownerId: user.id, slug } }); i++) slug = `${base}-${i}`;
  const brand = await prisma.brand.create({ data: { ownerId: user.id, name: input.name, slug, websiteUrl: input.websiteUrl || null, timezone: input.timezone, locale: input.locale, color: input.color ?? null } });
  await audit({ actorUserId: user.id, brandId: brand.id, action: "brand.create" });
  return json({ brand }, { status: 201 });
});
