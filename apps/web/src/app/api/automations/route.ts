import { z } from "zod";
import { prisma } from "@sm/db";
import { audit } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson } from "@/lib/api";

const TRIGGERS = ["publish_completed", "publish_failed", "account_disconnected", "comment_keyword", "message_received", "lead_received", "review_received"] as const;
const ACTIONS = ["notify_owner", "create_draft", "tag_contact"] as const;

const schema = z.object({ brandId: z.string().optional(), name: z.string().min(1).max(120), trigger: z.object({ type: z.enum(TRIGGERS), filters: z.record(z.unknown()).default({}) }), actions: z.array(z.object({ type: z.enum(ACTIONS), params: z.record(z.unknown()).default({}) })).min(1).max(5), enabled: z.boolean().default(false), cooldownMinutes: z.number().int().min(1).max(10080).default(60), perContactCap: z.number().int().min(1).max(50).default(3) });

export const GET = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  return json({ rules: await prisma.automationRule.findMany({ where: { brandId: brand.id }, include: { _count: { select: { runs: true } } } }), triggers: TRIGGERS, actions: ACTIONS, note: "Only non-messaging actions are enabled; sending replies/DMs automatically stays off until provider policy checks are live-verified." });
});

export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  const brand = await apiBrand(user, input.brandId);
  const rule = await prisma.automationRule.create({ data: { brandId: brand.id, name: input.name, trigger: input.trigger as object, actions: input.actions as object, enabled: input.enabled, cooldownMinutes: input.cooldownMinutes, perContactCap: input.perContactCap } });
  await audit({ actorUserId: user.id, brandId: brand.id, action: "automation.create", targetId: rule.id });
  return json({ rule }, { status: 201 });
});
