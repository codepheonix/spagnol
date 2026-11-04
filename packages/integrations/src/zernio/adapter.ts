/**
 * Zernio gateway adapter: one SocialAdapter per platform, all backed by the Zernio unified API.
 * Account credentials are NOT stored per account (the API key is gateway-level); the local
 * credentials blob only records the Zernio account/profile ids.
 */
import { ZernioClient, type ZernioPlatform, type ZernioPost, type ZernioMediaItem } from "./client";
import {
  type AccountContext,
  type CapabilityMap,
  type ConnectResult,
  type DateRange,
  type HealthResult,
  type MetricResult,
  type ProviderDescriptor,
  type ProviderId,
  type PublishResult,
  type PublishStatus,
  type SocialAdapter,
  type TargetPost,
  type ValidationIssue,
  type ValidationResult,
  ProviderError,
} from "../contract";

export const ZERNIO_PLATFORM_MAP: Record<ProviderId, ZernioPlatform> = {
  telegram: "telegram",
  bluesky: "bluesky",
  discord: "discord",
  slack: "slack",
  facebook: "facebook",
  instagram: "instagram",
  threads: "threads",
  youtube: "youtube",
  linkedin: "linkedin",
  pinterest: "pinterest",
  reddit: "reddit",
  tiktok: "tiktok",
  x: "twitter",
  googlebusiness: "googlebusiness",
  whatsapp: "whatsapp",
  snapchat: "snapchat",
};

/** Capability matrix per platform as documented by Zernio (docs.zernio.com/platforms), Nov 2026. */
const ZERNIO_CAPS: Record<ZernioPlatform, CapabilityMap> = {
  facebook: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", publish_story: "supported", publish_short: "supported", publish_link: "supported", schedule_remote: "supported", first_comment: "supported", delete_post: "supported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", hide_comment: "supported", read_dm: "supported", send_dm: "supported", ads_read: "supported", ads_write: "supported" },
  instagram: { connect: "supported", publish_text: "unsupported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", publish_story: "supported", publish_short: "supported", schedule_remote: "supported", first_comment: "supported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", hide_comment: "supported", read_dm: "supported", send_dm: "supported", ads_read: "supported", ads_write: "supported" },
  threads: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", schedule_remote: "supported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", read_dm: "unsupported", send_dm: "unsupported" },
  youtube: { connect: "supported", publish_video: "supported", publish_short: "supported", schedule_remote: "supported", first_comment: "supported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", read_dm: "unsupported", send_dm: "unsupported" },
  linkedin: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", publish_document: "supported", publish_link: "supported", schedule_remote: "supported", first_comment: "supported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", ads_read: "supported", ads_write: "supported" },
  tiktok: { connect: "supported", publish_video: "supported", publish_carousel: "supported", schedule_remote: "supported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", read_dm: "blocked_by_region", send_dm: "blocked_by_region", ads_read: "supported", ads_write: "supported" },
  pinterest: { connect: "supported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", publish_link: "supported", schedule_remote: "supported", read_analytics: "supported", read_comments: "unsupported", read_dm: "unsupported", send_dm: "unsupported", ads_read: "supported", ads_write: "supported" },
  reddit: { connect: "needs_approval", publish_text: "needs_approval", publish_image: "needs_approval", publish_link: "needs_approval", schedule_remote: "needs_approval" },
  twitter: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", schedule_remote: "supported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", read_dm: "supported", send_dm: "supported", ads_read: "supported", ads_write: "supported" },
  bluesky: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", schedule_remote: "supported", read_analytics: "supported", read_comments: "supported", reply_comment: "supported", read_dm: "supported", send_dm: "supported" },
  googlebusiness: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_link: "supported", schedule_remote: "supported", read_analytics: "supported", read_reviews: "supported", reply_review: "supported" },
  telegram: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", publish_document: "supported", schedule_remote: "supported", read_dm: "supported", send_dm: "supported" },
  snapchat: { connect: "needs_approval", publish_video: "needs_approval", publish_story: "needs_approval", read_dm: "unsupported", send_dm: "unsupported" },
  discord: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_document: "supported", schedule_remote: "supported" },
  slack: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_document: "supported", schedule_remote: "supported" },
  whatsapp: { connect: "supported", read_dm: "supported", send_dm: "supported" },
};

