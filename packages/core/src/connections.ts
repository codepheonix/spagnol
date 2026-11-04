import { prisma, type SocialAccount } from "@sm/db";
import { createOAuthState, createPkcePair, decryptJson, encryptJson, type EncryptedBlob } from "@sm/security";
import { getAdapter, hasNativeAdapter, isProviderId, nativeEnvMissing, ProviderError, ZernioClient, ZERNIO_PLATFORM_MAP, type AccountContext, type AdapterBackend, type ConnectResult, type ProviderId, type SocialAdapter } from "@sm/integrations";
import { audit, notify } from "./audit";
import { getZernioConfig } from "./settings";
import { enqueue } from "./queue";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "bad_request",
  ) {
    super(message);
  }
}

export function appUrl(): string {
  const u = process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return u.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Credentials at rest
// ---------------------------------------------------------------------------

export async function storeCredentials(socialAccountId: string, credentials: Record<string, unknown>, expiresAt?: Date | null, refreshExpiresAt?: Date | null) {
  const blob = encryptJson(credentials);
  await prisma.socialAccountToken.upsert({
    where: { socialAccountId },
    create: { socialAccountId, ciphertext: blob.ciphertext, iv: blob.iv, authTag: blob.authTag, keyVersion: blob.keyVersion, expiresAt: expiresAt ?? null, refreshExpiresAt: refreshExpiresAt ?? null },
    update: { ciphertext: blob.ciphertext, iv: blob.iv, authTag: blob.authTag, keyVersion: blob.keyVersion, expiresAt: expiresAt ?? null, refreshExpiresAt: refreshExpiresAt ?? null, rotatedAt: new Date() },
  });
}

export async function loadCredentials(socialAccountId: string): Promise<Record<string, unknown>> {
  const t = await prisma.socialAccountToken.findUnique({ where: { socialAccountId } });
  if (!t) return {};
  const blob: EncryptedBlob = { ciphertext: t.ciphertext, iv: t.iv, authTag: t.authTag, keyVersion: t.keyVersion };
  return decryptJson<Record<string, unknown>>(blob);
}

export async function buildAccountContext(account: SocialAccount): Promise<AccountContext> {
  const credentials = await loadCredentials(account.id);
  const ctx: AccountContext = {
    accountId: account.id,
    brandId: account.brandId,
    provider: account.provider as ProviderId,
    backend: account.backend,
    externalAccountId: account.externalAccountId,
    accountType: account.accountType,
    metadata: (account.metadata as Record<string, unknown>) ?? {},
    credentials,
  };
  if (account.backend === "zernio") {
    const z = await getZernioConfig();
    if (!z) throw new AppError("Zernio API key is not configured. Add it in Settings.", 412, "zernio_not_configured");
    ctx.gateway = { apiKey: z.apiKey, baseUrl: z.baseUrl, profileId: account.gatewayProfileId ?? undefined, accountId: account.gatewayAccountId ?? undefined };
  }
  return ctx;
}

export function adapterFor(account: Pick<SocialAccount, "provider" | "backend">): SocialAdapter {
  return getAdapter(account.provider as ProviderId, account.backend);
}

// ---------------------------------------------------------------------------
// Connect flows
// ---------------------------------------------------------------------------

export function parseProvider(value: string): ProviderId {
  if (!isProviderId(value)) throw new AppError(`Unknown provider "${value}".`, 404, "unknown_provider");
  return value;
}

export function parseBackend(value: string | null | undefined): AdapterBackend {
  if (value === "zernio") return "zernio";
  return "native";
}

/** Step 1 of a connection: returns a URL to redirect the browser to (OAuth / gateway) or `null` for credential forms. */
export async function startConnection(input: { brandId: string; userId: string; provider: ProviderId; backend: AdapterBackend; options?: Record<string, string> }): Promise<{ redirectUrl: string | null; descriptor: SocialAdapter["descriptor"] }> {
  const brand = await prisma.brand.findFirst({ where: { id: input.brandId, ownerId: input.userId, archivedAt: null } });
  if (!brand) throw new AppError("Brand not found.", 404, "not_found");
  if (input.backend === "native" && !hasNativeAdapter(input.provider)) throw new AppError(`No native adapter for ${input.provider} yet — connect it through Zernio.`, 400, "native_not_implemented");
  const adapter = getAdapter(input.provider, input.backend);
  const d = adapter.descriptor;
  const missing = nativeEnvMissing(d);
  if (missing.length) throw new AppError(`Missing provider app credentials: ${missing.join(", ")}. See docs/credential-register.md.`, 412, "missing_env");
  if (d.connect.kind === "credentials") return { redirectUrl: null, descriptor: d };

  const state = createOAuthState();
  const redirectUri = `${appUrl()}/api/oauth/${input.provider}/callback`;
  const extra: Record<string, string> = { ...(input.options ?? {}) };
  let codeVerifier: string | undefined;
  const payload: Record<string, unknown> = {};
  if (input.backend === "zernio") {
    const z = await getZernioConfig();
    if (!z) throw new AppError("Zernio API key is not configured. Add it in Settings first.", 412, "zernio_not_configured");
    const client = new ZernioClient(z.apiKey, z.baseUrl);
    const profile = await client.ensureProfile(brand.id, brand.name, brand.timezone);
    extra.apiKey = z.apiKey;
    extra.baseUrl = z.baseUrl;
    extra.profileId = profile._id;
    payload.profileId = profile._id;
  } else {
    const pkce = createPkcePair();
    codeVerifier = pkce.verifier;
    extra.codeChallenge = pkce.challenge;
  }
  await prisma.oAuthState.create({ data: { state, brandId: brand.id, provider: input.provider, backend: input.backend, codeVerifier, redirectUri, payload: payload as object, expiresAt: new Date(Date.now() + 15 * 60_000) } });
  if (!adapter.buildAuthorizationUrl) throw new AppError("Adapter cannot start OAuth.", 500, "adapter_error");
  const url = await adapter.buildAuthorizationUrl({ brandId: brand.id, state, redirectUri, codeChallenge: extra.codeChallenge, extra });
  await audit({ actorUserId: input.userId, brandId: brand.id, action: "connection.start", targetType: "provider", targetId: `${input.provider}:${input.backend}` });
  return { redirectUrl: url, descriptor: d };
}

/** Step 2: provider redirected back. Verifies state exactly once, exchanges server-side, persists accounts. */
export async function completeOAuthCallback(provider: ProviderId, params: Record<string, string>): Promise<{ brandId: string; accounts: SocialAccount[] }> {
  const state = params.state;
  if (!state) throw new AppError("Missing OAuth state.", 400, "oauth_state");
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (!row || row.provider !== provider) throw new AppError("Unknown OAuth state (possible replay or mismatch).", 400, "oauth_state");
  if (row.consumedAt) throw new AppError("This OAuth callback was already used.", 400, "oauth_replay");
  if (row.expiresAt < new Date()) throw new AppError("OAuth state expired — start the connection again.", 400, "oauth_expired");
  // Anti-replay: consume atomically.
  const consumed = await prisma.oAuthState.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (consumed.count !== 1) throw new AppError("This OAuth callback was already used.", 400, "oauth_replay");

  const adapter = getAdapter(provider, row.backend);
  if (!adapter.exchangeAuthorizationCode) throw new AppError("Adapter cannot complete OAuth.", 500, "adapter_error");
  const callbackParams = { ...params };
  if (row.backend === "zernio") {
    const z = await getZernioConfig();
    if (!z) throw new AppError("Zernio API key missing.", 412, "zernio_not_configured");
    callbackParams.__apiKey = z.apiKey;
    callbackParams.__baseUrl = z.baseUrl;
    callbackParams.__profileId = String((row.payload as { profileId?: string }).profileId ?? "");
  }
  let result: ConnectResult;
  try {
    result = await adapter.exchangeAuthorizationCode({ code: params.code ?? "", state, redirectUri: row.redirectUri, codeVerifier: row.codeVerifier ?? undefined, callbackParams });
  } catch (err) {
    await audit({ brandId: row.brandId, action: "connection.complete", outcome: "error", targetType: "provider", targetId: provider, details: { error: (err as Error).message } });
    throw err;
  }
  const accounts = await persistConnectResult(row.brandId, provider, row.backend, result, (row.payload as { profileId?: string }).profileId);
  return { brandId: row.brandId, accounts };
}

/** Credential-form connection (Telegram bot token, Bluesky app password, Discord/Slack bot tokens). */
export async function connectWithCredentials(input: { brandId: string; userId: string; provider: ProviderId; fields: Record<string, string> }): Promise<SocialAccount[]> {
  const brand = await prisma.brand.findFirst({ where: { id: input.brandId, ownerId: input.userId, archivedAt: null } });
  if (!brand) throw new AppError("Brand not found.", 404, "not_found");
  const adapter = getAdapter(input.provider, "native");
  if (!adapter.connectWithCredentials) throw new AppError("This provider uses OAuth, not credentials.", 400, "wrong_flow");
  const result = await adapter.connectWithCredentials(input.fields);
  const accounts = await persistConnectResult(brand.id, input.provider, "native", result);
  await audit({ actorUserId: input.userId, brandId: brand.id, action: "connection.credentials", targetType: "social_account", targetId: accounts.map((a) => a.id).join(","), outcome: "ok" });
  return accounts;
}

async function persistConnectResult(brandId: string, provider: ProviderId, backend: AdapterBackend, result: ConnectResult, gatewayProfileId?: string): Promise<SocialAccount[]> {
  const out: SocialAccount[] = [];
  for (const acc of result.accounts) {
    const creds = { ...result.credentials, ...(result.perAccountCredentials?.[acc.externalAccountId] ?? {}) };
    const gatewayAccountId = (acc.metadata?.zernioAccountId as string | undefined) ?? null;
    const account = await prisma.socialAccount.upsert({
      where: { brandId_provider_externalAccountId_backend: { brandId, provider, externalAccountId: acc.externalAccountId, backend } },
      create: { brandId, provider, backend, externalAccountId: acc.externalAccountId, accountType: acc.accountType, displayName: acc.displayName, username: acc.username, profileUrl: acc.profileUrl, avatarUrl: acc.avatarUrl, scopes: acc.scopes ?? [], status: "connected", healthStatus: "unknown", tokenExpiresAt: result.expiresAt ?? null, gatewayAccountId, gatewayProfileId: gatewayProfileId ?? null, metadata: (acc.metadata ?? {}) as object },
      update: { accountType: acc.accountType, displayName: acc.displayName, username: acc.username, profileUrl: acc.profileUrl, avatarUrl: acc.avatarUrl, scopes: acc.scopes ?? [], status: "connected", lastError: null, tokenExpiresAt: result.expiresAt ?? null, gatewayAccountId, gatewayProfileId: gatewayProfileId ?? null, metadata: (acc.metadata ?? {}) as object },
    });
    await storeCredentials(account.id, creds, result.expiresAt, result.refreshExpiresAt);
    await enqueue("check_account_health", { socialAccountId: account.id }, { dedupeKey: `health:${account.id}`, brandId });
    out.push(account);
  }
  return out;
}

export async function checkAccountHealth(socialAccountId: string): Promise<SocialAccount> {
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: socialAccountId } });
  try {
    const ctx = await buildAccountContext(account);
    const adapter = adapterFor(account);
    const h = await adapter.verifyConnection(ctx);
    const caps = await adapter.discoverCapabilities(ctx);
    const status = h.ok ? "connected" : h.message?.toLowerCase().includes("token") || h.message?.toLowerCase().includes("auth") ? "needs_reconnect" : "error";
    const updated = await prisma.socialAccount.update({ where: { id: account.id }, data: { healthStatus: h.status, status, lastCheckedAt: new Date(), lastError: h.ok ? null : (h.message ?? "health check failed"), tokenExpiresAt: h.expiresAt ?? account.tokenExpiresAt, metadata: { ...(account.metadata as object), capabilities: caps, healthDetails: (h.details ?? {}) as object } as object } });
    if (!h.ok && account.healthStatus !== "error") await notify({ brandId: account.brandId, level: "warning", title: `${account.displayName} needs attention`, body: h.message, link: `/accounts` });
    return updated;
  } catch (err) {
    const e = err as Error;
    return prisma.socialAccount.update({ where: { id: account.id }, data: { healthStatus: "error", status: err instanceof ProviderError && err.options.category === "auth_expired" ? "needs_reconnect" : "error", lastCheckedAt: new Date(), lastError: e.message } });
  }
}

