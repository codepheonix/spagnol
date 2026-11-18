import { prisma, type SocialAccount } from "@sm/db";
import { createOAuthState, createPkcePair, decryptJson, encryptJson, type EncryptedBlob } from "@sm/security";
import { getAdapter, hasNativeAdapter, isProviderId, OPTIONAL_APP_KEYS, ProviderError, requiredAppKeys, ZernioClient, ZERNIO_PLATFORM_MAP, INSTAGRAM_LOGIN_SCOPES, META_IG_VIA_FACEBOOK_SCOPES, META_PAGE_SCOPES, type AccountContext, type AdapterBackend, type ConnectResult, type ProviderId, type SocialAdapter } from "@sm/integrations";
import { audit, notify } from "./audit";
import { getZernioConfig, resolveProviderApp } from "./settings";
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

export interface StartConnectionInput {
  brandId: string;
  userId: string;
  provider: ProviderId;
  backend: AdapterBackend;
  options?: Record<string, string>;
  /** Reconnect an existing account record (same identity) instead of adding a new one. */
  reconnectAccountId?: string;
}

interface OAuthPayload {
  userId?: string;
  profileId?: string;
  loginMethod?: string;
  reconnectAccountId?: string;
  /** Encrypted ConnectResult waiting for the owner to pick which assets to attach. */
  pending?: EncryptedBlob | null;
  requestedProvider?: string;
}

