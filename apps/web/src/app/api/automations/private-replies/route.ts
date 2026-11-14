import { z } from "zod";
import { prisma } from "@sm/db";
import { createPrivateReplyRule, listPrivateReplyRules } from "@sm/core";
import { apiBrand, apiUser, handle, HttpError, json, parseJson } from "@/lib/api";

const schema = z.object({
  brandId: z.string().optional(),
  socialAccountId: z.string().min(1),
  externalPostId: z.string().min(1),
  postLabel: z.string().max(160).optional().nullable(),
  postUrl: z.string().url().optional().nullable(),
  keyword: z.string().min(1).max(60),
  replyText: z.string().min(1).max(1000),
  enabled: z.boolean().default(true),
  name: z.string().max(120).optional().nullable(),
});

export const GET = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  const [rules, events, accounts] = await Promise.all([
    listPrivateReplyRules(brand.id),
    prisma.privateReply.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: "desc" }, take: 100, include: { socialAccount: { select: { displayName: true, provider: true } } } }),
    prisma.socialAccount.findMany({ where: { brandId: brand.id, backend: "native", provider: { in: ["instagram", "facebook"] }, status: { not: "disconnected" } }, select: { id: true, provider: true, displayName: true, username: true, metadata: true } }),
  ]);
  return json({ rules, events, accounts });
});

export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  const brand = await apiBrand(user, input.brandId);
  try {
    const rule = await createPrivateReplyRule(user.id, brand.id, input);
    return json({ rule }, { status: 201 });
  } catch (err) {
    throw new HttpError(422, (err as Error).message, "validation");
  }
});
