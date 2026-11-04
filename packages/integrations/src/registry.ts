import type { AdapterBackend, ProviderDescriptor, ProviderId, SocialAdapter } from "./contract";
import { telegramAdapter } from "./telegram/index";
import { blueskyAdapter } from "./bluesky/index";
import { discordAdapter } from "./discord/index";
import { slackAdapter } from "./slack/index";
import { facebookAdapter, instagramAdapter } from "./meta/index";
import { makeZernioAdapter, ZERNIO_PLATFORM_MAP } from "./zernio/adapter";

export const PROVIDER_IDS: ProviderId[] = ["facebook", "instagram", "threads", "youtube", "linkedin", "tiktok", "pinterest", "x", "reddit", "bluesky", "googlebusiness", "telegram", "discord", "slack", "whatsapp", "snapchat"];

/** Native adapters implemented in this repo. */
const NATIVE: Partial<Record<ProviderId, SocialAdapter>> = {
  telegram: telegramAdapter,
  bluesky: blueskyAdapter,
  discord: discordAdapter,
  slack: slackAdapter,
  facebook: facebookAdapter,
  instagram: instagramAdapter,
};

/** Native providers not yet implemented natively (available through the Zernio gateway). */
const NATIVE_PLANNED: Partial<Record<ProviderId, ProviderDescriptor>> = {
  threads: planned("threads", "Threads", "https://developers.facebook.com/docs/threads", ["META_APP_ID", "META_APP_SECRET"]),
  youtube: planned("youtube", "YouTube", "https://developers.google.com/youtube/v3/docs/videos/insert", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]),
  linkedin: planned("linkedin", "LinkedIn", "https://learn.microsoft.com/linkedin/marketing/", ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"]),
  pinterest: planned("pinterest", "Pinterest", "https://developers.pinterest.com/docs/api/v5/", ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"]),
  reddit: planned("reddit", "Reddit", "https://www.reddit.com/dev/api/", ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], "AWAITING_PLATFORM_APPROVAL"),
  tiktok: planned("tiktok", "TikTok", "https://developers.tiktok.com/doc/content-posting-api-get-started", ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], "AWAITING_PLATFORM_APPROVAL"),
  x: planned("x", "X (Twitter)", "https://docs.x.com/x-api", ["X_CLIENT_ID", "X_CLIENT_SECRET"]),
  googlebusiness: planned("googlebusiness", "Google Business Profile", "https://developers.google.com/my-business/content/prereqs", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], "AWAITING_PLATFORM_APPROVAL"),
  whatsapp: planned("whatsapp", "WhatsApp Business", "https://developers.facebook.com/docs/whatsapp/cloud-api", ["META_APP_ID", "META_APP_SECRET"]),
  snapchat: planned("snapchat", "Snapchat", "https://developers.snap.com/", [], "AWAITING_PLATFORM_APPROVAL"),
};

function planned(id: ProviderId, displayName: string, docsUrl: string, requiredEnv: string[], status: ProviderDescriptor["implementationStatus"] = "NOT_IMPLEMENTED"): ProviderDescriptor {
  return { id, backend: "native", displayName: `${displayName} (native)`, connect: { kind: "oauth", notes: "Native adapter not implemented yet — use the Zernio backend for this platform." }, capabilities: { connect: "not_tested" }, limits: {}, implementationStatus: status, docsUrl, requiredEnv };
}

const zernioCache = new Map<ProviderId, SocialAdapter>();

export function getAdapter(provider: ProviderId, backend: AdapterBackend): SocialAdapter {
  if (backend === "zernio") {
    let a = zernioCache.get(provider);
    if (!a) {
      a = makeZernioAdapter(provider);
      zernioCache.set(provider, a);
    }
    return a;
  }
  const native = NATIVE[provider];
  if (!native) throw new Error(`No native adapter implemented for ${provider}. Use backend=zernio.`);
  return native;
}

export function hasNativeAdapter(provider: ProviderId): boolean {
  return Boolean(NATIVE[provider]);
}

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as string[]).includes(value);
}

/** Every provider × backend with its descriptor, for the capability matrix UI and docs. */
export function listDescriptors(): ProviderDescriptor[] {
  const out: ProviderDescriptor[] = [];
  for (const id of PROVIDER_IDS) {
    const native = NATIVE[id]?.descriptor ?? NATIVE_PLANNED[id];
    if (native) out.push(native);
    if (ZERNIO_PLATFORM_MAP[id]) out.push(getAdapter(id, "zernio").descriptor);
  }
  return out;
}

export function nativeEnvMissing(descriptor: ProviderDescriptor): string[] {
  return (descriptor.requiredEnv ?? []).filter((k) => !process.env[k]);
}
