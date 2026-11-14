import { prisma } from "@sm/db";
import { decryptJson, encryptJson, type EncryptedBlob } from "@sm/security";

/** Encrypted application settings (e.g. the Zernio API key) stored in SystemSetting. */
export async function setSecretSetting(key: string, value: string | null): Promise<void> {
  if (value === null || value === "") {
    await prisma.systemSetting.deleteMany({ where: { key } });
    return;
  }
  const blob = encryptJson({ v: value });
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: blob as object, encrypted: true }, update: { value: blob as object, encrypted: true } });
}

export async function getSecretSetting(key: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (!row) return null;
  if (!row.encrypted) return typeof row.value === "string" ? row.value : null;
  return decryptJson<{ v: string }>(row.value as unknown as EncryptedBlob).v;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as object, encrypted: false }, update: { value: value as object, encrypted: false } });
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (!row || row.encrypted) return null;
  return row.value as T;
}

export interface ZernioConfig {
  apiKey: string;
  baseUrl: string;
  webhookSecret?: string | null;
}

/** Zernio key: Settings page (encrypted in DB) wins over the environment variable. */
export async function getZernioConfig(): Promise<ZernioConfig | null> {
  const fromDb = await getSecretSetting("zernio.apiKey");
  const apiKey = fromDb ?? process.env.ZERNIO_API_KEY ?? null;
  if (!apiKey) return null;
  const webhookSecret = (await getSecretSetting("zernio.webhookSecret")) ?? process.env.ZERNIO_WEBHOOK_SECRET ?? null;
  return { apiKey, baseUrl: process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api", webhookSecret };
}

export async function getAiConfig(): Promise<{ apiKey: string; baseUrl: string; model: string } | null> {
  const apiKey = (await getSecretSetting("ai.apiKey")) ?? process.env.AI_API_KEY ?? null;
  if (!apiKey) return null;
  return { apiKey, baseUrl: process.env.AI_API_BASE ?? "https://openrouter.ai/api/v1", model: ((await getSetting<string>("ai.model")) ?? process.env.AI_MODEL ?? "anthropic/claude-sonnet-4.5") as string };
}

// ---------------------------------------------------------------------------
// Provider app credentials (the one-time registration each network asks of an app)
// ---------------------------------------------------------------------------

/** Names that may be stored through the in-app setup. Anything else is rejected. */
export const PROVIDER_APP_KEYS = ["META_APP_ID", "META_APP_SECRET", "META_LOGIN_CONFIG_ID", "META_EXTENDED_SCOPES", "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"] as const;
export type ProviderAppKey = (typeof PROVIDER_APP_KEYS)[number];

/** In-app setup (encrypted in SystemSetting `app.<NAME>`) wins over the environment variable. */
export async function getProviderAppValue(name: string): Promise<string | null> {
  const fromDb = await getSecretSetting(`app.${name}`).catch(() => null);
  return fromDb ?? process.env[name] ?? null;
}

export async function setProviderAppValue(name: ProviderAppKey, value: string | null): Promise<void> {
  if (!(PROVIDER_APP_KEYS as readonly string[]).includes(name)) throw new Error(`Unknown provider app setting ${name}`);
  await setSecretSetting(`app.${name}`, value);
}

/** Resolves a set of app credential names; `missing` lists the ones configured nowhere. */
export async function resolveProviderApp(required: string[], optional: string[] = []): Promise<{ values: Record<string, string>; missing: string[] }> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const k of required) {
    const v = await getProviderAppValue(k);
    if (v) values[k] = v;
    else missing.push(k);
  }
  for (const k of optional) {
    const v = await getProviderAppValue(k);
    if (v) values[k] = v;
  }
  return { values, missing };
}

/** Which app credential names are configured (booleans only; values never leave the server). */
export async function providerAppStatus(): Promise<Record<ProviderAppKey, boolean>> {
  const out = {} as Record<ProviderAppKey, boolean>;
  for (const k of PROVIDER_APP_KEYS) out[k] = Boolean(await getProviderAppValue(k));
  return out;
}
