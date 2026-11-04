/**
 * Bluesky adapter (native, AT Protocol via @atproto/api).
 * Auth: app password (https://bsky.app/settings/app-passwords). The app password is stored encrypted.
 */
import { AtpAgent, RichText } from "@atproto/api";
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

const MAX_GRAPHEMES = 300;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1_000_000; // 1 MB per image blob
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const DEFAULT_SERVICE = "https://bsky.social";

interface BskyCreds {
  identifier: string;
  appPassword: string;
  service?: string;
}

function creds(ctx: AccountContext): BskyCreds {
  const { identifier, appPassword, service } = ctx.credentials as Partial<BskyCreds>;
  if (!identifier || !appPassword) throw new ProviderError("Missing Bluesky credentials.", { category: "auth_expired", retryable: false });
  return { identifier, appPassword, service: service ?? DEFAULT_SERVICE };
}

async function login(c: BskyCreds): Promise<AtpAgent> {
  const agent = new AtpAgent({ service: c.service ?? DEFAULT_SERVICE });
  try {
    await agent.login({ identifier: c.identifier, password: c.appPassword });
  } catch (err) {
    const e = err as { status?: number; message?: string; error?: string };
    if (e.status === 401) throw new ProviderError("Bluesky rejected the app password.", { category: "auth_expired", retryable: false, status: 401 });
    if (e.status === 429) throw new ProviderError("Bluesky rate limit hit.", { category: "rate_limited", retryable: true, retryAfterSeconds: 60 });
    throw new ProviderError(`Bluesky login failed: ${e.message ?? e.error ?? "unknown"}`, { category: "provider_error", retryable: true });
  }
  return agent;
}

