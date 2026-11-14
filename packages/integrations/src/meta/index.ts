/**
 * Meta native adapters: Facebook Pages and Instagram professional accounts.
 *
 * Two official sign-in routes:
 *   - Facebook Login (Graph API on graph.facebook.com): Pages, and Instagram professional accounts
 *     linked to a Page. Publishing uses the Page access token.
 *   - Business Login for Instagram (graph.instagram.com): an Instagram professional account without
 *     a Page. Publishing uses the Instagram user token (60 days, refreshable).
 *
 * Docs: https://developers.facebook.com/docs/graph-api ·
 *       https://developers.facebook.com/documentation/instagram-platform/content-publishing
 *
 * App credentials (META_APP_ID / META_APP_SECRET, INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET) are
 * resolved by core from the encrypted in-app setup or the environment and passed in as `app`.
 * For accounts the app's own admins manage, Standard Access is enough; App Review (Advanced
 * Access) is needed before other people (clients) can authorize their assets.
 */
import { buildUrl } from "@sm/security";
import { classifyHttpError, http } from "../http";
import {
  type AccountContext,
  type CapabilityMap,
  type ConnectResult,
  type DateRange,
  type HealthResult,
  type MetricResult,
  type ProviderDescriptor,
  type PublishResult,
  type PublishStatus,
  type RemoteAccount,
  type SocialAdapter,
  type TargetPost,
  type ValidationIssue,
  type ValidationResult,
  ProviderError,
} from "../contract";

/** Pinned Graph API version (v25.0 is available until 2028-07-29). Override with META_GRAPH_VERSION. */
export const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v25.0";
const trim = (u: string) => u.replace(/\/$/, "");
// Hosts are overridable so tests can point the adapter at a stand-in server.
const fbGraphBase = () => `${trim(process.env.META_GRAPH_BASE ?? "https://graph.facebook.com")}/${META_GRAPH_VERSION}`;
const fbDialogUrl = () => `${trim(process.env.META_DIALOG_BASE ?? "https://www.facebook.com")}/${META_GRAPH_VERSION}/dialog/oauth`;
const igGraphHost = () => trim(process.env.INSTAGRAM_GRAPH_BASE ?? "https://graph.instagram.com");
const igGraphBase = () => `${igGraphHost()}/${META_GRAPH_VERSION}`;
const igAuthorizeUrl = () => `${trim(process.env.INSTAGRAM_OAUTH_BASE ?? "https://www.instagram.com")}/oauth/authorize`;
const igTokenUrl = () => `${trim(process.env.INSTAGRAM_API_BASE ?? "https://api.instagram.com")}/oauth/access_token`;

/**
 * Permissions requested at sign-in. Every one of them must first be added to the Meta app's use
 * cases, otherwise Meta rejects the whole sign-in ("Invalid Scopes"). The base sets are what
 * publishing needs; the extended sets (comments, insights) are requested only when the owner
 * switched them on in the in-app Meta setup after adding them in Meta.
 */
export const META_PAGE_SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "business_management"];
export const META_PAGE_SCOPES_EXTENDED = ["pages_read_user_content", "pages_manage_engagement", "read_insights"];
export const META_IG_VIA_FACEBOOK_SCOPES = ["instagram_basic", "instagram_content_publish"];
export const META_IG_VIA_FACEBOOK_SCOPES_EXTENDED = ["instagram_manage_comments", "instagram_manage_insights"];
export const INSTAGRAM_LOGIN_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
export const INSTAGRAM_LOGIN_SCOPES_EXTENDED = ["instagram_business_manage_comments", "instagram_business_manage_insights"];

const extended = (app: Record<string, string> | undefined) => (app?.META_EXTENDED_SCOPES ?? process.env.META_EXTENDED_SCOPES) === "1";

function scopeList(envName: string, fallback: string[]): string[] {
  const v = process.env[envName];
  return v ? v.split(",").map((x) => x.trim()).filter(Boolean) : fallback;
}

function appCreds(app: Record<string, string> | undefined, idKey = "META_APP_ID", secretKey = "META_APP_SECRET") {
  const id = app?.[idKey] ?? process.env[idKey];
  const secret = app?.[secretKey] ?? process.env[secretKey];
  if (!id || !secret) throw new ProviderError(`${idKey} / ${secretKey} are not configured. Open Connections → Meta app setup.`, { category: "auth_expired", retryable: false });
  return { id, secret };
}

interface GraphError {
  error?: { message: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}

async function graph<T>(path: string, opts: { method?: "GET" | "POST" | "DELETE"; token: string; base?: string; params?: Record<string, string | number | boolean | undefined>; form?: FormData }): Promise<T> {
  const url = new URL(`${opts.base ?? fbGraphBase()}${path}`);
  url.searchParams.set("access_token", opts.token);
  if (opts.method !== "POST") for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  let res;
  if (opts.method === "POST") {
    if (opts.form) res = await http<T & GraphError>(url.toString(), { method: "POST", body: opts.form, timeoutMs: 300_000 });
    else {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined) body.set(k, String(v));
      res = await http<T & GraphError>(url.toString(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString(), timeoutMs: 120_000 });
    }
  } else {
    res = await http<T & GraphError>(url.toString(), { method: opts.method ?? "GET" });
  }
  if (res.status >= 200 && res.status < 300 && !res.data?.error) return res.data;
  const e = res.data?.error;
  const msg = `Meta Graph ${path}: ${e?.message ?? res.text.slice(0, 200)} (code ${e?.code ?? res.status}${e?.error_subcode ? "/" + e.error_subcode : ""})`;
  const traceId = e?.fbtrace_id;
  if (e?.code === 190 || e?.code === 102) throw new ProviderError(msg, { category: "auth_expired", retryable: false, providerCode: e.code, providerRequestId: traceId });
  if (e?.code === 10 || e?.code === 200 || (e?.code && e.code >= 200 && e.code <= 299)) throw new ProviderError(msg, { category: "permission", retryable: false, providerCode: e.code, providerRequestId: traceId });
  if (e?.code === 4 || e?.code === 17 || e?.code === 32 || e?.code === 613) throw new ProviderError(msg, { category: "rate_limited", retryable: true, retryAfterSeconds: 900, providerCode: e.code, providerRequestId: traceId });
  if (e?.code === 1 || e?.code === 2) throw new ProviderError(msg, { category: "provider_error", retryable: true, providerCode: e.code, providerRequestId: traceId });
  if (e?.code === 100) throw new ProviderError(msg, { category: "validation", retryable: false, providerCode: e.code, providerRequestId: traceId });
  throw classifyHttpError(res, msg, traceId);
}

