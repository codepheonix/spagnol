import { z } from "zod";
import { generateDraft, audit } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson } from "@/lib/api";

const schema = z.object({ brandId: z.string().optional(), brief: z.string().min(3).max(4000), platform: z.string().default("instagram"), language: z.enum(["it", "en"]).default("it"), tone: z.string().max(100).optional(), hashtags: z.boolean().default(true), maxLength: z.number().int().min(50).max(5000).optional() });

/** Returns a draft for review; nothing is published or sent. */
export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  const brand = await apiBrand(user, input.brandId);
  const r = await generateDraft({ brandName: brand.name, brief: input.brief, platform: input.platform, language: input.language, tone: input.tone, hashtags: input.hashtags, maxLength: input.maxLength });
  await audit({ actorUserId: user.id, brandId: brand.id, action: "ai.draft", details: { model: r.model, platform: input.platform } });
  return json(r);
});
