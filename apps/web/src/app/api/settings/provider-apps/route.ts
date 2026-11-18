import { z } from "zod";
import { audit, providerAppStatus, setProviderAppValue } from "@sm/core";
import { verifyMetaApp } from "@sm/integrations";
import { apiUser, handle, json, parseJson, HttpError, apiUserRecentAuth } from "@/lib/api";

/** Booleans only: provider app secrets are write-only and never returned to the browser. */
export const GET = handle(async () => {
  await apiUser();
  return json({ configured: await providerAppStatus() });
});

const schema = z.object({
  metaAppId: z.string().trim().max(40).optional(),
  metaAppSecret: z.string().trim().max(200).optional(),
  metaLoginConfigId: z.string().trim().max(40).optional(),
  metaExtendedScopes: z.boolean().optional(),
  instagramAppId: z.string().trim().max(40).optional(),
  instagramAppSecret: z.string().trim().max(200).optional(),
  clear: z.enum(["meta", "instagram"]).optional(),
});

/**
 * One-time provider app setup. The Meta pair is checked against Meta (app access token) before it
 * is stored encrypted, so a typo is caught here and not on the first sign-in.
 */
export const POST = handle(async (req) => {
  const user = await apiUserRecentAuth();
  const input = await parseJson(req, schema);
  const changed: string[] = [];
  let metaAppName: string | null = null;
  if (input.clear === "meta") {
    for (const k of ["META_APP_ID", "META_APP_SECRET", "META_LOGIN_CONFIG_ID", "META_EXTENDED_SCOPES"] as const) await setProviderAppValue(k, null);
    changed.push("meta:cleared");
  }
  if (input.clear === "instagram") {
    for (const k of ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"] as const) await setProviderAppValue(k, null);
    changed.push("instagram:cleared");
  }
  if (input.metaAppId || input.metaAppSecret) {
    if (!input.metaAppId || !input.metaAppSecret) throw new HttpError(422, "Enter both the App ID and the App secret.", "validation");
    if (!/^\d{5,25}$/.test(input.metaAppId)) throw new HttpError(422, "The App ID is the number shown at the top of the Meta app dashboard (digits only).", "validation");
    const app = await verifyMetaApp(input.metaAppId, input.metaAppSecret);
    metaAppName = app.name;
    await setProviderAppValue("META_APP_ID", input.metaAppId);
    await setProviderAppValue("META_APP_SECRET", input.metaAppSecret);
    changed.push("meta");
  }
  if (input.metaLoginConfigId !== undefined) {
    await setProviderAppValue("META_LOGIN_CONFIG_ID", input.metaLoginConfigId || null);
    changed.push("meta.configId");
  }
  if (input.metaExtendedScopes !== undefined) {
    await setProviderAppValue("META_EXTENDED_SCOPES", input.metaExtendedScopes ? "1" : null);
    changed.push("meta.extendedScopes");
  }
  if (input.instagramAppId || input.instagramAppSecret) {
    if (!input.instagramAppId || !input.instagramAppSecret) throw new HttpError(422, "Enter both the Instagram app ID and the Instagram app secret.", "validation");
    await setProviderAppValue("INSTAGRAM_APP_ID", input.instagramAppId);
    await setProviderAppValue("INSTAGRAM_APP_SECRET", input.instagramAppSecret);
    changed.push("instagram");
  }
  await audit({ actorUserId: user.id, action: "settings.provider_app", details: { changed } });
  return json({ ok: true, changed, metaAppName, configured: await providerAppStatus() });
});