/** Confirms an app id/secret pair with Meta (app access token) and returns the app's name. */
export async function verifyMetaApp(appId: string, appSecret: string): Promise<{ id: string; name: string }> {
  const res = await http<{ id?: string; name?: string } & GraphError>(buildUrl(`${fbGraphBase()}/${encodeURIComponent(appId)}`, { fields: "id,name", access_token: `${appId}|${appSecret}` }));
  if (res.status !== 200 || !res.data?.id) throw new ProviderError(`Meta did not accept this App ID / App secret: ${res.data?.error?.message ?? `HTTP ${res.status}`}`, { category: "validation", retryable: false });
  return { id: res.data.id, name: res.data.name ?? "" };
}

async function exchangeCode(code: string, redirectUri: string, app: Record<string, string> | undefined): Promise<{ access_token: string; expires_in?: number }> {
  const { id, secret } = appCreds(app);
  const res = await http<{ access_token: string; expires_in?: number } & GraphError>(buildUrl(`${fbGraphBase()}/oauth/access_token`, { client_id: id, client_secret: secret, redirect_uri: redirectUri, code }));
  if (res.status !== 200 || !res.data?.access_token) throw new ProviderError(`Meta code exchange failed: ${res.data?.error?.message ?? res.status}`, { category: "auth_expired", retryable: false });
  // Upgrade to a long-lived user token (~60 days); Page tokens derived from it do not expire.
  const ll = await http<{ access_token: string; expires_in?: number } & GraphError>(buildUrl(`${fbGraphBase()}/oauth/access_token`, { grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: res.data.access_token }));
  return ll.status === 200 && ll.data?.access_token ? ll.data : res.data;
}

interface PageRow {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  tasks?: string[];
  link?: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
}

async function listPages(userToken: string): Promise<PageRow[]> {
  const out: PageRow[] = [];
  let url: string | undefined = buildUrl(`${fbGraphBase()}/me/accounts`, { fields: "id,name,access_token,category,tasks,link,picture{url},instagram_business_account{id,username,name,profile_picture_url}", limit: 100, access_token: userToken });
  while (url) {
    const res: { status: number; data: { data?: PageRow[]; paging?: { next?: string } } & GraphError } = await http(url);
    if (res.data?.error) throw new ProviderError(`Meta /me/accounts: ${res.data.error.message}`, { category: "permission", retryable: false });
    out.push(...(res.data.data ?? []));
    url = res.data.paging?.next;
  }
  return out;
}

/** Permissions the person actually granted (they can untick some in Meta's dialog). */
async function grantedPermissions(userToken: string): Promise<{ granted: string[]; declined: string[] }> {
  try {
    const r = await graph<{ data?: Array<{ permission: string; status: string }> }>("/me/permissions", { token: userToken });
    return { granted: (r.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission), declined: (r.data ?? []).filter((p) => p.status !== "granted").map((p) => p.permission) };
  } catch {
    return { granted: [], declined: [] };
  }
}

function pageToken(ctx: AccountContext): string {
  const t = ctx.credentials.pageAccessToken;
  if (typeof t !== "string" || !t) throw new ProviderError("Missing Page access token.", { category: "auth_expired", retryable: false });
  return t;
}

/** Instagram accounts use either the linked Page's token (Facebook Login) or their own token (Instagram Login). */
function igAuth(ctx: AccountContext): { token: string; base: string } {
  const own = ctx.credentials.igUserToken;
  if (typeof own === "string" && own) return { token: own, base: igGraphBase() };
  return { token: pageToken(ctx), base: fbGraphBase() };
}

const norm = (v: string | null | undefined) => (v ?? "").replace(/\r\n/g, "\n").trim();
const fbMessage = (t: TargetPost) => t.body + (t.link && t.media.length ? `\n${t.link}` : "");

function has(ctx: AccountContext, scope: string): boolean {
  const g = ctx.metadata.grantedScopes as string[] | undefined;
  return !g || !g.length || g.includes(scope); // unknown grants → do not block; the provider call decides
}

function facebookDialog(input: { state: string; redirectUri: string; app?: Record<string, string>; extra?: Record<string, string> }, scopes: string[]): string {
  const { id } = appCreds(input.app);
  const configId = input.app?.META_LOGIN_CONFIG_ID ?? process.env.META_LOGIN_CONFIG_ID;
  return buildUrl(fbDialogUrl(), {
    client_id: id,
    redirect_uri: input.redirectUri,
    state: input.state,
    response_type: "code",
    // Facebook Login for Business uses a configuration id instead of a scope list.
    ...(configId ? { config_id: configId } : { scope: scopes.join(",") }),
    ...(input.extra?.reconnect ? { auth_type: "rerequest" } : {}),
  });
}

/**
 * Shared Facebook Login exchange. Returns the Pages the person granted and, when the Instagram
 * permissions were granted too, the Instagram professional accounts linked to those Pages.
 * The caller (core) lets the owner choose which of these to attach to the brand.
 */
