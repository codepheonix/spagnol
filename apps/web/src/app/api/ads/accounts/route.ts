import { z } from "zod";
import { prisma } from "@sm/db";
import { audit } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson, HttpError } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  return json({ accounts: await prisma.adAccount.findMany({ where: { brandId: brand.id }, include: { _count: { select: { campaigns: true } } } }) });
});

/** Owner-only switches: read-only mode and the spend ceiling. */
export const PATCH = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, z.object({ id: z.string(), readOnly: z.boolean().optional(), spendCapMinor: z.number().int().min(0).nullable().optional() }));
  const acc = await prisma.adAccount.findFirst({ where: { id: input.id, brand: { ownerId: user.id } } });
  if (!acc) throw new HttpError(404, "Ad account not found.", "not_found");
  const updated = await prisma.adAccount.update({ where: { id: acc.id }, data: { readOnly: input.readOnly, spendCapMinor: input.spendCapMinor } });
  await audit({ actorUserId: user.id, brandId: acc.brandId, action: "ads.account.settings", targetId: acc.id, details: input });
  return json({ account: updated });
});