const DISPLAY: Record<ZernioPlatform, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram (professional)",
  threads: "Threads",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  reddit: "Reddit",
  twitter: "X (Twitter)",
  bluesky: "Bluesky",
  googlebusiness: "Google Business Profile",
  telegram: "Telegram",
  snapchat: "Snapchat",
  discord: "Discord",
  slack: "Slack",
  whatsapp: "WhatsApp Business",
};

function client(ctx: AccountContext): ZernioClient {
  if (!ctx.gateway?.apiKey) throw new ProviderError("Zernio API key is not configured (Settings → Zernio).", { category: "auth_expired", retryable: false });
  return new ZernioClient(ctx.gateway.apiKey, ctx.gateway.baseUrl);
}

function gatewayAccountId(ctx: AccountContext): string {
  const id = ctx.gateway?.accountId ?? (ctx.credentials.zernioAccountId as string | undefined);
  if (!id) throw new ProviderError("Missing Zernio account id for this connection.", { category: "not_found", retryable: false });
  return id;
}

function mapStatus(p: { status: string }): PublishStatus["status"] {
  switch (p.status) {
    case "published":
      return "published";
    case "failed":
      return "failed";
    case "scheduled":
    case "publishing":
    case "pending_approval":
    case "draft":
      return "processing";
    case "cancelled":
      return "deleted";
    default:
      return "unknown";
  }
}

function mediaType(mime: string): ZernioMediaItem["type"] {
  if (mime === "image/gif") return "gif";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

function validateForPlatform(platform: ZernioPlatform, target: TargetPost): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const images = target.media.filter((m) => m.mimeType.startsWith("image/"));
  const videos = target.media.filter((m) => m.mimeType.startsWith("video/"));
  const text = target.body;
  const contentType = target.overrides.contentType as string | undefined;
  if (platform === "instagram") {
    if (target.media.length === 0) issues.push({ level: "error", code: "media_required", message: "Instagram requires at least one image or video." });
    if (images.length > 10) issues.push({ level: "error", code: "too_many_images", message: "Instagram carousels hold at most 10 items." });
    if (text.length > 2200) issues.push({ level: "error", code: "too_long", message: "Instagram captions are limited to 2,200 characters." });
    for (const v of videos) if (v.sizeBytes > 300 * 1024 * 1024) issues.push({ level: "error", code: "video_too_big", message: `${v.filename}: Reels must be ≤ 300 MB.` });
    for (const i of images) if (i.sizeBytes > 8 * 1024 * 1024) issues.push({ level: "error", code: "image_too_big", message: `${i.filename}: images must be ≤ 8 MB.` });
    if (contentType === "story" && target.media.length !== 1) issues.push({ level: "error", code: "story_single", message: "A story takes exactly one image or video." });
  }
  if (platform === "facebook") {
    if (text.length > 63_206) issues.push({ level: "error", code: "too_long", message: "Facebook post exceeds 63,206 characters." });
    if (!text.trim() && target.media.length === 0 && !target.link) issues.push({ level: "error", code: "empty", message: "Post is empty." });
    if (contentType === "reel" && videos.length !== 1) issues.push({ level: "error", code: "reel_video", message: "A Facebook Reel needs exactly one video." });
  }
  if (platform === "twitter" && text.length > 280 && !target.overrides.longPost) issues.push({ level: "warning", code: "x_length", message: "Over 280 characters: only X Premium accounts can post longer text." });
  if (platform === "linkedin" && text.length > 3000) issues.push({ level: "error", code: "too_long", message: "LinkedIn posts are limited to 3,000 characters." });
  if (platform === "threads" && text.length > 500) issues.push({ level: "error", code: "too_long", message: "Threads posts are limited to 500 characters." });
  if (platform === "bluesky" && text.length > 300) issues.push({ level: "error", code: "too_long", message: "Bluesky posts are limited to 300 characters." });
  if (platform === "pinterest" && images.length + videos.length === 0) issues.push({ level: "error", code: "media_required", message: "A Pin needs an image or video." });
  if (platform === "pinterest" && !target.overrides.boardId) issues.push({ level: "error", code: "board_required", message: "Choose a Pinterest board (overrides.boardId)." });
  if ((platform === "youtube" || platform === "tiktok") && videos.length !== 1 && !(platform === "tiktok" && images.length > 0)) issues.push({ level: "error", code: "video_required", message: `${DISPLAY[platform]} needs one video.` });
  if (platform === "youtube" && !target.title && !target.overrides.title) issues.push({ level: "error", code: "title_required", message: "YouTube requires a title." });
  if (platform === "reddit" && !target.overrides.subreddit) issues.push({ level: "error", code: "subreddit_required", message: "Reddit requires a subreddit." });
  if (platform === "whatsapp") issues.push({ level: "error", code: "unsupported", message: "WhatsApp is a messaging channel, not a publishing target." });
  return issues;
}