async function exchangeFacebookLogin(requested: "facebook" | "instagram", input: { code: string; redirectUri: string; callbackParams: Record<string, string>; app?: Record<string, string> }): Promise<ConnectResult> {
  const cb = input.callbackParams;
  if (cb.error) throw new ProviderError(`Facebook sign-in was not completed: ${cb.error_description ?? cb.error_message ?? cb.error}`, { category: "permission", retryable: false });
  const user = await exchangeCode(input.code, input.redirectUri, input.app);
  const perms = await grantedPermissions(user.access_token);
  const pages = await listPages(user.access_token);
  const igGranted = !perms.granted.length || perms.granted.includes("instagram_basic");
  const pageAccounts: RemoteAccount[] = pages.map((p) => ({
    provider: "facebook",
    externalAccountId: p.id,
    accountType: "page",
    displayName: p.name,
    profileUrl: p.link ?? `https://www.facebook.com/${p.id}`,
    avatarUrl: p.picture?.data?.url,
    scopes: perms.granted,
    metadata: { category: p.category, tasks: p.tasks ?? [], instagramBusinessAccountId: p.instagram_business_account?.id, instagramUsername: p.instagram_business_account?.username, grantedScopes: perms.granted, declinedScopes: perms.declined, loginMethod: "facebook_login" },
  }));
  const igAccounts: RemoteAccount[] = igGranted
    ? pages.filter((p) => p.instagram_business_account).map((p) => {
        const ig = p.instagram_business_account!;
        return { provider: "instagram" as const, externalAccountId: ig.id, accountType: "professional", displayName: ig.name ?? ig.username ?? p.name, username: ig.username, profileUrl: ig.username ? `https://www.instagram.com/${ig.username}` : undefined, avatarUrl: ig.profile_picture_url, scopes: perms.granted, metadata: { pageId: p.id, pageName: p.name, grantedScopes: perms.granted, declinedScopes: perms.declined, loginMethod: "facebook_login" } };
      })
    : [];
  if (requested === "facebook" && !pageAccounts.length) throw new ProviderError("Facebook returned no Pages. Sign in again and, in Facebook's dialog, select the Pages this app may manage.", { category: "permission", retryable: false });
  if (requested === "instagram" && !igAccounts.length)
    throw new ProviderError(
      pages.length
        ? "None of the Pages you selected has an Instagram professional account linked to it. Link the Instagram account to its Facebook Page (Page settings → Linked accounts), or use Instagram login instead."
        : "Facebook returned no Pages, so no linked Instagram account could be found. Select the Page linked to the Instagram account in Facebook's dialog.",
      { category: "permission", retryable: false },
    );
  const perAccountCredentials: Record<string, Record<string, unknown>> = {};
  for (const p of pages) {
    perAccountCredentials[p.id] = { pageAccessToken: p.access_token };
    if (p.instagram_business_account) perAccountCredentials[p.instagram_business_account.id] = { pageAccessToken: p.access_token, pageId: p.id };
  }
  return {
    accounts: requested === "facebook" ? [...pageAccounts, ...igAccounts] : [...igAccounts, ...pageAccounts],
    credentials: {},
    perAccountCredentials,
    expiresAt: null, // Page tokens derived from a long-lived user token do not expire (they can still be revoked)
  };
}

// ---------------------------------------------------------------------------
// Facebook Page
// ---------------------------------------------------------------------------

