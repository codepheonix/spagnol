import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@sm/db";
import { getSecretSetting, setSecretSetting, setSetting, getSetting, audit } from "@sm/core";
import { ZernioClient } from "@sm/integrations";
import { apiUser, handle, json, parseJson } from "@/lib/api";
import { LOCALE_COOKIE } from "@/lib/auth";

const schema = z.object({ zernioApiKey: z.string().max(500).optional(), zernioWebhookSecret: z.string().max(500).optional(), aiApiKey: z.string().max(500).optional(), aiModel: z.string().max(120).optional(), locale: z.enum(["it", "en"]).optional(), timezone: z.string().max(64).optional() });

/** Secrets are write-only: the GET only says whether a value exists. */
export const GET = handle(async () => {
  const user = await apiUser();
  return json({
    zernioApiKey: Boolean((await getSecretSetting("zernio.apiKey")) ?? process.env.ZERNIO_API_KEY),
    zernioWebhookSecret: Boolean((await getSecretSetting("zernio.webhookSecret")) ?? process.env.ZERNIO_WEBHOOK_SECRET),
    aiApiKey: Boolean((await getSecretSetting("ai.apiKey")) ?? process.env.AI_API_KEY),
    aiModel: (await getSetting<string>("ai.model")) ?? process.env.AI_MODEL ?? "anthropic/claude-sonnet-4.5",
    locale: user.locale,
    timezone: user.timezone,
    storageDriver: process.env.STORAGE_DRIVER ?? "local",
    publicAppUrl: process.env.PUBLIC_APP_URL ?? null,
    nativeApps: { meta: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET), google: Boolean(process.env.GOOGLE_CLIENT_ID), linkedin: Boolean(process.env.LINKEDIN_CLIENT_ID), tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY), x: Boolean(process.env.X_CLIENT_ID) },
  });
});

export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  const changed: string[] = [];
  if (input.zernioApiKey !== undefined) {
    if (input.zernioApiKey) {
      // Verify the key before saving (one cheap call).
      await new ZernioClient(input.zernioApiKey).listProfiles();
    }
    await setSecretSetting("zernio.apiKey", input.zernioApiKey || null);
    changed.push("zernio.apiKey");
  }
  if (input.zernioWebhookSecret !== undefined) {
    await setSecretSetting("zernio.webhookSecret", input.zernioWebhookSecret || null);
    changed.push("zernio.webhookSecret");
  }
  if (input.aiApiKey !== undefined) {
    await setSecretSetting("ai.apiKey", input.aiApiKey || null);
    changed.push("ai.apiKey");
  }
  if (input.aiModel !== undefined) {
    await setSetting("ai.model", input.aiModel);
    changed.push("ai.model");
  }
  if (input.locale || input.timezone) {
    await prisma.user.update({ where: { id: user.id }, data: { locale: input.locale, timezone: input.timezone } });
    if (input.locale) (await cookies()).set(LOCALE_COOKIE, input.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    changed.push("user");
  }
  await audit({ actorUserId: user.id, action: "settings.update", details: { changed } });
  return json({ ok: true, changed });
});