export async function disconnectAccount(input: { socialAccountId: string; userId: string; revokeRemote: boolean }): Promise<void> {
  const account = await prisma.socialAccount.findFirst({ where: { id: input.socialAccountId, brand: { ownerId: input.userId } } });
  if (!account) throw new AppError("Account not found.", 404, "not_found");
  let remoteRevoked = false;
  if (input.revokeRemote) {
    try {
      const adapter = adapterFor(account);
      if (adapter.revoke) {
        await adapter.revoke(await buildAccountContext(account));
        remoteRevoked = true;
      }
    } catch (err) {
      await audit({ actorUserId: input.userId, brandId: account.brandId, action: "connection.revoke_remote", outcome: "error", targetId: account.id, details: { error: (err as Error).message } });
    }
  }
  // Stop queued publications for this account, then delete secrets locally.
  await prisma.postTarget.updateMany({ where: { socialAccountId: account.id, status: { in: ["pending", "queued", "blocked"] } }, data: { status: "canceled", lastError: "account disconnected" } });
  await prisma.socialAccountToken.deleteMany({ where: { socialAccountId: account.id } });
  await prisma.socialAccount.update({ where: { id: account.id }, data: { status: "disconnected", healthStatus: "unknown", lastError: null } });
  await audit({ actorUserId: input.userId, brandId: account.brandId, action: "connection.disconnect", targetType: "social_account", targetId: account.id, details: { remoteRevoked } });
}

export async function zernioPlatformFor(provider: ProviderId) {
  return ZERNIO_PLATFORM_MAP[provider];
}