export const facebookDescriptor: ProviderDescriptor = {
  id: "facebook",
  backend: "native",
  displayName: "Facebook Page",
  connect: { kind: "oauth", notes: "Opens Facebook's sign-in. You approve access and pick the Pages this app may manage." },
  capabilities: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", publish_link: "supported", publish_story: "not_tested", publish_short: "not_tested", first_comment: "supported", delete_post: "supported", edit_post: "supported", schedule_remote: "unsupported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", hide_comment: "supported", read_dm: "needs_approval", send_dm: "needs_approval", ads_read: "unsupported", ads_write: "unsupported" },
  limits: { maxTextLength: 63_206, maxImages: 10, maxImageBytes: 10 * 1024 * 1024, maxVideoBytes: 1024 * 1024 * 1024, imageMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"], videoMimeTypes: ["video/mp4", "video/quicktime"] },
  implementationStatus: "CODE_COMPLETE_NEEDS_CREDENTIALS",
  docsUrl: "https://developers.facebook.com/docs/pages-api/posts",
  requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
};

export const facebookAdapter: SocialAdapter = {
  descriptor: facebookDescriptor,
  async discoverCapabilities(ctx): Promise<CapabilityMap> {
    const caps = { ...facebookDescriptor.capabilities };
    const tasks = (ctx.metadata.tasks as string[] | undefined) ?? [];
    const publishCaps = ["publish_text", "publish_image", "publish_video", "publish_carousel", "publish_link", "first_comment", "delete_post", "edit_post"] as const;
    // Missing permission (not granted at sign-in) or missing Page role → needs_approval, with the reason in missingPermissions().
    if (!has(ctx, "pages_manage_posts") || (tasks.length && !tasks.includes("CREATE_CONTENT"))) for (const c of publishCaps) caps[c] = "needs_approval";
    if (!has(ctx, "pages_manage_engagement") || (tasks.length && !tasks.includes("MODERATE"))) {
      caps.reply_comment = "needs_approval";
      caps.hide_comment = "needs_approval";
    }
    if (!has(ctx, "pages_read_user_content")) caps.read_comments = "needs_approval";
    if (!has(ctx, "read_insights")) caps.read_analytics = "needs_approval";
    return caps;
  },
  async buildAuthorizationUrl(input) {
    return facebookDialog(input, scopeList("META_FACEBOOK_SCOPES", [...META_PAGE_SCOPES, ...(extended(input.app) ? META_PAGE_SCOPES_EXTENDED : [])]));
  },
  async exchangeAuthorizationCode(input): Promise<ConnectResult> {
    return exchangeFacebookLogin("facebook", input);
  },
  async verifyConnection(ctx): Promise<HealthResult> {
    try {
      const me = await graph<{ id: string; name: string }>(`/${ctx.externalAccountId}`, { token: pageToken(ctx), params: { fields: "id,name" } });
      return { ok: true, status: "healthy", message: `Page "${me.name}" reachable.` };
    } catch (err) {
      const e = err as ProviderError;
      return { ok: false, status: "error", message: e.message, details: { category: e.options?.category ?? "unknown" } };
    }
  },
  async validatePost(_ctx, target): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const videos = target.media.filter((m) => m.mimeType.startsWith("video/"));
    const images = target.media.filter((m) => m.mimeType.startsWith("image/"));
    if (!target.body.trim() && !target.media.length && !target.link) issues.push({ level: "error", code: "empty", message: "Post is empty." });
    if (target.body.length > 63_206) issues.push({ level: "error", code: "too_long", message: "Too long for Facebook." });
    if (videos.length > 1 || (videos.length && images.length)) issues.push({ level: "error", code: "mixed_media", message: "One video per post, without photos." });
    if (images.length > 10) issues.push({ level: "error", code: "too_many_images", message: "At most 10 photos per post." });
    for (const m of target.media) if (!m.mimeType.startsWith("image/") && !m.mimeType.startsWith("video/")) issues.push({ level: "error", code: "unsupported_media", message: `${m.filename}: only photos and videos.` });
    return { ok: !issues.some((i) => i.level === "error"), issues, format: videos.length ? "video" : images.length > 1 ? "carousel" : images.length ? "image" : target.link ? "link" : "text" };
  },
  async publish(ctx, target): Promise<PublishResult> {
    const token = pageToken(ctx);
    const page = ctx.externalAccountId;
    const message = target.body;
    const images = target.media.filter((m) => m.mimeType.startsWith("image/"));
    const video = target.media.find((m) => m.mimeType.startsWith("video/"));
    // One scheduling authority: this app's own queue sends at the due time, so Facebook's
    // server-side scheduling (scheduled_publish_time) is deliberately not used.
    const scheduled = false as boolean;
    const scheduleParams: Record<string, string | number | boolean> = {};
    let id: string;
    if (video) {
      const form = new FormData();
      form.set("description", message);
      if (target.title) form.set("title", target.title);
      form.set("source", new Blob([new Uint8Array(await video.read())], { type: video.mimeType }), video.filename);
      for (const [k, v] of Object.entries(scheduleParams)) form.set(k, String(v));
      const res = await graph<{ id: string }>(`/${page}/videos`, { method: "POST", token, form });
      id = res.id;
    } else if (images.length === 1) {
      const img = images[0]!;
      const form = new FormData();
      form.set("message", message + (target.link ? `\n${target.link}` : ""));
      form.set("source", new Blob([new Uint8Array(await img.read())], { type: img.mimeType }), img.filename);
      for (const [k, v] of Object.entries(scheduleParams)) form.set(k, String(v));
      const res = await graph<{ id: string; post_id?: string }>(`/${page}/photos`, { method: "POST", token, form });
      id = res.post_id ?? res.id;
    } else if (images.length > 1) {
      const mediaIds: string[] = [];
      for (const img of images) {
        const form = new FormData();
        form.set("published", "false");
        form.set("source", new Blob([new Uint8Array(await img.read())], { type: img.mimeType }), img.filename);
        const r = await graph<{ id: string }>(`/${page}/photos`, { method: "POST", token, form });
        mediaIds.push(r.id);
      }
      const params: Record<string, string | number | boolean> = { message: message + (target.link ? `\n${target.link}` : ""), ...(scheduleParams as Record<string, string | number | boolean>) };
      mediaIds.forEach((m, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: m })));
      const res = await graph<{ id: string }>(`/${page}/feed`, { method: "POST", token, params });
      id = res.id;
    } else {
      const res = await graph<{ id: string }>(`/${page}/feed`, { method: "POST", token, params: { message, link: target.link ?? undefined, ...scheduleParams } });
      id = res.id;
    }
    if (target.overrides.firstComment && !scheduled) {
      try {
        await graph(`/${id}/comments`, { method: "POST", token, params: { message: String(target.overrides.firstComment) } });
      } catch {
        /* first comment is best effort; the post itself succeeded */
      }
    }
    let remoteUrl = `https://www.facebook.com/${id}`;
    if (!scheduled && !video) {
      try {
        const pl = await graph<{ permalink_url?: string }>(`/${id}`, { token, params: { fields: "permalink_url" } });
        if (pl.permalink_url) remoteUrl = pl.permalink_url;
      } catch {
        /* permalink lookup is best effort; the post id is the proof of publication */
      }
    }
    return { status: scheduled ? "scheduled_remote" : video ? "processing" : "published", remotePostId: id, remoteUrl };
  },
  async findRecentPost(ctx, target, since) {
    const r = await graph<{ data?: Array<{ id: string; message?: string; created_time: string; permalink_url?: string }> }>(`/${ctx.externalAccountId}/posts`, { token: pageToken(ctx), params: { fields: "id,message,created_time,permalink_url", limit: 25, since: Math.floor(since.getTime() / 1000) } });
    const want = norm(fbMessage(target));
    const hit = (r.data ?? []).find((p) => new Date(p.created_time).getTime() >= since.getTime() && (norm(p.message) === want || norm(p.message) === norm(target.body)));
    return hit ? { remotePostId: hit.id, remoteUrl: hit.permalink_url ?? null } : null;
  },
  async getPublishStatus(ctx, remotePostId): Promise<PublishStatus> {
    try {
      const r = await graph<{ id: string; permalink_url?: string; status?: { video_status?: string }; is_published?: boolean }>(`/${remotePostId}`, { token: pageToken(ctx), params: { fields: "id,permalink_url,is_published" } });
      if (r.is_published === false) return { status: "processing", remoteUrl: r.permalink_url ?? null };
      return { status: "published", remoteUrl: r.permalink_url ?? null };
    } catch (err) {
      if (err instanceof ProviderError && err.options.category === "not_found") return { status: "deleted" };
      // Videos: query the video object status
      try {
        const v = await graph<{ status?: { video_status?: string }; permalink_url?: string }>(`/${remotePostId}`, { token: pageToken(ctx), params: { fields: "status,permalink_url" } });
        const s = v.status?.video_status;
        return { status: s === "ready" ? "published" : s === "error" ? "failed" : "processing", remoteUrl: v.permalink_url ? `https://www.facebook.com${v.permalink_url}` : null };
      } catch {
        return { status: "unknown", error: (err as Error).message };
      }
    }
  },
  async deletePost(ctx, remotePostId) {
    await graph(`/${remotePostId}`, { method: "DELETE", token: pageToken(ctx) });
  },
  async fetchMetrics(ctx, range: DateRange): Promise<MetricResult[]> {
    const token = pageToken(ctx);
    const page = ctx.externalAccountId;
    const out: MetricResult[] = [];
    const now = new Date();
    const src = "native:graph/insights";
    const p = await graph<{ followers_count?: number; fan_count?: number }>(`/${page}`, { token, params: { fields: "followers_count,fan_count" } });
    out.push({ scope: "account", subjectId: page, metric: "followers", granularity: "lifetime", bucketTime: now, value: p.followers_count ?? null, source: "native:graph/page" });
    out.push({ scope: "account", subjectId: page, metric: "page_likes", granularity: "lifetime", bucketTime: now, value: p.fan_count ?? null, source: "native:graph/page" });
    try {
      const ins = await graph<{ data?: Array<{ name: string; period: string; values: Array<{ value: number | Record<string, number>; end_time: string }> }> }>(`/${page}/insights`, { token, params: { metric: "page_impressions_unique,page_post_engagements,page_views_total", period: "day", since: Math.floor(range.from.getTime() / 1000), until: Math.floor(range.to.getTime() / 1000) } });
      const map: Record<string, string> = { page_impressions_unique: "reach", page_post_engagements: "engagements", page_views_total: "profile_views" };
      for (const m of ins.data ?? []) for (const v of m.values) out.push({ scope: "account", subjectId: page, metric: map[m.name] ?? m.name, granularity: "day", bucketTime: new Date(v.end_time), value: typeof v.value === "number" ? v.value : null, source: src });
    } catch (err) {
      if (!(err instanceof ProviderError && (err.options.category === "permission" || err.options.category === "validation"))) throw err;
    }
    const posts = await graph<{ data?: Array<{ id: string; created_time: string; permalink_url?: string }> }>(`/${page}/posts`, { token, params: { fields: "id,created_time,permalink_url", since: Math.floor(range.from.getTime() / 1000), limit: 50 } });
    for (const post of posts.data ?? []) {
      try {
        const pi = await graph<{ data?: Array<{ name: string; values: Array<{ value: number | Record<string, number> }> }> }>(`/${post.id}/insights`, { token, params: { metric: "post_impressions,post_impressions_unique,post_engaged_users,post_clicks,post_reactions_by_type_total" } });
        const map: Record<string, string> = { post_impressions: "impressions", post_impressions_unique: "reach", post_engaged_users: "engagements", post_clicks: "clicks" };
        for (const m of pi.data ?? []) {
          const v = m.values[0]?.value;
          if (m.name === "post_reactions_by_type_total" && v && typeof v === "object") out.push({ scope: "post", subjectId: post.id, metric: "likes", granularity: "lifetime", bucketTime: now, value: Object.values(v).reduce((a, b) => a + b, 0), source: src });
          else out.push({ scope: "post", subjectId: post.id, metric: map[m.name] ?? m.name, granularity: "lifetime", bucketTime: now, value: typeof v === "number" ? v : null, source: src });
        }
      } catch (err) {
        if (!(err instanceof ProviderError && (err.options.category === "permission" || err.options.category === "validation"))) throw err;
      }
    }
    return out;
  },
  async fetchComments(ctx, input) {
    const token = pageToken(ctx);
    const page = ctx.externalAccountId;
    const postIds: string[] = [];
    if (input.externalPostId) postIds.push(input.externalPostId);
    else {
      const posts = await graph<{ data?: Array<{ id: string }> }>(`/${page}/posts`, { token, params: { fields: "id", limit: 25 } });
      postIds.push(...(posts.data ?? []).map((p) => p.id));
    }
    const comments = [];
    for (const pid of postIds) {
      const r = await graph<{ data?: Array<{ id: string; message?: string; created_time: string; from?: { id: string; name: string }; parent?: { id: string }; is_hidden?: boolean }> }>(`/${pid}/comments`, { token, params: { fields: "id,message,created_time,from,parent,is_hidden", filter: "stream", limit: 100 } });
      for (const c of r.data ?? []) comments.push({ externalCommentId: c.id, externalPostId: pid, parentExternalId: c.parent?.id ?? null, authorId: c.from?.id ?? null, authorName: c.from?.name ?? null, body: c.message ?? "", isOwner: c.from?.id === page, hidden: c.is_hidden ?? false, createdAt: new Date(c.created_time) });
    }
    return { comments, nextCursor: null };
  },
  async replyComment(ctx, input) {
    const r = await graph<{ id: string }>(`/${input.externalCommentId}/comments`, { method: "POST", token: pageToken(ctx), params: { message: input.body } });
    return { externalCommentId: r.id };
  },
};