export function makeZernioAdapter(provider: ProviderId): SocialAdapter {
  const platform = ZERNIO_PLATFORM_MAP[provider];
  const descriptor: ProviderDescriptor = {
    id: provider,
    backend: "zernio",
    displayName: `${DISPLAY[platform]} via Zernio`,
    connect: { kind: "gateway", notes: "Hosted OAuth through Zernio (uses your Zernio API key; Zernio's own developer apps, no separate app review needed)." },
    capabilities: ZERNIO_CAPS[platform],
    limits: {},
    implementationStatus: platform === "reddit" || platform === "snapchat" ? "AWAITING_PLATFORM_APPROVAL" : "CODE_COMPLETE_NEEDS_CREDENTIALS",
    docsUrl: "https://docs.zernio.com/platforms",
    requiredEnv: [],
  };

  return {
    descriptor,

    async discoverCapabilities(ctx): Promise<CapabilityMap> {
      const caps: CapabilityMap = { ...descriptor.capabilities };
      try {
        const health = await client(ctx).accountHealth(gatewayAccountId(ctx));
        if (health.permissions?.canPost === false) {
          for (const c of ["publish_text", "publish_image", "publish_video", "publish_carousel", "publish_story", "publish_short", "publish_link", "publish_document"] as const)
            if (caps[c] === "supported") caps[c] = "needs_approval";
        }
        if (health.permissions?.canFetchAnalytics === false && caps.read_analytics === "supported") caps.read_analytics = "needs_approval";
      } catch {
        /* keep static matrix */
      }
      return caps;
    },

    async buildAuthorizationUrl(input) {
      // The gateway key and profile are injected through `extra` by the connection service.
      const apiKey = input.extra?.apiKey;
      const profileId = input.extra?.profileId;
      if (!apiKey || !profileId) throw new ProviderError("Zernio API key / profile missing.", { category: "auth_expired", retryable: false });
      const c = new ZernioClient(apiKey, input.extra?.baseUrl);
      const redirect = new URL(input.redirectUri);
      redirect.searchParams.set("state", input.state);
      const { authUrl } = await c.getConnectUrl(platform, {
        profileId,
        redirect_url: redirect.toString(),
        loginMethod: provider === "instagram" ? ((input.extra?.loginMethod as "instagram_login" | "facebook_login") ?? "facebook_login") : undefined,
        scopes: input.extra?.scopes,
      });
      return authUrl;
    },

    async exchangeAuthorizationCode(input): Promise<ConnectResult> {
      // Standard (non-headless) Zernio flow: the account is already connected on the Zernio profile when
      // we land here. We discover it through the API rather than trusting the redirect parameters.
      const apiKey = input.callbackParams.__apiKey;
      const profileId = input.callbackParams.__profileId;
      if (!apiKey || !profileId) throw new ProviderError("Zernio API key / profile missing.", { category: "auth_expired", retryable: false });
      if (input.callbackParams.error) {
        throw new ProviderError(`Zernio connect failed: ${input.callbackParams.error_message ?? input.callbackParams.error}`, { category: "permission", retryable: false });
      }
      const c = new ZernioClient(apiKey, input.callbackParams.__baseUrl);
      const { accounts } = await c.listAccounts({ profileId, platform });
      const wanted = new Set((input.callbackParams.accountIds ?? input.callbackParams.accountId ?? "").split(",").filter(Boolean));
      const picked = wanted.size ? accounts.filter((a) => wanted.has(a._id)) : accounts.filter((a) => a.isActive);
      if (!picked.length) throw new ProviderError("No connected account was returned by Zernio for this platform.", { category: "not_found", retryable: false });
      const perAccountCredentials: Record<string, Record<string, unknown>> = {};
      const result: ConnectResult = {
        accounts: picked.map((a) => {
          const externalAccountId = a.platformUserId || a._id;
          perAccountCredentials[externalAccountId] = { zernioAccountId: a._id, zernioProfileId: profileId };
          return {
            externalAccountId,
            accountType: (a.metadata?.accountType as string | undefined) ?? platform,
            displayName: a.displayName || a.username || externalAccountId,
            username: a.username,
            profileUrl: a.profileUrl,
            avatarUrl: a.profilePicture ?? undefined,
            scopes: a.scopeAreas ?? [],
            metadata: { zernioAccountId: a._id, zernioProfileId: profileId, needsReconnection: a.needsReconnection ?? false },
          };
        }),
        credentials: { zernioProfileId: profileId },
        perAccountCredentials,
        expiresAt: null,
      };
      return result;
    },

    async verifyConnection(ctx): Promise<HealthResult> {
      try {
        const h = await client(ctx).accountHealth(gatewayAccountId(ctx));
        return {
          ok: h.status !== "error",
          status: h.status,
          message: [...(h.issues ?? []), ...(h.recommendations ?? [])].join(" ") || undefined,
          expiresAt: h.tokenStatus?.expiresAt ? new Date(h.tokenStatus.expiresAt) : null,
          details: { permissions: h.permissions, tokenValid: h.tokenStatus?.valid },
        };
      } catch (err) {
        return { ok: false, status: "error", message: (err as Error).message };
      }
    },

    async revoke(ctx) {
      await client(ctx).disconnectAccount(gatewayAccountId(ctx));
    },

    async validatePost(_ctx, target): Promise<ValidationResult> {
      const issues = validateForPlatform(platform, target);
      return { ok: !issues.some((i) => i.level === "error"), issues, format: target.media.some((m) => m.mimeType.startsWith("video/")) ? "video" : target.media.length > 1 ? "carousel" : target.media.length ? "image" : "text" };
    },

    async publish(ctx, target, idempotencyKey): Promise<PublishResult> {
      const c = client(ctx);
      const accountId = gatewayAccountId(ctx);
      const mediaItems: ZernioMediaItem[] = [];
      for (const m of target.media) {
        const url = await c.uploadBytes(m.filename, m.mimeType, await m.read());
        mediaItems.push({ type: mediaType(m.mimeType), url, altText: m.altText ?? undefined, filename: m.filename, size: m.sizeBytes, mimeType: m.mimeType });
      }
      const content = target.body + (target.link && platform !== "pinterest" ? `\n${target.link}` : "");
      const psd: Record<string, unknown> = { ...(target.overrides.platformSpecificData as Record<string, unknown> | undefined) };
      if (target.overrides.contentType) psd.contentType = target.overrides.contentType;
      if (target.overrides.firstComment) psd.firstComment = target.overrides.firstComment;
      if (platform === "youtube") {
        psd.title = target.overrides.title ?? target.title;
        psd.visibility = target.overrides.visibility ?? "public";
        psd.madeForKids = target.overrides.madeForKids ?? false;
      }
      if (platform === "pinterest") {
        psd.boardId = target.overrides.boardId;
        psd.title = target.overrides.title ?? target.title;
        if (target.link) psd.link = target.link;
      }
      if (platform === "reddit") {
        psd.subreddit = target.overrides.subreddit;
        psd.title = target.overrides.title ?? target.title;
      }
      if (platform === "tiktok") {
        psd.privacyLevel = target.overrides.privacyLevel ?? "PUBLIC_TO_EVERYONE";
        psd.allowComment = target.overrides.allowComment ?? true;
        psd.contentPreviewConfirmed = true;
        psd.expressConsentGiven = true;
      }
      const schedule = target.scheduledAt && target.scheduledAt.getTime() > Date.now() + 60_000;
      const res = await c.createPost(
        {
          content: content || undefined,
          title: target.title ?? undefined,
          mediaItems: mediaItems.length ? mediaItems : undefined,
          platforms: [{ platform, accountId, platformSpecificData: Object.keys(psd).length ? psd : undefined }],
          publishNow: !schedule,
          scheduledFor: schedule ? target.scheduledAt!.toISOString() : undefined,
          timezone: target.timezone ?? undefined,
          tags: [`sm:${target.postId}`],
        },
        idempotencyKey,
      );
      const post = res.post;
      if (!post) throw new ProviderError(`Zernio did not return a post (${res.message ?? "unknown"}).`, { category: "provider_error", retryable: true });
      const pr = post.platforms.find((p) => (typeof p.accountId === "string" ? p.accountId : p.accountId?._id) === accountId) ?? post.platforms[0];
      if (pr?.status === "failed") {
        throw new ProviderError(`Zernio reported failure: ${pr.errorMessage ?? "unknown"}`, {
          category: pr.errorCategory === "auth_expired" ? "auth_expired" : pr.errorCategory === "platform_rate_limit" ? "rate_limited" : "provider_error",
          retryable: pr.errorCategory === "platform_rate_limit" || pr.errorCategory === "platform_error" || pr.errorCategory === "system_error",
          providerCode: pr.errorCategory,
        });
      }
      const published = pr?.status === "published";
      return {
        status: published ? "published" : schedule ? "scheduled_remote" : "processing",
        // Remote id = Zernio post id; the platform post id is kept in raw until reconciled.
        remotePostId: post._id,
        remoteUrl: pr?.platformPostUrl ?? null,
        raw: { platformPostId: pr?.platformPostId, zernioStatus: post.status, warnings: res.warnings },
      };
    },

    async getPublishStatus(ctx, remotePostId): Promise<PublishStatus> {
      const c = client(ctx);
      const accountId = gatewayAccountId(ctx);
      let post: ZernioPost;
      try {
        post = (await c.getPost(remotePostId)).post;
      } catch (err) {
        if (err instanceof ProviderError && err.options.category === "not_found") return { status: "deleted" };
        return { status: "unknown", error: (err as Error).message };
      }
      const pr = post.platforms.find((p) => (typeof p.accountId === "string" ? p.accountId : p.accountId?._id) === accountId) ?? post.platforms[0];
      if (!pr) return { status: "unknown" };
      return { status: mapStatus(pr), remoteUrl: pr.platformPostUrl ?? null, error: pr.errorMessage ?? null, errorCategory: pr.errorCategory ?? null };
    },

    async deletePost(ctx, remotePostId) {
      const c = client(ctx);
      const { post } = await c.getPost(remotePostId);
      if (post.status === "published" || post.status === "partial") await c.unpublishPost(remotePostId, { accountId: gatewayAccountId(ctx) });
      else await c.deletePost(remotePostId);
    },

    async fetchMetrics(ctx, range: DateRange): Promise<MetricResult[]> {
      const c = client(ctx);
      const accountId = gatewayAccountId(ctx);
      const out: MetricResult[] = [];
      const now = new Date();
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      try {
        const fs = await c.followerStats({ accountIds: accountId, fromDate: fmt(range.from), toDate: fmt(range.to), granularity: "daily" });
        const acc = fs.accounts.find((a) => a._id === accountId);
        if (acc) {
          out.push({ scope: "account", subjectId: ctx.externalAccountId, metric: "followers", granularity: "lifetime", bucketTime: now, value: acc.currentFollowers ?? acc.followersCount ?? null, source: "zernio:/v1/accounts/follower-stats", providerUpdatedAt: acc.lastUpdated ? new Date(acc.lastUpdated) : null });
          out.push({ scope: "account", subjectId: ctx.externalAccountId, metric: "followers_growth", granularity: "lifetime", bucketTime: now, value: acc.growth ?? null, source: "zernio:/v1/accounts/follower-stats" });
        }
      } catch (err) {
        if (!(err instanceof ProviderError && (err.options.status === 402 || err.options.status === 403))) throw err;
        // analytics add-on not enabled → unsupported, represented as absence (never zero)
      }
      const res = (await c.getAnalytics({ accountId, fromDate: fmt(range.from), toDate: fmt(range.to), limit: 100 })) as { posts?: Array<{ postId: string; latePostId?: string | null; platformAnalytics?: Array<{ platformPostId?: string | null; accountId: string; analytics?: Record<string, number | null> | null }>; analytics?: Record<string, number | null> | null }> };
      const metrics = ["impressions", "reach", "likes", "comments", "shares", "saves", "clicks", "views", "follows", "profileViews", "websiteClicks", "engagementRate"];
      for (const p of res.posts ?? []) {
        const pa = p.platformAnalytics?.find((x) => x.accountId === accountId);
        const data = pa?.analytics ?? null;
        const subject = pa?.platformPostId ?? p.postId;
        if (!data) continue;
        for (const m of metrics) {
          if (!(m in data)) continue; // absent = unsupported for this platform
          out.push({ scope: "post", subjectId: subject, metric: m, granularity: "lifetime", bucketTime: now, value: typeof data[m] === "number" ? (data[m] as number) : null, source: "zernio:/v1/analytics" });
        }
      }
      return out;
    },

    async fetchComments(ctx, input) {
      const c = client(ctx);
      const accountId = gatewayAccountId(ctx);
      if (!input.externalPostId) {
        // list recently commented posts, then their comments (first page each)
        const list = await c.listCommentedPosts({ accountId, limit: 20, cursor: input.cursor ?? undefined });
        const comments = [];
        for (const p of list.data) {
          if (!p.commentCount) continue;
          const page = await c.getComments(p.id, { accountId, limit: 50 });
          for (const cm of page.comments) comments.push(toComment(p.id, cm));
        }
        return { comments, nextCursor: list.pagination?.hasMore ? list.pagination.nextCursor : null };
      }
      const page = await c.getComments(input.externalPostId, { accountId, limit: 50, cursor: input.cursor ?? undefined });
      return { comments: page.comments.map((cm) => toComment(input.externalPostId!, cm)), nextCursor: page.pagination?.hasMore ? (page.pagination.cursor ?? null) : null };
    },

    async replyComment(ctx, input) {
      const res = await client(ctx).replyComment(input.externalPostId, { accountId: gatewayAccountId(ctx), message: input.body, commentId: input.externalCommentId }, `reply:${input.externalCommentId}:${Date.now()}`);
      return { externalCommentId: res.data.commentId };
    },

    async fetchInbox(ctx, cursor) {
      const c = client(ctx);
      const accountId = gatewayAccountId(ctx);
      const list = await c.listConversations({ accountId, limit: 50, cursor: cursor ?? undefined });
      const threads = [];
      for (const conv of list.data) {
        const msgs = await c.listMessages(conv.id, { accountId, limit: 100, sortOrder: "asc" });
        threads.push({
          externalThreadId: conv.id,
          participantId: conv.participantId ?? null,
          participantName: conv.participantName ?? null,
          participantUrl: conv.url ?? null,
          lastMessageAt: conv.updatedTime ? new Date(conv.updatedTime) : null,
          lastMessageText: conv.lastMessage ?? null,
          unreadCount: conv.unreadCount ?? null,
          messages: msgs.messages.map((m) => ({
            externalMessageId: m.id,
            direction: m.direction === "incoming" ? ("inbound" as const) : ("outbound" as const),
            body: m.message ?? null,
            attachments: m.attachments ?? [],
            senderName: m.senderName ?? null,
            sentAt: new Date(m.createdAt),
            metadata: { deliveryStatus: m.deliveryStatus },
          })),
        });
      }
      return { threads, nextCursor: list.pagination?.hasMore ? (list.pagination.nextCursor ?? null) : null };
    },

    async sendMessage(ctx, input) {
      const res = await client(ctx).sendMessage(input.externalThreadId, { accountId: gatewayAccountId(ctx), message: input.body }, `dm:${input.externalThreadId}:${Date.now()}`);
      return { externalMessageId: res.data.messageId };
    },
  };
}

function toComment(postId: string, cm: { id: string; message: string; createdTime: string; from?: { id?: string; name?: string; username?: string; isOwner?: boolean }; parentId?: string | null; isHidden?: boolean; url?: string | null }) {
  return {
    externalCommentId: cm.id,
    externalPostId: postId,
    parentExternalId: cm.parentId ?? null,
    authorId: cm.from?.id ?? null,
    authorName: cm.from?.name ?? cm.from?.username ?? null,
    body: cm.message,
    isOwner: cm.from?.isOwner ?? false,
    hidden: cm.isHidden ?? false,
    createdAt: new Date(cm.createdTime),
    metadata: { url: cm.url ?? null },
  };
}
