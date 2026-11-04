import { z } from "zod";
import { prisma } from "@sm/db";
import { isValidTimeZone } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson, HttpError } from "@/lib/api";

const schema = z.object({ brandId: z.string().optional(), socialAccountId: z.string().optional().nullable(), weekday: z.number().int().min(0).max(6), time: z.string().regex(/^\d{2}:\d{2}$/), timezone: z.string().default("Europe/Rome") });

export const GET = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  return json({ slots: await prisma.scheduleSlot.findMany({ where: { brandId: brand.id }, orderBy: [{ weekday: "asc" }, { time: "asc" }] }) });
});

export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  const brand = await apiBrand(user, input.brandId);
  if (!isValidTimeZone(input.timezone)) throw new HttpError(422, "Invalid timezone.", "validation");
  if (input.socialAccountId && !(await prisma.socialAccount.findFirst({ where: { id: input.socialAccountId, brandId: brand.id } }))) throw new HttpError(403, "Account not in this brand.", "cross_brand");
  const slot = await prisma.scheduleSlot.create({ data: { brandId: brand.id, socialAccountId: input.socialAccountId ?? null, weekday: input.weekday, time: input.time, timezone: input.timezone } });
  return json({ slot }, { status: 201 });
});