// ---------------------------------------------------------------------------
// Instagram professional account (Facebook Login via a linked Page, or Instagram Login)
// ---------------------------------------------------------------------------

export const instagramDescriptor: ProviderDescriptor = {
  id: "instagram",
  backend: "native",
  displayName: "Instagram",
  connect: { kind: "oauth", notes: "Professional (Business or Creator) accounts only. Photos must be JPEG; Instagram fetches the file from a signed URL." },
  capabilities: { connect: "supported", publish_text: "unsupported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", publish_story: "supported", publish_short: "supported", first_comment: "supported", delete_post: "unsupported", edit_post: "unsupported", schedule_remote: "unsupported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", hide_comment: "supported", read_dm: "needs_approval", send_dm: "needs_approval", ads_read: "unsupported", ads_write: "unsupported" },
  limits: { maxTextLength: 2200, maxImages: 10, maxImageBytes: 8 * 1024 * 1024, maxVideoBytes: 1024 * 1024 * 1024, maxVideoSeconds: 900, imageMimeTypes: ["image/jpeg"], videoMimeTypes: ["video/mp4", "video/quicktime"] },
  implementationStatus: "CODE_COMPLETE_NEEDS_CREDENTIALS",
  docsUrl: "https://developers.facebook.com/documentation/instagram-platform/content-publishing",
  requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
  loginMethods: [
    { id: "facebook_login", label: "Facebook login", notes: "For an Instagram professional account linked to a Facebook Page you manage. One sign-in can connect the Page and its Instagram account.", requiredEnv: ["META_APP_ID", "META_APP_SECRET"] },
    { id: "instagram_login", label: "Instagram login", notes: "Sign in on Instagram directly. No Facebook Page needed.", requiredEnv: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"] },
  ],
};

async function waitForContainer(auth: { token: string; base: string }, creationId: string, tries = 30, delayMs = Number(process.env.META_CONTAINER_POLL_MS ?? 4000)): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const r = await graph<{ status_code?: string; status?: string }>(`/${creationId}`, { ...auth, params: { fields: "status_code,status" } });
    if (!r.status_code || r.status_code === "FINISHED" || r.status_code === "PUBLISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") throw new ProviderError(`Instagram could not process the media (${r.status_code}${r.status ? `: ${r.status}` : ""}).`, { category: "validation", retryable: false });
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new ProviderError("Instagram is still processing the media.", { category: "provider_error", retryable: true });
}

