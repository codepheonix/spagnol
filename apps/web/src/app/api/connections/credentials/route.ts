import { z } from "zod";
import { connectWithCredentials, parseProvider } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson } from "@/lib/api";

const schema = z.object({ brandId: z.string().optional(), provider: z.string(), fields: z.record(z.string()) });

/** Credential-form connections (Telegram, Bluesky, Discord, Slack). Secrets go straight to the encrypted store. */
export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  const brand = await apiBrand(user, input.brandId);
  const accounts = await connectWithCredentials({ brandId: brand.id, userId: user.id, provider: parseProvider(input.provider), fields: input.fields });
  return json({ accounts }, { status: 201 });
});
