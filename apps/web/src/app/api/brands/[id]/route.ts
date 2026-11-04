import { z } from "zod";
import { prisma } from "@sm/db";
import { audit, isValidTimeZone } from "@sm/core";
import { apiUser, handle, json, parseJson, HttpError } from "@/lib/api";

const schema = z.object({ name: z.string().min(1).max(80).optional(), websiteUrl: z.string().url().optional().nullable().or(z.literal("")), timezone: z.string().optional(), locale: z.enum(["it", "en"]).optional(), color: z.string().max(16).optional().nullable(), archived: z.boolean().optional() });

export const PATCH = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const brand = await prisma.brand.findFirst({ where: { id, ownerId: user.id } });
  if (!brand) throw new HttpError(404, "Brand not found.", "not_found");
  const input = await parseJson(req, schema);
  if (input.timezone && !isValidTimeZone(input.timezone)) throw new HttpError(422, "Invalid timezone.", "validation");
  const updated = await prisma.brand.update({ where: { id }, data: { name: input.name, websiteUrl: input.websiteUrl === "" ? null : input.websiteUrl, timezone: input.timezone, locale: input.locale, color: input.color, archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null } });
  await audit({ actorUserId: user.id, brandId: id, action: "brand.update", details: input });
  return json({ brand: updated });
});