async function exchangeInstagramLogin(input: { code: string; redirectUri: string; callbackParams: Record<string, string>; app?: Record<string, string> }): Promise<ConnectResult> {
  const cb = input.callbackParams;
  if (cb.error) throw new ProviderError(`Instagram sign-in was not completed: ${cb.error_description ?? cb.error_reason ?? cb.error}`, { category: "permission", retryable: false });
  const { id, secret } = appCreds(input.app, "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET");
  const form = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "authorization_code", redirect_uri: input.redirectUri, code: input.code.replace(/#_$/, "") });
  type Short = { access_token?: string; user_id?: string | number; permissions?: string | string[] };
  const res = await http<Short & { data?: Short[]; error_message?: string } & GraphError>(igTokenUrl(), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const short: Short | undefined = res.data?.data?.[0] ?? res.data;
  if (res.status !== 200 || !short?.access_token) throw new ProviderError(`Instagram code exchange failed: ${res.data?.error_message ?? res.data?.error?.message ?? `HTTP ${res.status}`}`, { category: "auth_expired", retryable: false });
  const ll = await http<{ access_token?: string; expires_in?: number } & GraphError>(buildUrl(`${igGraphHost()}/access_token`, { grant_type: "ig_exchange_token", client_secret: secret, access_token: short.access_token }));
  if (ll.status !== 200 || !ll.data?.access_token) throw new ProviderError(`Instagram long-lived token exchange failed: ${ll.data?.error?.message ?? `HTTP ${ll.status}`}`, { category: "auth_expired", retryable: false });
  const token = ll.data.access_token;
  const me = await graph<{ id: string; user_id?: string; username?: string; name?: string; profile_picture_url?: string; account_type?: string }>("/me", { token, base: igGraphBase(), params: { fields: "user_id,username,name,profile_picture_url,account_type" } });
  const granted = Array.isArray(short.permissions) ? short.permissions : (short.permissions ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const igId = String(me.user_id ?? me.id);
  return {
    accounts: [{ provider: "instagram", externalAccountId: igId, accountType: "instagram_login", displayName: me.name ?? me.username ?? igId, username: me.username, profileUrl: me.username ? `https://www.instagram.com/${me.username}` : undefined, avatarUrl: me.profile_picture_url, scopes: granted, metadata: { accountType: me.account_type, grantedScopes: granted, loginMethod: "instagram_login" } }],
    credentials: { igUserToken: token },
    expiresAt: ll.data.expires_in ? new Date(Date.now() + ll.data.expires_in * 1000) : new Date(Date.now() + 60 * 24 * 3600_000),
  };
}

export const instagramAdapter: SocialAdapter = {
  descriptor: instagramDescriptor,
  async discoverCapabilities(ctx): Promise<CapabilityMap> {
    const caps = { ...instagramDescriptor.capabilities };
    const own = ctx.metadata.loginMethod === "instagram_login";
    const publish = own ? "instagram_business_content_publish" : "instagram_content_publish";
    const comments = own ? "instagram_business_manage_comments" : "instagram_manage_comments";
    const insights = own ? "instagram_business_manage_insights" : "instagram_manage_insights";
    if (!has(ctx, publish)) for (const c of ["publish_image", "publish_video", "publish_carousel", "publish_story", "publish_short", "first_comment"] as const) caps[c] = "needs_approval";
    if (!has(ctx, comments)) for (const c of ["read_comments", "reply_comment", "hide_comment"] as const) caps[c] = "needs_approval";
    if (!has(ctx, insights)) caps.read_analytics = "needs_approval";
    return caps;
  },
  async buildAuthorizationUrl(input) {
    if (input.extra?.loginMethod === "instagram_login") {
      const { id } = appCreds(input.app, "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET");
      return buildUrl(igAuthorizeUrl(), { client_id: id, redirect_uri: input.redirectUri, response_type: "code", scope: scopeList("INSTAGRAM_LOGIN_SCOPES", [...INSTAGRAM_LOGIN_SCOPES, ...(extended(input.app) ? INSTAGRAM_LOGIN_SCOPES_EXTENDED : [])]).join(","), state: input.state, ...(input.extra?.reconnect ? { force_reauth: "true" } : {}) });
    }
    // Facebook Login: ask for the Page permissions too, so one sign-in can connect the Page and its Instagram account.
    return facebookDialog(input, scopeList("META_INSTAGRAM_SCOPES", [...META_PAGE_SCOPES, ...META_IG_VIA_FACEBOOK_SCOPES, ...(extended(input.app) ? [...META_PAGE_SCOPES_EXTENDED, ...META_IG_VIA_FACEBOOK_SCOPES_EXTENDED] : [])]));
  },
  async exchangeAuthorizationCode(input): Promise<ConnectResult> {
    if (input.callbackParams.__loginMethod === "instagram_login") return exchangeInstagramLogin(input);
    return exchangeFacebookLogin("instagram", input);
  },
  async refreshCredentials(ctx) {
    const own = ctx.credentials.igUserToken;
    if (typeof own !== "string" || !own) return { credentials: ctx.credentials, expiresAt: null }; // Page tokens do not expire
    const r = await http<{ access_token?: string; expires_in?: number } & GraphError>(buildUrl(`${igGraphHost()}/refresh_access_token`, { grant_type: "ig_refresh_token", access_token: own }));
    if (r.status !== 200 || !r.data?.access_token) throw new ProviderError(`Instagram token refresh failed: ${r.data?.error?.message ?? `HTTP ${r.status}`}`, { category: "auth_expired", retryable: false });
    return { credentials: { ...ctx.credentials, igUserToken: r.data.access_token }, expiresAt: new Date(Date.now() + (r.data.expires_in ?? 60 * 24 * 3600) * 1000) };
  },
  async verifyConnection(ctx): Promise<HealthResult> {
    try {
      const me = await graph<{ id: string; username: string }>(`/${ctx.externalAccountId}`, { ...igAuth(ctx), params: { fields: "id,username" } });
      return { ok: true, status: "healthy", message: `@${me.username} reachable.` };
    } catch (err) {
      const e = err as ProviderError;
      return { ok: false, status: "error", message: e.message, details: { category: e.options?.category ?? "unknown" } };
    }
  },
  async validatePost(_ctx, target): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const images = target.media.filter((m) => m.mimeType.startsWith("image/"));
    const videos = target.media.filter((m) => m.mimeType.startsWith("video/"));
    const ct = (target.overrides.contentType as string | undefined) ?? "feed";
    if (!target.media.length) issues.push({ level: "error", code: "media_required", message: "Instagram needs at least one photo or video." });
    if (target.body.length > 2200) issues.push({ level: "error", code: "too_long", message: "Caption exceeds 2,200 characters." });
    if (target.media.length > 10) issues.push({ level: "error", code: "too_many", message: "Carousels hold at most 10 items." });
    for (const m of images) if (m.mimeType !== "image/jpeg") issues.push({ level: "error", code: "image_format", message: `${m.filename}: Instagram accepts JPEG photos only — convert this ${m.mimeType.replace("image/", "").toUpperCase()} to JPEG.` });
    for (const m of images) if (m.sizeBytes > 8 * 1024 * 1024) issues.push({ level: "error", code: "image_too_big", message: `${m.filename}: Instagram photos must be 8 MB or smaller.` });
    if (ct === "story" && target.media.length !== 1) issues.push({ level: "error", code: "story_single", message: "A story takes exactly one image or video." });
    if (ct === "reel" && videos.length !== 1) issues.push({ level: "error", code: "reel_video", message: "A Reel needs exactly one video." });
    if (target.media.some((m) => !m.signedUrl)) issues.push({ level: "error", code: "public_url_required", message: "Instagram fetches media from a URL, and the current storage (local disk) cannot provide one. Use the Supabase or S3 storage driver." });
    return { ok: !issues.some((i) => i.level === "error"), issues, format: ct === "story" ? "story" : videos.length === 1 && images.length === 0 ? "reel" : target.media.length > 1 ? "carousel" : "image" };
  },
  async publish(ctx, target): Promise<PublishResult> {
    const auth = igAuth(ctx);
    const ig = ctx.externalAccountId;
    const ct = (target.overrides.contentType as string | undefined) ?? "feed";
    const caption = target.body;
    const urlOf = async (m: TargetPost["media"][number]) => {
      const u = await m.signedUrl?.();
      if (!u) throw new ProviderError(`No URL available for ${m.filename}.`, { category: "validation", retryable: false });
      return u;
    };
    let creationId: string;
    if (target.media.length === 1) {
      const m = target.media[0]!;
      const isVideo = m.mimeType.startsWith("video/");
      const params: Record<string, string | number | boolean | undefined> = isVideo
        ? { media_type: ct === "story" ? "STORIES" : "REELS", video_url: await urlOf(m), caption: ct === "story" ? undefined : caption, share_to_feed: ct === "story" ? undefined : true }
        : { image_url: await urlOf(m), caption: ct === "story" ? undefined : caption, media_type: ct === "story" ? "STORIES" : undefined };
      const c = await graph<{ id: string }>(`/${ig}/media`, { method: "POST", ...auth, params });
      creationId = c.id;
      // Photos are normally ready at once; videos need processing. Never publish an unfinished container.
      await waitForContainer(auth, creationId, isVideo ? 30 : 8);
    } else {
      const children: string[] = [];
      for (const m of target.media) {
        const isVideo = m.mimeType.startsWith("video/");
        const c = await graph<{ id: string }>(`/${ig}/media`, { method: "POST", ...auth, params: { is_carousel_item: true, ...(isVideo ? { media_type: "VIDEO", video_url: await urlOf(m) } : { image_url: await urlOf(m) }) } });
        if (isVideo) await waitForContainer(auth, c.id);
        children.push(c.id);
      }
      const c = await graph<{ id: string }>(`/${ig}/media`, { method: "POST", ...auth, params: { media_type: "CAROUSEL", children: children.join(","), caption } });
      creationId = c.id;
      await waitForContainer(auth, creationId, 8);
    }
    // A container id is not proof of publication; only the media id returned by media_publish is.
    const pub = await graph<{ id: string }>(`/${ig}/media_publish`, { method: "POST", ...auth, params: { creation_id: creationId } });
    let permalink: string | null = null;
    try {
      const media = await graph<{ id: string; permalink?: string }>(`/${pub.id}`, { ...auth, params: { fields: "id,permalink" } });
      permalink = media.permalink ?? null;
    } catch {
      /* permalink lookup is best effort; the media id is the proof of publication */
    }
    if (target.overrides.firstComment) {
      try {
        await graph(`/${pub.id}/comments`, { method: "POST", ...auth, params: { message: String(target.overrides.firstComment) } });
      } catch {
        /* best effort */
      }
    }
    return { status: "published", remotePostId: pub.id, remoteUrl: permalink };
  },
  async getPublishStatus(ctx, remotePostId): Promise<PublishStatus> {
    try {
      const m = await graph<{ id: string; permalink?: string }>(`/${remotePostId}`, { ...igAuth(ctx), params: { fields: "id,permalink" } });
      return { status: "published", remoteUrl: m.permalink ?? null };
    } catch (err) {
      if (err instanceof ProviderError && err.options.category === "not_found") return { status: "deleted" };
      return { status: "unknown", error: (err as Error).message };
    }
  },
  async findRecentPost(ctx, target, since) {
    const r = await graph<{ data?: Array<{ id: string; caption?: string; permalink?: string; timestamp: string }> }>(`/${ctx.externalAccountId}/media`, { ...igAuth(ctx), params: { fields: "id,caption,permalink,timestamp", limit: 25 } });
    const want = norm(target.body);
    const hit = (r.data ?? []).find((m) => new Date(m.timestamp).getTime() >= since.getTime() && norm(m.caption) === want);
    return hit ? { remotePostId: hit.id, remoteUrl: hit.permalink ?? null } : null;
  },
  async fetchMetrics(ctx, range: DateRange): Promise<MetricResult[]> {
    const auth = igAuth(ctx);
    const ig = ctx.externalAccountId;
    const now = new Date();
    const out: MetricResult[] = [];
    const acc = await graph<{ followers_count?: number; media_count?: number }>(`/${ig}`, { ...auth, params: { fields: "followers_count,media_count" } });
    out.push({ scope: "account", subjectId: ig, metric: "followers", granularity: "lifetime", bucketTime: now, value: acc.followers_count ?? null, source: "native:graph/ig-user" });
    out.push({ scope: "account", subjectId: ig, metric: "posts", granularity: "lifetime", bucketTime: now, value: acc.media_count ?? null, source: "native:graph/ig-user" });
    try {
      const ins = await graph<{ data?: Array<{ name: string; values: Array<{ value: number; end_time: string }> }> }>(`/${ig}/insights`, { ...auth, params: { metric: "reach,profile_views,accounts_engaged", period: "day", metric_type: "total_value", since: Math.floor(range.from.getTime() / 1000), until: Math.floor(range.to.getTime() / 1000) } });
      for (const m of ins.data ?? []) for (const v of m.values ?? []) out.push({ scope: "account", subjectId: ig, metric: m.name, granularity: "day", bucketTime: new Date(v.end_time), value: typeof v.value === "number" ? v.value : null, source: "native:graph/ig-insights" });
    } catch (err) {
      if (!(err instanceof ProviderError && (err.options.category === "permission" || err.options.category === "validation"))) throw err;
    }
    const media = await graph<{ data?: Array<{ id: string; media_type: string; timestamp: string; like_count?: number; comments_count?: number; permalink?: string }> }>(`/${ig}/media`, { ...auth, params: { fields: "id,media_type,timestamp,like_count,comments_count,permalink", limit: 50 } });
    for (const m of media.data ?? []) {
      if (new Date(m.timestamp) < range.from) continue;
      out.push({ scope: "post", subjectId: m.id, metric: "likes", granularity: "lifetime", bucketTime: now, value: m.like_count ?? null, source: "native:graph/ig-media" });
      out.push({ scope: "post", subjectId: m.id, metric: "comments", granularity: "lifetime", bucketTime: now, value: m.comments_count ?? null, source: "native:graph/ig-media" });
      try {
        const metrics = "reach,saved,shares,views"; // "impressions" was retired for media in newer Graph versions
        const pi = await graph<{ data?: Array<{ name: string; values: Array<{ value: number }> }> }>(`/${m.id}/insights`, { ...auth, params: { metric: metrics } });
        for (const x of pi.data ?? []) out.push({ scope: "post", subjectId: m.id, metric: x.name === "saved" ? "saves" : x.name, granularity: "lifetime", bucketTime: now, value: x.values[0]?.value ?? null, source: "native:graph/ig-media-insights" });
      } catch (err) {
        if (!(err instanceof ProviderError && (err.options.category === "permission" || err.options.category === "validation"))) throw err;
      }
    }
    return out;
  },
  async fetchComments(ctx, input) {
    const auth = igAuth(ctx);
    const ig = ctx.externalAccountId;
    const ids: string[] = input.externalPostId ? [input.externalPostId] : ((await graph<{ data?: Array<{ id: string }> }>(`/${ig}/media`, { ...auth, params: { fields: "id", limit: 25 } })).data ?? []).map((m) => m.id);
    const comments = [];
    for (const mid of ids) {
      const r = await graph<{ data?: Array<{ id: string; text?: string; timestamp: string; username?: string; from?: { id: string; username: string }; hidden?: boolean; replies?: { data?: Array<{ id: string; text?: string; timestamp: string; username?: string; from?: { id: string; username: string } }> } }> }>(`/${mid}/comments`, { ...auth, params: { fields: "id,text,timestamp,username,from,hidden,replies{id,text,timestamp,username,from}", limit: 50 } });
      for (const c of r.data ?? []) {
        comments.push({ externalCommentId: c.id, externalPostId: mid, parentExternalId: null, authorId: c.from?.id ?? null, authorName: c.from?.username ?? c.username ?? null, body: c.text ?? "", isOwner: c.from?.id === ig, hidden: c.hidden ?? false, createdAt: new Date(c.timestamp) });
        for (const rp of c.replies?.data ?? []) comments.push({ externalCommentId: rp.id, externalPostId: mid, parentExternalId: c.id, authorId: rp.from?.id ?? null, authorName: rp.from?.username ?? rp.username ?? null, body: rp.text ?? "", isOwner: rp.from?.id === ig, createdAt: new Date(rp.timestamp) });
      }
    }
    return { comments, nextCursor: null };
  },
  async replyComment(ctx, input) {
    const r = await graph<{ id: string }>(`/${input.externalCommentId}/replies`, { method: "POST", ...igAuth(ctx), params: { message: input.body } });
    return { externalCommentId: r.id };
  },
};
