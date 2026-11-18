/**
 * Bluesky adapter (native). Talks to the AT Protocol's HTTP API (XRPC) directly with `fetch`:
 * no SDK, so no third-party schema library sits between a remote server's answer and this process.
 * Auth: app password (https://bsky.app/settings/app-passwords), stored encrypted.
 *
 * The optional server URL is user-supplied, so every call goes through `assertPublicHttpsUrl`
 * (https, public host only), refuses redirects, times out, and caps the size of what it reads.
 */
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
  type ValidationIssue,
  type ValidationResult,
  ProviderError,
} from "../contract";
import { assertPublicHttpsUrl, readLimited } from "../net";

const MAX_GRAPHEMES = 300;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1_000_000; // 1 MB per image blob
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const DEFAULT_SERVICE = "https://bsky.social";
const MAX_ANSWER_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

interface BskyCreds {
  identifier: string;
  appPassword: string;
  service?: string;
}
interface Agent {
  origin: string;
  did: string;
  handle: string;
  accessJwt: string;
}
interface Blob { $type: "blob"; ref: { $link: string }; mimeType: string; size: number }
interface PostView { uri: string; cid: string; author: { did: string; handle: string; displayName?: string }; record: { text?: string }; indexedAt: string; likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number }

function creds(ctx: AccountContext): BskyCreds {
  const { identifier, appPassword, service } = ctx.credentials as Partial<BskyCreds>;
  if (!identifier || !appPassword) throw new ProviderError("Missing Bluesky credentials.", { category: "auth_expired", retryable: false });
  return { identifier, appPassword, service: service ?? DEFAULT_SERVICE };
}

/** One XRPC call. `origin` has already passed the public-address check. */
async function xrpc<T>(origin: string, method: "GET" | "POST", nsid: string, opts: { token?: string; query?: Record<string, string | number | string[]>; json?: unknown; bytes?: Uint8Array; contentType?: string } = {}): Promise<T> {
  const url = new URL(`/xrpc/${nsid}`, origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) for (const one of Array.isArray(v) ? v : [String(v)]) url.searchParams.append(k, one);
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.bytes) {
    headers["content-type"] = opts.contentType ?? "application/octet-stream";
    body = opts.bytes as unknown as BodyInit;
  } else if (opts.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ProviderError(`Bluesky could not be reached: ${(err as Error).name === "TimeoutError" ? "timed out" : "network error"}.`, { category: "provider_error", retryable: true });
  }
  const text = new TextDecoder().decode(await readLimited(res, MAX_ANSWER_BYTES));
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; message?: string };
    const why = (e.message ?? e.error ?? `HTTP ${res.status}`).slice(0, 200);
    if (res.status === 401 || e.error === "ExpiredToken" || e.error === "AuthenticationRequired") throw new ProviderError("Bluesky rejected the app password.", { category: "auth_expired", retryable: false, status: 401 });
    if (res.status === 429) throw new ProviderError("Bluesky rate limit hit.", { category: "rate_limited", retryable: true, status: 429, retryAfterSeconds: Number(res.headers.get("retry-after")) || 60 });
    throw new ProviderError(`Bluesky answered: ${why}`, { category: res.status === 404 ? "not_found" : res.status < 500 ? "validation" : "provider_error", retryable: res.status >= 500, status: res.status });
  }
  return data as T;
}

async function login(c: BskyCreds): Promise<Agent> {
  const origin = (await assertPublicHttpsUrl(c.service ?? DEFAULT_SERVICE)).origin;
  const s = await xrpc<{ accessJwt?: string; did?: string; handle?: string }>(origin, "POST", "com.atproto.server.createSession", { json: { identifier: c.identifier, password: c.appPassword } });
  if (!s?.accessJwt || !s.did) throw new ProviderError("Bluesky did not return a session.", { category: "provider_error", retryable: true });
  return { origin, did: s.did, handle: s.handle ?? c.identifier, accessJwt: s.accessJwt };
}

const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).byteLength;
export function graphemeLength(text: string): number {
  let n = 0;
  for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) n++;
  return n;
}

type Facet = { index: { byteStart: number; byteEnd: number }; features: Array<Record<string, string>> };
/**
 * Links, #tags and @mentions as AT Protocol facets (positions are UTF-8 byte offsets). A mention
 * becomes a facet only when the handle resolves; otherwise it stays plain text.
 */
