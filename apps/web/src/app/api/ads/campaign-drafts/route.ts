import { z } from "zod";
import { prisma } from "@sm/db";
import { audit } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson, HttpError } from "@/lib/api";

const schema = z.object({ brandId: z.string().optional(), adAccountId: z.string(), name: z.string().min(1).max(120), spec: z.object({ objective: z.string(), budget: z.object({ amount: z.number().positive(), type: z.enum(["daily", "lifetime"]) }), currency: z.string().length(3).optional(), targeting: z.record(z.unknown()).default({}), creative: z.record(z.unknown()).default({}), schedule: z.object({ start: z.string().optional(), end: z.string().optional() }).default({}) }) });

export const GET = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  return json({ drafts: await prisma.adCampaignDraft.findMany({ where: { brandId: brand.id }, orderBy: { updatedAt: "desc" } }) });
});

export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  const brand = await apiBrand(user, input.brandId);
  const acc = await prisma.adAccount.findFirst({ where: { id: input.adAccountId, brandId: brand.id } });
  if (!acc) throw new HttpError(404, "Ad account not found in this brand.", "not_found");
  const draft = await prisma.adCampaignDraft.create({ data: { brandId: brand.id, adAccountId: acc.id, name: input.name, spec: input.spec as object } });
  await audit({ actorUserId: user.id, brandId: brand.id, action: "ads.draft.create", targetId: draft.id });
  return json({ draft }, { status: 201 });
});