/** Step 1 of a connection: returns a URL to redirect the browser to (OAuth / gateway) or `null` for credential forms. */
export async function startConnection(input: StartConnectionInput): Promise<{ redirectUrl: string | null; descriptor: SocialAdapter["descriptor"] }> {
  const brand = await prisma.brand.findFirst({ where: { id: input.brandId, ownerId: input.userId, archivedAt: null } });
  if (!brand) throw new AppError("Brand not found.", 404, "not_found");
  let backend = input.backend;
  const options: Record<string, string> = { ...(input.options ?? {}) };
  let reconnect: SocialAccount | null = null;
  if (input.reconnectAccountId) {
    reconnect = await prisma.socialAccount.findFirst({ where: { id: input.reconnectAccountId, brandId: brand.id, provider: input.provider } });
    if (!reconnect) throw new AppError("Account not found for this brand.", 404, "not_found");
    backend = reconnect.backend;
    const lm = (reconnect.metadata as { loginMethod?: string } | null)?.loginMethod;
    if (lm) options.loginMethod = lm;
    options.reconnect = "1";
  }
  if (backend === "native" && !hasNativeAdapter(input.provider)) throw new AppError(`${input.provider} is not built yet in this app.`, 400, "native_not_implemented");
  const adapter = getAdapter(input.provider, backend);
  const d = adapter.descriptor;
  if (d.connect.kind === "credentials") return { redirectUrl: null, descriptor: d };
  const loginMethod = d.loginMethods?.some((m) => m.id === options.loginMethod) ? options.loginMethod : d.loginMethods?.[0]?.id;
  if (loginMethod) options.loginMethod = loginMethod;
  else delete options.loginMethod;

  let app: Record<string, string> | undefined;
  if (backend === "native") {
    const resolved = await resolveProviderApp(requiredAppKeys(d, loginMethod), OPTIONAL_APP_KEYS);
    if (resolved.missing.length) throw new AppError(`One-time setup needed before this button can open the sign-in page: ${resolved.missing.join(", ")} not configured.`, 412, "provider_app_missing");
    app = resolved.values;
  }

  const state = createOAuthState();
  const redirectUri = `${appUrl()}/api/oauth/${input.provider}/callback`;
  const extra: Record<string, string> = { ...options };
  let codeVerifier: string | undefined;
  const payload: OAuthPayload = { userId: input.userId, loginMethod, reconnectAccountId: reconnect?.id, requestedProvider: input.provider };
  if (backend === "zernio") {
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
  await prisma.oAuthState.create({ data: { state, brandId: brand.id, provider: input.provider, backend, codeVerifier, redirectUri, payload: payload as object, expiresAt: new Date(Date.now() + 15 * 60_000) } });
  if (!adapter.buildAuthorizationUrl) throw new AppError("Adapter cannot start OAuth.", 500, "adapter_error");
  const url = await adapter.buildAuthorizationUrl({ brandId: brand.id, state, redirectUri, codeChallenge: extra.codeChallenge, extra, app });
  await audit({ actorUserId: input.userId, brandId: brand.id, action: reconnect ? "connection.reconnect_start" : "connection.start", targetType: "provider", targetId: `${input.provider}:${backend}${loginMethod ? `:${loginMethod}` : ""}` });
  return { redirectUrl: url, descriptor: d };
}

export interface CallbackOutcome {
  brandId: string;
  accounts: SocialAccount[];
  /** Set when several assets were granted and the owner still has to choose which ones to attach. */
  pendingState?: string;
  reconnected?: boolean;
}

/**
 * Step 2: provider redirected back. Verifies state exactly once, exchanges server-side, then persists or asks the owner to choose.
 *
 * `sessionUserId` is the user signed in on the browser that is finishing the sign-in. It must be the
 * same user who started it: without this check a prepared sign-in link could make someone else
 * connect their account into the workspace of whoever prepared the link. The workspace is checked
 * again as well (still owned by that user, not archived). A mismatch consumes nothing, so the real
 * owner can still finish within the 15 minutes.
 */
export async function completeOAuthCallback(provider: ProviderId, params: Record<string, string>, sessionUserId: string | null): Promise<CallbackOutcome> {
  const state = params.state;
  if (!state) throw new AppError("Missing OAuth state.", 400, "oauth_state");
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (!row || row.provider !== provider) throw new AppError("Unknown OAuth state (possible replay or mismatch).", 400, "oauth_state");
  if (row.consumedAt) throw new AppError("This sign-in link was already used. Start the connection again.", 400, "oauth_replay");
  if (row.expiresAt < new Date()) throw new AppError("The sign-in took longer than 15 minutes — start the connection again.", 400, "oauth_expired");
  const startedBy = ((row.payload ?? {}) as OAuthPayload).userId;
  if (!sessionUserId) throw new AppError("Sign in to iGerald in this browser, then start the connection again.", 401, "oauth_no_session");
  if (!startedBy || startedBy !== sessionUserId) {
    await audit({ actorUserId: sessionUserId, brandId: row.brandId, action: "connection.complete", outcome: "denied", targetType: "provider", targetId: provider, details: { reason: "session does not match the user who started this sign-in" } });
    throw new AppError("This sign-in was started by a different iGerald user. Start the connection again from your own account.", 403, "oauth_session_mismatch");
  }
  const workspace = await prisma.brand.findFirst({ where: { id: row.brandId, ownerId: sessionUserId, archivedAt: null }, select: { id: true } });
  if (!workspace) throw new AppError("The workspace this sign-in was started for is no longer available to you.", 403, "oauth_workspace");
  // Anti-replay: consume atomically.
  const consumed = await prisma.oAuthState.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (consumed.count !== 1) throw new AppError("This sign-in link was already used. Start the connection again.", 400, "oauth_replay");

  const payload = (row.payload ?? {}) as OAuthPayload;
  const adapter = getAdapter(provider, row.backend);
  if (!adapter.exchangeAuthorizationCode) throw new AppError("Adapter cannot complete OAuth.", 500, "adapter_error");
  const callbackParams = { ...params };
  if (payload.loginMethod) callbackParams.__loginMethod = payload.loginMethod;
  let app: Record<string, string> | undefined;
  if (row.backend === "zernio") {
    const z = await getZernioConfig();
    if (!z) throw new AppError("Zernio API key missing.", 412, "zernio_not_configured");
    callbackParams.__apiKey = z.apiKey;
    callbackParams.__baseUrl = z.baseUrl;
    callbackParams.__profileId = String(payload.profileId ?? "");
  } else {
    app = (await resolveProviderApp(requiredAppKeys(adapter.descriptor, payload.loginMethod), OPTIONAL_APP_KEYS)).values;
  }
  let result: ConnectResult;
  try {
    result = await adapter.exchangeAuthorizationCode({ code: params.code ?? "", state, redirectUri: row.redirectUri, codeVerifier: row.codeVerifier ?? undefined, callbackParams, app });
  } catch (err) {
    await audit({ brandId: row.brandId, action: "connection.complete", outcome: "error", targetType: "provider", targetId: provider, details: { error: (err as Error).message } });
    throw err;
  }

  // Reconnect: refresh the credentials of the same identity only; never swap in a different account silently.
  if (payload.reconnectAccountId) {
    const existing = await prisma.socialAccount.findFirst({ where: { id: payload.reconnectAccountId, brandId: row.brandId } });
    if (!existing) throw new AppError("The account being reconnected no longer exists.", 404, "not_found");
    const match = result.accounts.find((a) => (a.provider ?? provider) === existing.provider && a.externalAccountId === existing.externalAccountId);
    if (!match) {
      await audit({ brandId: row.brandId, action: "connection.reconnect", outcome: "error", targetType: "social_account", targetId: existing.id, details: { reason: "identity_mismatch" } });
      throw new AppError(`You signed in, but "${existing.displayName}" was not among the accounts you allowed. Nothing was changed. Sign in with the profile that manages it and select it, or connect the other account as a new one.`, 409, "identity_mismatch");
    }
    const accounts = await persistConnectResult(row.brandId, provider, row.backend, { ...result, accounts: [match] }, payload.profileId);
    await audit({ actorUserId: payload.userId, brandId: row.brandId, action: "connection.reconnect", targetType: "social_account", targetId: existing.id });
    return { brandId: row.brandId, accounts, reconnected: true };
  }

  // One asset granted → attach it. Several → the owner chooses on the next screen (nothing is saved yet).
  if (result.accounts.length > 1 && row.backend === "native") {
    const pending = encryptJson({ result: { ...result, expiresAt: result.expiresAt?.toISOString() ?? null, refreshExpiresAt: result.refreshExpiresAt?.toISOString() ?? null } });
    await prisma.oAuthState.update({ where: { id: row.id }, data: { payload: { ...payload, pending } as object, expiresAt: new Date(Date.now() + 15 * 60_000) } });
    return { brandId: row.brandId, accounts: [], pendingState: state };
  }
  const accounts = await persistConnectResult(row.brandId, provider, row.backend, result, payload.profileId);
  await audit({ actorUserId: payload.userId, brandId: row.brandId, action: "connection.complete", targetType: "social_account", targetId: accounts.map((a) => a.id).join(",") });
  return { brandId: row.brandId, accounts };
}

export interface PendingOption {
  key: string;
  provider: string;
  externalAccountId: string;
  accountType?: string | null;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
  profileUrl?: string | null;
  /** e.g. the Facebook Page an Instagram account is linked to. */
  linkedTo?: string | null;
  alreadyConnected: boolean;
  otherBrands: string[];
  requested: boolean;
}

async function loadPending(userId: string, state: string) {
  const row = await prisma.oAuthState.findUnique({ where: { state }, include: { brand: true } });
  if (!row || row.brand.ownerId !== userId) throw new AppError("Nothing to choose — start the connection again.", 404, "not_found");
  const payload = (row.payload ?? {}) as OAuthPayload;
  if (!payload.pending) throw new AppError("This selection was already completed.", 409, "already_done");
  if (row.expiresAt < new Date()) throw new AppError("The selection expired after 15 minutes — start the connection again.", 410, "expired");
  const { result: raw } = decryptJson<{ result: Omit<ConnectResult, "expiresAt" | "refreshExpiresAt"> & { expiresAt: string | null; refreshExpiresAt: string | null } }>(payload.pending);
  const result: ConnectResult = { ...raw, expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : null, refreshExpiresAt: raw.refreshExpiresAt ? new Date(raw.refreshExpiresAt) : null };
  return { row, payload, result };
}

const optionKey = (provider: string, externalAccountId: string) => `${provider}:${externalAccountId}`;

/** The assets granted at sign-in that are waiting for the owner's choice. Tokens never leave the server. */
export async function getPendingSelection(userId: string, state: string): Promise<{ brandId: string; brandName: string; provider: string; options: PendingOption[] }> {
  const { row, result } = await loadPending(userId, state);
  const ids = result.accounts.map((a) => a.externalAccountId);
  const existing = await prisma.socialAccount.findMany({ where: { externalAccountId: { in: ids }, backend: row.backend, status: { not: "disconnected" }, brand: { ownerId: userId } }, include: { brand: { select: { id: true, name: true } } } });
  const options = result.accounts.map((a): PendingOption => {
    const p = a.provider ?? row.provider;
    const same = existing.filter((e) => e.provider === p && e.externalAccountId === a.externalAccountId);
    const md = (a.metadata ?? {}) as { pageName?: string; instagramUsername?: string };
    return { key: optionKey(p, a.externalAccountId), provider: p, externalAccountId: a.externalAccountId, accountType: a.accountType, displayName: a.displayName, username: a.username, avatarUrl: a.avatarUrl, profileUrl: a.profileUrl, linkedTo: p === "instagram" ? (md.pageName ?? null) : md.instagramUsername ? `@${md.instagramUsername}` : null, alreadyConnected: same.some((e) => e.brandId === row.brandId), otherBrands: same.filter((e) => e.brandId !== row.brandId).map((e) => e.brand.name), requested: p === row.provider };
  });
  return { brandId: row.brandId, brandName: row.brand.name, provider: row.provider, options };
}

/** Attaches the chosen assets to the brand the connection was started for, then discards the rest. */
export async function confirmPendingSelection(userId: string, state: string, keys: string[]): Promise<{ brandId: string; accounts: SocialAccount[] }> {
  const { row, payload, result } = await loadPending(userId, state);
  const chosen = result.accounts.filter((a) => keys.includes(optionKey(a.provider ?? row.provider, a.externalAccountId)));
  if (!chosen.length) throw new AppError("Select at least one account.", 422, "nothing_selected");
  // Single-use: clear the pending blob first so a double submit cannot attach twice.
  const cleared = await prisma.$executeRaw`UPDATE "OAuthState" SET "payload" = "payload" - 'pending' WHERE "id" = ${row.id} AND jsonb_typeof("payload"->'pending') = 'object'`;
  if (cleared !== 1) throw new AppError("This selection was already completed.", 409, "already_done");
  const accounts = await persistConnectResult(row.brandId, row.provider as ProviderId, row.backend, { ...result, accounts: chosen }, payload.profileId);
  await audit({ actorUserId: userId, brandId: row.brandId, action: "connection.complete", targetType: "social_account", targetId: accounts.map((a) => a.id).join(","), details: { chosen: chosen.length, offered: result.accounts.length } });
  return { brandId: row.brandId, accounts };
}

/** Drops a pending selection without attaching anything. */
export async function discardPendingSelection(userId: string, state: string): Promise<void> {
  const row = await prisma.oAuthState.findUnique({ where: { state }, include: { brand: true } });
  if (!row || row.brand.ownerId !== userId) return;
  await prisma.oAuthState.update({ where: { id: row.id }, data: { payload: { ...((row.payload ?? {}) as object), pending: null } as object } });
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

async function persistConnectResult(brandId: string, defaultProvider: ProviderId, backend: AdapterBackend, result: ConnectResult, gatewayProfileId?: string): Promise<SocialAccount[]> {
  const out: SocialAccount[] = [];
  for (const acc of result.accounts) {
    const provider = acc.provider ?? defaultProvider;
    const creds = { ...result.credentials, ...(result.perAccountCredentials?.[acc.externalAccountId] ?? {}) };
    const gatewayAccountId = (acc.metadata?.zernioAccountId as string | undefined) ?? null;
    // Same identity → same record (upsert), so scheduled posts and history survive a reconnect.
    const account = await prisma.socialAccount.upsert({
      where: { brandId_provider_externalAccountId_backend: { brandId, provider, externalAccountId: acc.externalAccountId, backend } },
      create: { brandId, provider, backend, externalAccountId: acc.externalAccountId, accountType: acc.accountType, displayName: acc.displayName, username: acc.username, profileUrl: acc.profileUrl, avatarUrl: acc.avatarUrl, scopes: acc.scopes ?? [], status: "connected", healthStatus: "unknown", tokenExpiresAt: result.expiresAt ?? null, gatewayAccountId, gatewayProfileId: gatewayProfileId ?? null, metadata: (acc.metadata ?? {}) as object },
      update: { accountType: acc.accountType, displayName: acc.displayName, username: acc.username, profileUrl: acc.profileUrl, avatarUrl: acc.avatarUrl, scopes: acc.scopes ?? [], status: "connected", healthStatus: "unknown", lastError: null, tokenExpiresAt: result.expiresAt ?? null, gatewayAccountId, gatewayProfileId: gatewayProfileId ?? null, metadata: (acc.metadata ?? {}) as object },
    });
    await storeCredentials(account.id, creds, result.expiresAt, result.refreshExpiresAt);
    await enqueue("check_account_health", { socialAccountId: account.id }, { dedupeKey: `health:${account.id}`, brandId });
    out.push(account);
  }
  return out;
}

/** Permissions this app asks for at sign-in that the account's last sign-in did not grant. */
export function missingScopes(account: Pick<SocialAccount, "provider" | "backend" | "scopes" | "metadata">): string[] {
  if (account.backend !== "native" || !account.scopes.length) return [];
  const lm = (account.metadata as { loginMethod?: string } | null)?.loginMethod;
  let wanted: string[] = [];
  if (account.provider === "facebook") wanted = META_PAGE_SCOPES;
  else if (account.provider === "instagram") wanted = lm === "instagram_login" ? INSTAGRAM_LOGIN_SCOPES : ["pages_show_list", "pages_read_engagement", ...META_IG_VIA_FACEBOOK_SCOPES];
  // Only the permissions publishing depends on are reported here; optional ones show up as capability states.
  return wanted.filter((w) => !account.scopes.includes(w));
}

export async function checkAccountHealth(socialAccountId: string): Promise<SocialAccount> {
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: socialAccountId } });
  if (account.status === "disconnected") return account; // nothing to check; never resurrect a disconnected account
  try {
    const adapter = adapterFor(account);
    let ctx = await buildAccountContext(account);
    let tokenExpiresAt = account.tokenExpiresAt;
    // Expiring tokens (Instagram Login: 60 days) are refreshed ahead of time; an expired one needs a new sign-in.
    if (tokenExpiresAt && adapter.refreshCredentials) {
      if (tokenExpiresAt.getTime() < Date.now()) throw new ProviderError("The saved permission expired. Reconnect this account.", { category: "auth_expired", retryable: false });
      if (tokenExpiresAt.getTime() < Date.now() + 14 * 24 * 3600_000) {
        const r = await adapter.refreshCredentials(ctx);
        await storeCredentials(account.id, r.credentials, r.expiresAt ?? null);
        tokenExpiresAt = r.expiresAt ?? null;
        ctx = { ...ctx, credentials: r.credentials };
      }
    }
    const h = await adapter.verifyConnection(ctx);
    const caps = await adapter.discoverCapabilities(ctx);
    const msg = h.message?.toLowerCase() ?? "";
    const authProblem = (h.details as { category?: string } | undefined)?.category === "auth_expired" || msg.includes("token") || msg.includes("session") || msg.includes("authoriz");
    const status = h.ok ? "connected" : authProblem ? "needs_reconnect" : "error";
    const updated = await prisma.socialAccount.update({ where: { id: account.id }, data: { healthStatus: h.status, status, lastCheckedAt: new Date(), lastError: h.ok ? null : (h.message ?? "health check failed"), tokenExpiresAt: h.expiresAt ?? tokenExpiresAt, metadata: { ...(account.metadata as object), capabilities: caps, healthDetails: (h.details ?? {}) as object } as object } });
    if (!h.ok && account.healthStatus !== "error") await notify({ brandId: account.brandId, level: "warning", title: status === "needs_reconnect" ? `Reconnect ${account.displayName}` : `${account.displayName} needs attention`, body: h.message, link: `/accounts` });
    return updated;
  } catch (err) {
    const e = err as Error;
    const needsReconnect = err instanceof ProviderError && err.options.category === "auth_expired";
    if (needsReconnect && account.status !== "needs_reconnect") await notify({ brandId: account.brandId, level: "warning", title: `Reconnect ${account.displayName}`, body: e.message, link: `/accounts` });
    return prisma.socialAccount.update({ where: { id: account.id }, data: { healthStatus: "error", status: needsReconnect ? "needs_reconnect" : "error", lastCheckedAt: new Date(), lastError: e.message } });
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