export async function detectFacets(text: string, resolveHandle: (handle: string) => Promise<string | null>): Promise<Facet[]> {
  const facets: Facet[] = [];
  const at = (start: number, s: string) => ({ byteStart: byteLen(text.slice(0, start)), byteEnd: byteLen(text.slice(0, start)) + byteLen(s) });
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const uri = m[0].replace(/[.,;:!?)\]]+$/, "");
    facets.push({ index: at(m.index, uri), features: [{ $type: "app.bsky.richtext.facet#link", uri }] });
  }
  for (const m of text.matchAll(/(^|\s)(#[^\s#]{1,64})/gu)) {
    const tag = m[2]!.replace(/[.,;:!?)\]]+$/, "");
    if (tag.length < 2 || /^#\d+$/.test(tag)) continue;
    facets.push({ index: at(m.index + m[1]!.length, tag), features: [{ $type: "app.bsky.richtext.facet#tag", tag: tag.slice(1) }] });
  }
  for (const m of text.matchAll(/(^|\s)(@([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+))/g)) {
    const did = await resolveHandle(m[3]!.toLowerCase()).catch(() => null);
    if (did) facets.push({ index: at(m.index + m[1]!.length, m[2]!), features: [{ $type: "app.bsky.richtext.facet#mention", did }] });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}
const resolver = (a: Agent) => async (handle: string) => (await xrpc<{ did?: string }>(a.origin, "GET", "com.atproto.identity.resolveHandle", { token: a.accessJwt, query: { handle } })).did ?? null;

async function createPost(a: Agent, record: Record<string, unknown>): Promise<{ uri: string; cid: string }> {
  return xrpc(a.origin, "POST", "com.atproto.repo.createRecord", { token: a.accessJwt, json: { repo: a.did, collection: "app.bsky.feed.post", record: { $type: "app.bsky.feed.post", createdAt: new Date().toISOString(), ...record } } });
}
async function uploadBlob(a: Agent, bytes: Uint8Array, mimeType: string): Promise<Blob> {
  return (await xrpc<{ blob: Blob }>(a.origin, "POST", "com.atproto.repo.uploadBlob", { token: a.accessJwt, bytes, contentType: mimeType })).blob;
}
async function getPosts(a: Agent, uris: string[]): Promise<PostView[]> {
  return (await xrpc<{ posts?: PostView[] }>(a.origin, "GET", "app.bsky.feed.getPosts", { token: a.accessJwt, query: { uris } })).posts ?? [];
}
async function getProfile(a: Agent, actor: string): Promise<{ displayName?: string; avatar?: string; followersCount?: number; followsCount?: number; postsCount?: number }> {
  return xrpc(a.origin, "GET", "app.bsky.actor.getProfile", { token: a.accessJwt, query: { actor } });
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
    const profile = await getProfile(agent, agent.did);
    return {
      accounts: [
        {
          externalAccountId: agent.did,
          accountType: "profile",
          displayName: profile.displayName || agent.handle,
          username: agent.handle,
          profileUrl: `https://bsky.app/profile/${agent.handle}`,
          avatarUrl: profile.avatar,
          metadata: { service: agent.origin },
        },
      ],
      credentials: { identifier, appPassword, service: agent.origin },
      expiresAt: null,
    };
  },

  async verifyConnection(ctx): Promise<HealthResult> {
    try {
      const agent = await login(creds(ctx));
      return { ok: true, status: "healthy", message: `Logged in as @${agent.handle}` };
    } catch (err) {
      return { ok: false, status: "error", message: (err as Error).message };
    }
  },

  async validatePost(_ctx, target): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const text = target.body + (target.link ? `\n${target.link}` : "");
    const length = graphemeLength(text);
    if (length > MAX_GRAPHEMES) issues.push({ level: "error", code: "too_long", message: `Bluesky posts are limited to ${MAX_GRAPHEMES} characters (you have ${length}).` });
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
    const agent = await login(creds(ctx));
    const text = target.body + (target.link ? `\n${target.link}` : "");
    const facets = await detectFacets(text, resolver(agent));
    // The post's language is stated only when the owner set it; nothing is assumed.
    const langs = Array.isArray(target.overrides.langs) ? (target.overrides.langs as string[]).slice(0, 3) : undefined;

    let embed: Record<string, unknown> | undefined;
    const images = target.media.filter((m) => m.mimeType.startsWith("image/"));
    const video = target.media.find((m) => m.mimeType.startsWith("video/"));
    if (images.length) {
      const uploaded = [];
      for (const img of images) {
        const blob = await uploadBlob(agent, new Uint8Array(await img.read()), img.mimeType);
        uploaded.push({ image: blob, alt: img.altText ?? "", aspectRatio: img.width && img.height ? { width: img.width, height: img.height } : undefined });
      }
      embed = { $type: "app.bsky.embed.images", images: uploaded };
    } else if (video) {
      const blob = await uploadBlob(agent, new Uint8Array(await video.read()), video.mimeType);
      embed = { $type: "app.bsky.embed.video", video: blob, alt: video.altText ?? "" };
    }
    const res = await createPost(agent, { text, ...(facets.length ? { facets } : {}), ...(langs?.length ? { langs } : {}), ...(embed ? { embed } : {}) });
    if (!res?.uri) throw new ProviderError("Bluesky did not return the post's address.", { category: "provider_error", retryable: false });
    return { status: "published", remotePostId: res.uri, remoteUrl: postUrl(agent.handle, res.uri), raw: { cid: res.cid } };
  },

  async getPublishStatus(ctx, remotePostId): Promise<PublishStatus> {
    try {
      const agent = await login(creds(ctx));
      const post = (await getPosts(agent, [remotePostId]))[0];
      if (!post) return { status: "deleted" };
      return { status: "published", remoteUrl: postUrl(post.author.handle, post.uri) };
    } catch (err) {
      return { status: "unknown", error: (err as Error).message };
    }
  },

  async deletePost(ctx, remotePostId): Promise<void> {
    const agent = await login(creds(ctx));
    // at://<did>/app.bsky.feed.post/<rkey> — only a post in this account's own repository can be named.
    const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(remotePostId);
    if (!m || m[1] !== agent.did) throw new ProviderError("That post does not belong to this Bluesky account.", { category: "validation", retryable: false });
    await xrpc(agent.origin, "POST", "com.atproto.repo.deleteRecord", { token: agent.accessJwt, json: { repo: agent.did, collection: "app.bsky.feed.post", rkey: m[2] } });
  },

  async fetchMetrics(ctx, _range: DateRange): Promise<MetricResult[]> {
    const agent = await login(creds(ctx));
    const did = agent.did;
    const now = new Date();
    const out: MetricResult[] = [];
    const profile = await getProfile(agent, did);
    const src = "native:app.bsky.actor.getProfile";
    out.push({ scope: "account", subjectId: did, metric: "followers", granularity: "lifetime", bucketTime: now, value: profile.followersCount ?? null, source: src });
    out.push({ scope: "account", subjectId: did, metric: "following", granularity: "lifetime", bucketTime: now, value: profile.followsCount ?? null, source: src });
    out.push({ scope: "account", subjectId: did, metric: "posts", granularity: "lifetime", bucketTime: now, value: profile.postsCount ?? null, source: src });
    const feed = await xrpc<{ feed?: Array<{ post: PostView }> }>(agent.origin, "GET", "app.bsky.feed.getAuthorFeed", { token: agent.accessJwt, query: { actor: did, limit: 50, filter: "posts_no_replies" } });
    const psrc = "native:app.bsky.feed.getAuthorFeed";
    for (const item of feed.feed ?? []) {
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
    const thread = await xrpc<{ thread?: { replies?: Array<{ post?: PostView }> } }>(agent.origin, "GET", "app.bsky.feed.getPostThread", { token: agent.accessJwt, query: { uri: input.externalPostId, depth: 1 } });
    const comments = (thread.thread?.replies ?? [])
      .filter((r) => r.post)
      .map((r) => ({
        externalCommentId: r.post!.uri,
        externalPostId: input.externalPostId!,
        authorId: r.post!.author.did,
        authorName: r.post!.author.displayName || r.post!.author.handle,
        body: r.post!.record?.text ?? "",
        isOwner: r.post!.author.did === ctx.externalAccountId,
        createdAt: new Date(r.post!.indexedAt),
      }));
    return { comments, nextCursor: null };
  },

  async replyComment(ctx, input) {
    const agent = await login(creds(ctx));
    const posts = await getPosts(agent, [input.externalCommentId, input.externalPostId]);
    const parent = posts.find((p) => p.uri === input.externalCommentId);
    const root = posts.find((p) => p.uri === input.externalPostId);
    if (!parent || !root) throw new ProviderError("Comment or post not found on Bluesky.", { category: "not_found", retryable: false });
    const facets = await detectFacets(input.body, resolver(agent));
    const res = await createPost(agent, { text: input.body, ...(facets.length ? { facets } : {}), reply: { root: { uri: root.uri, cid: root.cid }, parent: { uri: parent.uri, cid: parent.cid } } });
    return { externalCommentId: res.uri };
  },
};