function postUrl(handle: string, uri: string): string {
  const rkey = uri.split("/").pop();
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

export const blueskyDescriptor: ProviderDescriptor = {
  id: "bluesky",
  backend: "native",
  displayName: "Bluesky",
  connect: {
    kind: "credentials",
    fields: [
      { name: "identifier", label: "Handle or email", placeholder: "you.bsky.social" },
      { name: "appPassword", label: "App password", secret: true, help: "Create one at bsky.app → Settings → App passwords. Never use your main password." },
      { name: "service", label: "PDS service URL (optional)", placeholder: DEFAULT_SERVICE },
    ],
  },
  capabilities: {
    connect: "supported",
    publish_text: "supported",
    publish_image: "supported",
    publish_carousel: "supported", // up to 4 images in one post
    publish_video: "supported",
    publish_link: "supported",
    delete_post: "supported",
    edit_post: "unsupported",
    schedule_remote: "unsupported",
    read_analytics: "supported", // like/repost/reply counts from getPostThread
    read_comments: "supported", // replies
    reply_comment: "supported",
    read_dm: "not_tested",
    send_dm: "not_tested",
    ads_read: "unsupported",
    ads_write: "unsupported",
  },
  limits: {
    maxTextLength: MAX_GRAPHEMES,
    maxImages: MAX_IMAGES,
    maxImageBytes: MAX_IMAGE_BYTES,
    maxVideoBytes: MAX_VIDEO_BYTES,
    maxVideoSeconds: 180,
    imageMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    videoMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
  },
  implementationStatus: "CODE_COMPLETE_NEEDS_CREDENTIALS",
  docsUrl: "https://docs.bsky.app/",
};

export const blueskyAdapter: SocialAdapter = {
  descriptor: blueskyDescriptor,

  async discoverCapabilities(): Promise<CapabilityMap> {
    return { ...blueskyDescriptor.capabilities };
  },

  async connectWithCredentials(input): Promise<ConnectResult> {
    const identifier = (input.identifier ?? "").trim().replace(/^@/, "");
    const appPassword = (input.appPassword ?? "").trim();
    const service = (input.service ?? "").trim() || DEFAULT_SERVICE;
    if (!identifier || !appPassword) throw new ProviderError("Handle and app password are required.", { category: "validation", retryable: false });
    const agent = await login({ identifier, appPassword, service });
    const did = agent.session?.did;
    const handle = agent.session?.handle ?? identifier;
    if (!did) throw new ProviderError("Bluesky did not return a DID.", { category: "provider_error", retryable: true });
    const profile = await agent.getProfile({ actor: did });
    return {
      accounts: [
        {
          externalAccountId: did,
          accountType: "profile",
          displayName: profile.data.displayName || handle,
          username: handle,
          profileUrl: `https://bsky.app/profile/${handle}`,
          avatarUrl: profile.data.avatar,
          metadata: { service },
        },
      ],
      credentials: { identifier, appPassword, service },
      expiresAt: null,
    };
  },

  async verifyConnection(ctx): Promise<HealthResult> {
    try {
      const agent = await login(creds(ctx));
      return { ok: true, status: "healthy", message: `Logged in as @${agent.session?.handle}` };
    } catch (err) {
      return { ok: false, status: "error", message: (err as Error).message };
    }
  },

  async validatePost(_ctx, target): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const text = target.body + (target.link ? `\n${target.link}` : "");
    const rt = new RichText({ text });
    if (rt.graphemeLength > MAX_GRAPHEMES) issues.push({ level: "error", code: "too_long", message: `Bluesky posts are limited to ${MAX_GRAPHEMES} characters (you have ${rt.graphemeLength}).` });
    const images = target.media.filter((m) => m.mimeType.startsWith("image/"));
    const videos = target.media.filter((m) => m.mimeType.startsWith("video/"));
    const others = target.media.filter((m) => !m.mimeType.startsWith("image/") && !m.mimeType.startsWith("video/"));
    if (others.length) issues.push({ level: "error", code: "unsupported_media", message: "Only images and video are supported on Bluesky." });
    if (images.length > MAX_IMAGES) issues.push({ level: "error", code: "too_many_images", message: `At most ${MAX_IMAGES} images per post.` });
    if (videos.length > 1 || (videos.length && images.length)) issues.push({ level: "error", code: "mixed_media", message: "One video per post, without images." });
    for (const m of images) if (m.sizeBytes > MAX_IMAGE_BYTES) issues.push({ level: "error", code: "image_too_big", message: `${m.filename}: Bluesky image blobs must be ≤ 1 MB (resize or compress).` });
    for (const m of videos) if (m.sizeBytes > MAX_VIDEO_BYTES) issues.push({ level: "error", code: "video_too_big", message: `${m.filename}: videos must be ≤ 50 MB.` });
    if (!text.trim() && target.media.length === 0) issues.push({ level: "error", code: "empty", message: "Post is empty." });
    return { ok: !issues.some((i) => i.level === "error"), issues, format: videos.length ? "video" : images.length > 1 ? "carousel" : images.length ? "image" : "text" };
  },

  async publish(ctx, target): Promise<PublishResult> {
    const c = creds(ctx);
    const agent = await login(c);
    const text = target.body + (target.link ? `\n${target.link}` : "");
    const rt = new RichText({ text });
    await rt.detectFacets(agent);
    const langs = Array.isArray(target.overrides.langs) ? (target.overrides.langs as string[]) : ["it"];

    let embed: Record<string, unknown> | undefined;
    const images = target.media.filter((m) => m.mimeType.startsWith("image/"));
    const video = target.media.find((m) => m.mimeType.startsWith("video/"));
    if (images.length) {
      const uploaded = [];
      for (const img of images) {
        const bytes = await img.read();
        const res = await agent.uploadBlob(new Uint8Array(bytes), { encoding: img.mimeType });
        uploaded.push({
          image: res.data.blob,
          alt: img.altText ?? "",
          aspectRatio: img.width && img.height ? { width: img.width, height: img.height } : undefined,
        });
      }
      embed = { $type: "app.bsky.embed.images", images: uploaded };
    } else if (video) {
      const bytes = await video.read();
      const res = await agent.uploadBlob(new Uint8Array(bytes), { encoding: video.mimeType });
      embed = { $type: "app.bsky.embed.video", video: res.data.blob, alt: video.altText ?? "" };
    }

    try {
      const res = await agent.post({ text: rt.text, facets: rt.facets, langs, embed: embed as never, createdAt: new Date().toISOString() });
      const handle = agent.session?.handle ?? c.identifier;
      return { status: "published", remotePostId: res.uri, remoteUrl: postUrl(handle, res.uri), raw: { cid: res.cid } };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e.status === 429) throw new ProviderError("Bluesky rate limit.", { category: "rate_limited", retryable: true, retryAfterSeconds: 60 });
      throw new ProviderError(`Bluesky publish failed: ${e.message ?? "unknown"}`, { category: "provider_error", retryable: (e.status ?? 500) >= 500 });
    }
  },

  async getPublishStatus(ctx, remotePostId): Promise<PublishStatus> {
    const agent = await login(creds(ctx));
    try {
      const res = await agent.getPosts({ uris: [remotePostId] });
      const post = res.data.posts[0];
      if (!post) return { status: "deleted" };
      const handle = post.author.handle;
      return { status: "published", remoteUrl: postUrl(handle, post.uri) };
    } catch (err) {
      return { status: "unknown", error: (err as Error).message };
    }
  },

  async deletePost(ctx, remotePostId): Promise<void> {
    const agent = await login(creds(ctx));
    await agent.deletePost(remotePostId);
  },

  async fetchMetrics(ctx, _range: DateRange): Promise<MetricResult[]> {
    const agent = await login(creds(ctx));
    const did = agent.session?.did ?? ctx.externalAccountId;
    const now = new Date();
    const out: MetricResult[] = [];
    const profile = await agent.getProfile({ actor: did });
    const src = "native:app.bsky.actor.getProfile";
    out.push({ scope: "account", subjectId: did, metric: "followers", granularity: "lifetime", bucketTime: now, value: profile.data.followersCount ?? null, source: src });
    out.push({ scope: "account", subjectId: did, metric: "following", granularity: "lifetime", bucketTime: now, value: profile.data.followsCount ?? null, source: src });
    out.push({ scope: "account", subjectId: did, metric: "posts", granularity: "lifetime", bucketTime: now, value: profile.data.postsCount ?? null, source: src });
    const feed = await agent.getAuthorFeed({ actor: did, limit: 50, filter: "posts_no_replies" });
    const psrc = "native:app.bsky.feed.getAuthorFeed";
    for (const item of feed.data.feed) {
      const p = item.post;
      out.push({ scope: "post", subjectId: p.uri, metric: "likes", granularity: "lifetime", bucketTime: now, value: p.likeCount ?? null, source: psrc });
      out.push({ scope: "post", subjectId: p.uri, metric: "reposts", granularity: "lifetime", bucketTime: now, value: p.repostCount ?? null, source: psrc });
      out.push({ scope: "post", subjectId: p.uri, metric: "replies", granularity: "lifetime", bucketTime: now, value: p.replyCount ?? null, source: psrc });
      out.push({ scope: "post", subjectId: p.uri, metric: "quotes", granularity: "lifetime", bucketTime: now, value: p.quoteCount ?? null, source: psrc });
    }
    return out;
  },

  async fetchComments(ctx, input) {
    if (!input.externalPostId) return { comments: [], nextCursor: null };
    const agent = await login(creds(ctx));
    const thread = await agent.getPostThread({ uri: input.externalPostId, depth: 1 });
    const node = thread.data.thread as { replies?: Array<{ post?: { uri: string; author: { did: string; handle: string; displayName?: string }; record: { text?: string }; indexedAt: string } }> };
    const comments = (node.replies ?? [])
      .filter((r) => r.post)
      .map((r) => ({
        externalCommentId: r.post!.uri,
        externalPostId: input.externalPostId!,
        authorId: r.post!.author.did,
        authorName: r.post!.author.displayName || r.post!.author.handle,
        body: r.post!.record.text ?? "",
        isOwner: r.post!.author.did === ctx.externalAccountId,
        createdAt: new Date(r.post!.indexedAt),
      }));
    return { comments, nextCursor: null };
  },

  async replyComment(ctx, input) {
    const agent = await login(creds(ctx));
    const posts = await agent.getPosts({ uris: [input.externalCommentId, input.externalPostId] });
    const parent = posts.data.posts.find((p) => p.uri === input.externalCommentId);
    const root = posts.data.posts.find((p) => p.uri === input.externalPostId);
    if (!parent || !root) throw new ProviderError("Comment or post not found on Bluesky.", { category: "not_found", retryable: false });
    const rt = new RichText({ text: input.body });
    await rt.detectFacets(agent);
    const res = await agent.post({ text: rt.text, facets: rt.facets, reply: { root: { uri: root.uri, cid: root.cid }, parent: { uri: parent.uri, cid: parent.cid } } });
    return { externalCommentId: res.uri };
  },
};
