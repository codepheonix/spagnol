/**
 * Meta native adapters: Facebook Pages and Instagram professional accounts (Facebook Login path).
 * Graph API docs: https://developers.facebook.com/docs/graph-api
 *
 * Requires a Meta developer app (META_APP_ID / META_APP_SECRET). For accounts the owner manages,
 * Standard Access is enough for pages_* and instagram_* permissions; App Review is needed to use
 * them with accounts outside the app's roles. Status is recorded in docs/provider-capabilities.md.
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
  type SocialAdapter,
  type TargetPost,
  type ValidationIssue,
  type ValidationResult,
  ProviderError,
} from "../contract";

const VERSION = process.env.META_GRAPH_VERSION ?? "v22.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const DIALOG = `https://www.facebook.com/${VERSION}/dialog/oauth`;

const FB_SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "pages_manage_engagement", "pages_read_user_content", "pages_manage_metadata", "pages_messaging", "business_management"];
const IG_SCOPES = ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_insights", "instagram_manage_messages"];

function appCreds() {
  const id = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!id || !secret) throw new ProviderError("META_APP_ID / META_APP_SECRET are not configured.", { category: "auth_expired", retryable: false });
  return { id, secret };
}

interface GraphError {
  error?: { message: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}

async function graph<T>(path: string, opts: { method?: "GET" | "POST" | "DELETE"; token: string; params?: Record<string, string | number | boolean | undefined>; form?: FormData }): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
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

async function exchangeCode(code: string, redirectUri: string): Promise<{ access_token: string; expires_in?: number }> {
  const { id, secret } = appCreds();
  const res = await http<{ access_token: string; expires_in?: number } & GraphError>(buildUrl(`${GRAPH}/oauth/access_token`, { client_id: id, client_secret: secret, redirect_uri: redirectUri, code }));
  if (res.status !== 200 || !res.data?.access_token) throw new ProviderError(`Meta code exchange failed: ${res.data?.error?.message ?? res.status}`, { category: "auth_expired", retryable: false });
  // Upgrade to a long-lived user token (~60 days)
  const ll = await http<{ access_token: string; expires_in?: number } & GraphError>(buildUrl(`${GRAPH}/oauth/access_token`, { grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: res.data.access_token }));
  return ll.status === 200 && ll.data?.access_token ? ll.data : res.data;
}

interface PageRow {
  id: string;
  name: string;
  access_token: string;
  category?: string;
  tasks?: string[];
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
}

async function listPages(userToken: string): Promise<PageRow[]> {
  const out: PageRow[] = [];
  let url: string | undefined = buildUrl(`${GRAPH}/me/accounts`, { fields: "id,name,access_token,category,tasks,instagram_business_account{id,username,name,profile_picture_url}", limit: 100, access_token: userToken });
  while (url) {
    const res: { status: number; data: { data?: PageRow[]; paging?: { next?: string } } & GraphError } = await http(url);
    if (res.data?.error) throw new ProviderError(`Meta /me/accounts: ${res.data.error.message}`, { category: "permission", retryable: false });
    out.push(...(res.data.data ?? []));
    url = res.data.paging?.next;
  }
  return out;
}

function pageToken(ctx: AccountContext): string {
  const t = ctx.credentials.pageAccessToken;
  if (typeof t !== "string" || !t) throw new ProviderError("Missing Page access token.", { category: "auth_expired", retryable: false });
  return t;
}

// ---------------------------------------------------------------------------
// Facebook Page
// ---------------------------------------------------------------------------

export const facebookDescriptor: ProviderDescriptor = {
  id: "facebook",
  backend: "native",
  displayName: "Facebook Page",
  connect: { kind: "oauth", notes: "Facebook Login → pick the Pages you manage. Needs a Meta developer app with the pages_* permissions." },
  capabilities: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", publish_link: "supported", publish_story: "not_tested", publish_short: "not_tested", first_comment: "supported", delete_post: "supported", edit_post: "supported", schedule_remote: "supported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", hide_comment: "supported", read_dm: "needs_approval", send_dm: "needs_approval", ads_read: "unsupported", ads_write: "unsupported" },
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
    if (tasks.length && !tasks.includes("CREATE_CONTENT")) for (const c of ["publish_text", "publish_image", "publish_video", "publish_carousel", "publish_link"] as const) caps[c] = "needs_approval";
    if (tasks.length && !tasks.includes("MODERATE")) {
      caps.reply_comment = "needs_approval";
      caps.hide_comment = "needs_approval";
    }
    return caps;
  },
  async buildAuthorizationUrl({ state, redirectUri }) {
    const { id } = appCreds();
    return buildUrl(DIALOG, { client_id: id, redirect_uri: redirectUri, state, scope: FB_SCOPES.join(","), response_type: "code" });
  },
  async exchangeAuthorizationCode({ code, redirectUri, callbackParams }): Promise<ConnectResult> {
    if (callbackParams.error) throw new ProviderError(`Facebook Login denied: ${callbackParams.error_description ?? callbackParams.error}`, { category: "permission", retryable: false });
    const user = await exchangeCode(code, redirectUri);
    const pages = await listPages(user.access_token);
    if (!pages.length) throw new ProviderError("No Facebook Pages were granted. Re-run the login and tick the Pages you manage.", { category: "permission", retryable: false });
    const perAccountCredentials: Record<string, Record<string, unknown>> = {};
    for (const p of pages) perAccountCredentials[p.id] = { pageAccessToken: p.access_token, userAccessToken: user.access_token };
    return {
      accounts: pages.map((p) => ({ externalAccountId: p.id, accountType: "page", displayName: p.name, profileUrl: `https://www.facebook.com/${p.id}`, metadata: { category: p.category, tasks: p.tasks ?? [], instagramBusinessAccountId: p.instagram_business_account?.id } })),
      credentials: { userAccessToken: user.access_token },
      perAccountCredentials,
      expiresAt: user.expires_in ? new Date(Date.now() + user.expires_in * 1000) : null, // page tokens from long-lived user tokens do not expire
    };
  },
  async verifyConnection(ctx): Promise<HealthResult> {
    try {
      const me = await graph<{ id: string; name: string }>(`/${ctx.externalAccountId}`, { token: pageToken(ctx), params: { fields: "id,name" } });
      return { ok: true, status: "healthy", message: `Page "${me.name}" reachable.` };
    } catch (err) {
      const e = err as ProviderError;
      return { ok: false, status: "error", message: e.message, details: { category: e.options?.category } };
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
    const scheduled = target.scheduledAt && target.scheduledAt.getTime() > Date.now() + 10 * 60_000 && target.scheduledAt.getTime() < Date.now() + 75 * 24 * 3600_000;
    const scheduleParams = scheduled ? { published: false, scheduled_publish_time: Math.floor(target.scheduledAt!.getTime() / 1000) } : {};
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
    return { status: scheduled ? "scheduled_remote" : video ? "processing" : "published", remotePostId: id, remoteUrl: `https://www.facebook.com/${id}` };
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
      if (!(err instanceof ProviderError && err.options.category === "permission")) throw err;
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
        if (!(err instanceof ProviderError && err.options.category === "permission")) throw err;
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
// Instagram professional (via Facebook Login + linked Page)
// ---------------------------------------------------------------------------

export const instagramDescriptor: ProviderDescriptor = {
  id: "instagram",
  backend: "native",
  displayName: "Instagram professional (via Facebook Login)",
  connect: { kind: "oauth", notes: "Facebook Login; the Instagram professional account must be linked to a Facebook Page you manage. Media must be reachable by Instagram at a public/signed URL (S3 storage driver)." },
  capabilities: { connect: "supported", publish_text: "unsupported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", publish_story: "supported", publish_short: "supported", first_comment: "supported", delete_post: "unsupported", edit_post: "unsupported", schedule_remote: "unsupported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", hide_comment: "supported", read_dm: "needs_approval", send_dm: "needs_approval", ads_read: "unsupported", ads_write: "unsupported" },
  limits: { maxTextLength: 2200, maxImages: 10, maxImageBytes: 8 * 1024 * 1024, maxVideoBytes: 1024 * 1024 * 1024, maxVideoSeconds: 900, imageMimeTypes: ["image/jpeg", "image/png"], videoMimeTypes: ["video/mp4", "video/quicktime"] },
  implementationStatus: "CODE_COMPLETE_NEEDS_CREDENTIALS",
  docsUrl: "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing",
  requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
};

async function waitForContainer(token: string, creationId: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const r = await graph<{ status_code?: string; status?: string }>(`/${creationId}`, { token, params: { fields: "status_code,status" } });
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") throw new ProviderError(`Instagram media container ${r.status_code}: ${r.status ?? ""}`, { category: "validation", retryable: false });
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new ProviderError("Instagram media container still processing after 2 minutes.", { category: "provider_error", retryable: true });
}

export const instagramAdapter: SocialAdapter = {
  descriptor: instagramDescriptor,
  async discoverCapabilities(): Promise<CapabilityMap> {
    return { ...instagramDescriptor.capabilities };
  },
  async buildAuthorizationUrl({ state, redirectUri }) {
    const { id } = appCreds();
    return buildUrl(DIALOG, { client_id: id, redirect_uri: redirectUri, state, scope: IG_SCOPES.join(","), response_type: "code" });
  },
  async exchangeAuthorizationCode({ code, redirectUri, callbackParams }): Promise<ConnectResult> {
    if (callbackParams.error) throw new ProviderError(`Facebook Login denied: ${callbackParams.error_description ?? callbackParams.error}`, { category: "permission", retryable: false });
    const user = await exchangeCode(code, redirectUri);
    const pages = (await listPages(user.access_token)).filter((p) => p.instagram_business_account);
    if (!pages.length) throw new ProviderError("None of the granted Pages has a linked Instagram professional account.", { category: "permission", retryable: false });
    const perAccountCredentials: Record<string, Record<string, unknown>> = {};
    for (const p of pages) perAccountCredentials[p.instagram_business_account!.id] = { pageAccessToken: p.access_token, pageId: p.id, userAccessToken: user.access_token };
    return {
      accounts: pages.map((p) => ({ externalAccountId: p.instagram_business_account!.id, accountType: "professional", displayName: p.instagram_business_account!.name ?? p.instagram_business_account!.username ?? p.name, username: p.instagram_business_account!.username, profileUrl: p.instagram_business_account!.username ? `https://www.instagram.com/${p.instagram_business_account!.username}` : undefined, avatarUrl: p.instagram_business_account!.profile_picture_url, metadata: { pageId: p.id, pageName: p.name } })),
      credentials: { userAccessToken: user.access_token },
      perAccountCredentials,
      expiresAt: null,
    };
  },
  async verifyConnection(ctx): Promise<HealthResult> {
    try {
      const me = await graph<{ id: string; username: string }>(`/${ctx.externalAccountId}`, { token: pageToken(ctx), params: { fields: "id,username" } });
      return { ok: true, status: "healthy", message: `@${me.username} reachable.` };
    } catch (err) {
      return { ok: false, status: "error", message: (err as Error).message };
    }
  },
  async validatePost(_ctx, target): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const images = target.media.filter((m) => m.mimeType.startsWith("image/"));
    const videos = target.media.filter((m) => m.mimeType.startsWith("video/"));
    const ct = (target.overrides.contentType as string | undefined) ?? "feed";
    if (!target.media.length) issues.push({ level: "error", code: "media_required", message: "Instagram needs at least one image or video." });
    if (target.body.length > 2200) issues.push({ level: "error", code: "too_long", message: "Caption exceeds 2,200 characters." });
    if (target.media.length > 10) issues.push({ level: "error", code: "too_many", message: "Carousels hold at most 10 items." });
    for (const m of images) if (!["image/jpeg", "image/png"].includes(m.mimeType)) issues.push({ level: "error", code: "image_format", message: `${m.filename}: Instagram accepts JPEG/PNG only.` });
    for (const m of images) if (m.sizeBytes > 8 * 1024 * 1024) issues.push({ level: "error", code: "image_too_big", message: `${m.filename}: ≤ 8 MB.` });
    if (ct === "story" && target.media.length !== 1) issues.push({ level: "error", code: "story_single", message: "A story takes exactly one image or video." });
    if (ct === "reel" && videos.length !== 1) issues.push({ level: "error", code: "reel_video", message: "A Reel needs exactly one video." });
    for (const m of target.media) if (!m.signedUrl) issues.push({ level: "error", code: "public_url_required", message: "Instagram fetches media by URL: use the S3 storage driver (signed URLs)." });
    return { ok: !issues.some((i) => i.level === "error"), issues, format: ct === "story" ? "story" : videos.length === 1 && images.length === 0 ? "reel" : target.media.length > 1 ? "carousel" : "image" };
  },
  async publish(ctx, target): Promise<PublishResult> {
    const token = pageToken(ctx);
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
      const c = await graph<{ id: string }>(`/${ig}/media`, { method: "POST", token, params });
      creationId = c.id;
      if (isVideo) await waitForContainer(token, creationId);
    } else {
      const children: string[] = [];
      for (const m of target.media) {
        const isVideo = m.mimeType.startsWith("video/");
        const c = await graph<{ id: string }>(`/${ig}/media`, { method: "POST", token, params: { is_carousel_item: true, ...(isVideo ? { media_type: "VIDEO", video_url: await urlOf(m) } : { image_url: await urlOf(m) }) } });
        if (isVideo) await waitForContainer(token, c.id);
        children.push(c.id);
      }
      const c = await graph<{ id: string }>(`/${ig}/media`, { method: "POST", token, params: { media_type: "CAROUSEL", children: children.join(","), caption } });
      creationId = c.id;
    }
    const pub = await graph<{ id: string }>(`/${ig}/media_publish`, { method: "POST", token, params: { creation_id: creationId } });
    const media = await graph<{ id: string; permalink?: string }>(`/${pub.id}`, { token, params: { fields: "id,permalink" } });
    if (target.overrides.firstComment) {
      try {
        await graph(`/${pub.id}/comments`, { method: "POST", token, params: { message: String(target.overrides.firstComment) } });
      } catch {
        /* best effort */
      }
    }
    return { status: "published", remotePostId: pub.id, remoteUrl: media.permalink ?? null };
  },
  async getPublishStatus(ctx, remotePostId): Promise<PublishStatus> {
    try {
      const m = await graph<{ id: string; permalink?: string }>(`/${remotePostId}`, { token: pageToken(ctx), params: { fields: "id,permalink" } });
      return { status: "published", remoteUrl: m.permalink ?? null };
    } catch (err) {
      if (err instanceof ProviderError && err.options.category === "not_found") return { status: "deleted" };
      return { status: "unknown", error: (err as Error).message };
    }
  },
  async fetchMetrics(ctx, range: DateRange): Promise<MetricResult[]> {
    const token = pageToken(ctx);
    const ig = ctx.externalAccountId;
    const now = new Date();
    const out: MetricResult[] = [];
    const acc = await graph<{ followers_count?: number; media_count?: number }>(`/${ig}`, { token, params: { fields: "followers_count,media_count" } });
    out.push({ scope: "account", subjectId: ig, metric: "followers", granularity: "lifetime", bucketTime: now, value: acc.followers_count ?? null, source: "native:graph/ig-user" });
    out.push({ scope: "account", subjectId: ig, metric: "posts", granularity: "lifetime", bucketTime: now, value: acc.media_count ?? null, source: "native:graph/ig-user" });
    try {
      const ins = await graph<{ data?: Array<{ name: string; values: Array<{ value: number; end_time: string }> }> }>(`/${ig}/insights`, { token, params: { metric: "reach,profile_views,accounts_engaged", period: "day", metric_type: "total_value", since: Math.floor(range.from.getTime() / 1000), until: Math.floor(range.to.getTime() / 1000) } });
      for (const m of ins.data ?? []) for (const v of m.values ?? []) out.push({ scope: "account", subjectId: ig, metric: m.name, granularity: "day", bucketTime: new Date(v.end_time), value: typeof v.value === "number" ? v.value : null, source: "native:graph/ig-insights" });
    } catch (err) {
      if (!(err instanceof ProviderError && (err.options.category === "permission" || err.options.category === "validation"))) throw err;
    }
    const media = await graph<{ data?: Array<{ id: string; media_type: string; timestamp: string; like_count?: number; comments_count?: number; permalink?: string }> }>(`/${ig}/media`, { token, params: { fields: "id,media_type,timestamp,like_count,comments_count,permalink", limit: 50 } });
    for (const m of media.data ?? []) {
      if (new Date(m.timestamp) < range.from) continue;
      out.push({ scope: "post", subjectId: m.id, metric: "likes", granularity: "lifetime", bucketTime: now, value: m.like_count ?? null, source: "native:graph/ig-media" });
      out.push({ scope: "post", subjectId: m.id, metric: "comments", granularity: "lifetime", bucketTime: now, value: m.comments_count ?? null, source: "native:graph/ig-media" });
      try {
        const metrics = m.media_type === "VIDEO" ? "reach,saved,shares,views" : "impressions,reach,saved,shares";
        const pi = await graph<{ data?: Array<{ name: string; values: Array<{ value: number }> }> }>(`/${m.id}/insights`, { token, params: { metric: metrics } });
        for (const x of pi.data ?? []) out.push({ scope: "post", subjectId: m.id, metric: x.name === "saved" ? "saves" : x.name, granularity: "lifetime", bucketTime: now, value: x.values[0]?.value ?? null, source: "native:graph/ig-media-insights" });
      } catch (err) {
        if (!(err instanceof ProviderError && (err.options.category === "permission" || err.options.category === "validation"))) throw err;
      }
    }
    return out;
  },
  async fetchComments(ctx, input) {
    const token = pageToken(ctx);
    const ig = ctx.externalAccountId;
    const ids: string[] = input.externalPostId ? [input.externalPostId] : ((await graph<{ data?: Array<{ id: string }> }>(`/${ig}/media`, { token, params: { fields: "id", limit: 25 } })).data ?? []).map((m) => m.id);
    const comments = [];
    for (const mid of ids) {
      const r = await graph<{ data?: Array<{ id: string; text?: string; timestamp: string; username?: string; from?: { id: string; username: string }; hidden?: boolean; replies?: { data?: Array<{ id: string; text?: string; timestamp: string; username?: string; from?: { id: string; username: string } }> } }> }>(`/${mid}/comments`, { token, params: { fields: "id,text,timestamp,username,from,hidden,replies{id,text,timestamp,username,from}", limit: 50 } });
      for (const c of r.data ?? []) {
        comments.push({ externalCommentId: c.id, externalPostId: mid, parentExternalId: null, authorId: c.from?.id ?? null, authorName: c.from?.username ?? c.username ?? null, body: c.text ?? "", isOwner: c.from?.id === ig, hidden: c.hidden ?? false, createdAt: new Date(c.timestamp) });
        for (const rp of c.replies?.data ?? []) comments.push({ externalCommentId: rp.id, externalPostId: mid, parentExternalId: c.id, authorId: rp.from?.id ?? null, authorName: rp.from?.username ?? rp.username ?? null, body: rp.text ?? "", isOwner: rp.from?.id === ig, createdAt: new Date(rp.timestamp) });
      }
    }
    return { comments, nextCursor: null };
  },
  async replyComment(ctx, input) {
    const r = await graph<{ id: string }>(`/${input.externalCommentId}/replies`, { method: "POST", token: pageToken(ctx), params: { message: input.body } });
    return { externalCommentId: r.id };
  },
};
