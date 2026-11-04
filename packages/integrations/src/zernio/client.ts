/**
 * Thin client for the Zernio unified API (https://zernio.com/openapi.yaml, v1).
 * This is the OPTIONAL gateway backend. It is isolated here and replaceable: nothing outside
 * packages/integrations/src/zernio imports it directly.
 */
import { classifyHttpError, http, type HttpResponse } from "../http";
import { ProviderError } from "../contract";

export const ZERNIO_BASE_URL = "https://zernio.com/api";

export type ZernioPlatform =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "twitter"
  | "tiktok"
  | "youtube"
  | "threads"
  | "reddit"
  | "pinterest"
  | "bluesky"
  | "googlebusiness"
  | "telegram"
  | "snapchat"
  | "discord"
  | "slack"
  | "whatsapp";

export interface ZernioProfile {
  _id: string;
  name: string;
  externalId?: string | null;
  timezone?: string | null;
  isDefault?: boolean;
}

export interface ZernioAccount {
  _id: string;
  platform: string;
  profileId: string | { _id: string };
  username?: string;
  displayName?: string;
  platformUserId?: string;
  profilePicture?: string | null;
  profileUrl?: string;
  isActive: boolean;
  needsReconnection?: boolean;
  scopeAreas?: string[] | null;
  followersCount?: number;
  metadata?: Record<string, unknown>;
}

export interface ZernioPostPlatformResult {
  platform: string;
  accountId: string | { _id: string };
  status: string;
  platformPostId?: string;
  platformPostUrl?: string | null;
  publishedAt?: string;
  errorMessage?: string;
  errorCategory?: string;
  scheduledFor?: string;
}

export interface ZernioPost {
  _id: string;
  content?: string;
  status: "draft" | "pending_approval" | "scheduled" | "publishing" | "published" | "partial" | "failed" | "cancelled";
  scheduledFor?: string;
  timezone?: string;
  platforms: ZernioPostPlatformResult[];
  createdAt?: string;
}

export interface ZernioMediaItem {
  type: "image" | "video" | "gif" | "document";
  url: string;
  altText?: string;
  filename?: string;
  size?: number;
  mimeType?: string;
}

export interface ZernioCreatePostBody {
  content?: string;
  title?: string;
  mediaItems?: ZernioMediaItem[];
  platforms: Array<{
    platform: string;
    accountId: string;
    customContent?: string;
    customMedia?: ZernioMediaItem[];
    platformSpecificData?: Record<string, unknown>;
  }>;
  scheduledFor?: string;
  publishNow?: boolean;
  timezone?: string;
  tags?: string[];
  dryRun?: boolean;
}

export class ZernioClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = ZERNIO_BASE_URL,
  ) {
    if (!apiKey) throw new ProviderError("Zernio API key is not configured.", { category: "auth_expired", retryable: false });
  }

  private async request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, opts: { query?: Record<string, string | number | boolean | undefined>; json?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const res = await http<T & { error?: string; message?: string; code?: string }>(url.toString(), {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json", ...(opts.headers ?? {}) },
      json: opts.json,
      timeoutMs: opts.timeoutMs ?? 60_000,
    });
    if (res.status >= 200 && res.status < 300) return res.data as T;
    const d = res.data as { error?: string; message?: string; code?: string } | null;
    const msg = `Zernio ${method} ${path} → ${res.status}: ${d?.message ?? d?.error ?? res.text.slice(0, 300)}`;
    const err = classifyHttpError(res as HttpResponse, msg, res.headers.get("x-request-id") ?? undefined);
    if (d?.code) (err.options as { providerCode?: string }).providerCode = d.code;
    throw err;
  }

  // --- Profiles -------------------------------------------------------------------
  listProfiles(): Promise<{ profiles: ZernioProfile[] }> {
    return this.request("GET", "/v1/profiles");
  }
  createProfile(body: { name: string; externalId?: string; timezone?: string; description?: string }, idempotencyKey?: string): Promise<{ profile: ZernioProfile }> {
    return this.request("POST", "/v1/profiles", { json: body, headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined });
  }
  async ensureProfile(externalId: string, name: string, timezone?: string): Promise<ZernioProfile> {
    const { profiles } = await this.listProfiles();
    const found = profiles.find((p) => p.externalId === externalId);
    if (found) return found;
    try {
      const { profile } = await this.createProfile({ name, externalId, timezone }, `profile:${externalId}`);
      return profile;
    } catch (err) {
      // Name conflict → fall back to the existing profile with that name.
      const again = await this.listProfiles();
      const byName = again.profiles.find((p) => p.name === name);
      if (byName) return byName;
      throw err;
    }
  }

  // --- Connect / accounts -----------------------------------------------------------
  getConnectUrl(platform: ZernioPlatform, query: { profileId: string; redirect_url: string; scopes?: string; loginMethod?: "instagram_login" | "facebook_login"; reconnectAccountId?: string; expectedUsername?: string }): Promise<{ authUrl: string; state?: string }> {
    return this.request("GET", `/v1/connect/${platform}`, { query });
  }
  listAccounts(query: { profileId?: string; platform?: string; status?: "connected" | "disconnected"; category?: string } = {}): Promise<{ accounts: ZernioAccount[]; hasAnalyticsAccess: boolean }> {
    return this.request("GET", "/v1/accounts", { query: { ...query, includeOverLimit: true } });
  }
  accountHealth(accountId: string): Promise<{ status: "healthy" | "warning" | "error"; tokenStatus?: { valid: boolean; expiresAt?: string }; permissions?: { canPost?: boolean; canFetchAnalytics?: boolean; missingRequired?: string[] }; issues?: string[]; recommendations?: string[] }> {
    return this.request("GET", `/v1/accounts/${accountId}/health`);
  }
  disconnectAccount(accountId: string): Promise<{ message: string }> {
    return this.request("DELETE", `/v1/accounts/${accountId}`);
  }

  // --- Media ------------------------------------------------------------------------
  presignUpload(body: { filename: string; contentType: string; size?: number }): Promise<{ uploadUrl: string; publicUrl: string; key: string; expiresIn: number }> {
    return this.request("POST", "/v1/media/presign", { json: body });
  }
  async uploadBytes(filename: string, contentType: string, bytes: Buffer): Promise<string> {
    const { uploadUrl, publicUrl } = await this.presignUpload({ filename, contentType, size: bytes.length });
    const res = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": contentType }, body: new Uint8Array(bytes) });
    if (!res.ok) throw new ProviderError(`Zernio media upload failed (${res.status}).`, { category: "provider_error", retryable: true });
    return publicUrl;
  }

  // --- Posts ------------------------------------------------------------------------
  createPost(body: ZernioCreatePostBody, idempotencyKey: string): Promise<{ post?: ZernioPost; dryRun?: boolean; canPublish?: boolean; warnings?: string[]; message?: string }> {
    return this.request("POST", "/v1/posts", { json: body, headers: { "idempotency-key": idempotencyKey, "x-request-id": idempotencyKey }, timeoutMs: 180_000 });
  }
  getPost(postId: string): Promise<{ post: ZernioPost }> {
    return this.request("GET", `/v1/posts/${postId}`);
  }
  deletePost(postId: string): Promise<{ message: string }> {
    return this.request("DELETE", `/v1/posts/${postId}`);
  }
  unpublishPost(postId: string, body?: { accountId?: string }): Promise<unknown> {
    return this.request("POST", `/v1/posts/${postId}/unpublish`, { json: body ?? {} });
  }

  // --- Analytics ----------------------------------------------------------------------
  getAnalytics(query: { postId?: string; platform?: string; profileId?: string; accountId?: string; fromDate?: string; toDate?: string; limit?: number; page?: number; source?: "all" | "late" | "external" }): Promise<unknown> {
    return this.request("GET", "/v1/analytics", { query });
  }
  followerStats(query: { accountIds?: string; profileId?: string; fromDate?: string; toDate?: string; granularity?: "daily" | "weekly" | "monthly" }): Promise<{ accounts: Array<ZernioAccount & { currentFollowers?: number; growth?: number; growthPercentage?: number; lastUpdated?: string; accountStats?: unknown }> }> {
    return this.request("GET", "/v1/accounts/follower-stats", { query });
  }

  // --- Inbox ----------------------------------------------------------------------------
  listCommentedPosts(query: { profileId?: string; platform?: string; accountId?: string; limit?: number; cursor?: string; since?: string }): Promise<{ data: Array<{ id: string; platform: string; accountId: string; content?: string; permalink?: string | null; createdTime: string; commentCount: number }>; pagination?: { hasMore: boolean; nextCursor: string | null } }> {
    return this.request("GET", "/v1/inbox/comments", { query });
  }
  getComments(postId: string, query: { accountId: string; limit?: number; cursor?: string; commentId?: string }): Promise<{ comments: Array<{ id: string; message: string; createdTime: string; from?: { id?: string; name?: string; username?: string; isOwner?: boolean }; parentId?: string | null; isHidden?: boolean; url?: string | null; replyCount?: number }>; pagination?: { hasMore?: boolean; cursor?: string | null } }> {
    return this.request("GET", `/v1/inbox/comments/${encodeURIComponent(postId)}`, { query });
  }
  replyComment(postId: string, body: { accountId: string; message: string; commentId?: string }, idempotencyKey?: string): Promise<{ success: boolean; data: { commentId: string } }> {
    return this.request("POST", `/v1/inbox/comments/${encodeURIComponent(postId)}`, { json: body, headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined });
  }
  hideComment(postId: string, commentId: string, body: { accountId: string }): Promise<unknown> {
    return this.request("POST", `/v1/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/hide`, { json: body });
  }
  listConversations(query: { profileId?: string; platform?: string; accountId?: string; limit?: number; cursor?: string; status?: "active" | "archived" }): Promise<{ data: Array<{ id: string; platform: string; accountId: string; participantId?: string; participantName?: string; lastMessage?: string; updatedTime?: string; unreadCount?: number | null; url?: string | null }>; pagination?: { hasMore?: boolean; nextCursor?: string | null } }> {
    return this.request("GET", "/v1/inbox/conversations", { query });
  }
  listMessages(conversationId: string, query: { accountId: string; limit?: number; cursor?: string; sortOrder?: "asc" | "desc" }): Promise<{ messages: Array<{ id: string; message?: string; senderId?: string; senderName?: string | null; direction: "incoming" | "outgoing"; createdAt: string; attachments?: unknown[]; deliveryStatus?: string }>; pagination?: { hasMore?: boolean; nextCursor?: string | null } }> {
    return this.request("GET", `/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, { query });
  }
  sendMessage(conversationId: string, body: { accountId: string; message: string }, idempotencyKey?: string): Promise<{ success: boolean; data: { messageId: string } }> {
    return this.request("POST", `/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, { json: body, headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : undefined });
  }

  // --- Ads (read first) ---------------------------------------------------------------
  listAdCampaigns(query: { profileId?: string; platform?: string; adAccountId?: string; accountId?: string; fromDate?: string; toDate?: string; limit?: number; includeEmpty?: boolean }): Promise<{ campaigns: Array<Record<string, unknown>> }> {
    return this.request("GET", "/v1/ads/campaigns", { query });
  }
  listAds(query: { profileId?: string; platform?: string; adAccountId?: string; accountId?: string; fromDate?: string; toDate?: string; limit?: number }): Promise<{ ads: Array<Record<string, unknown>> }> {
    return this.request("GET", "/v1/ads", { query });
  }
  setCampaignStatus(campaignId: string, body: { status: "active" | "paused"; platform: string }): Promise<{ status: string; updated: number }> {
    return this.request("PUT", `/v1/ads/campaigns/${encodeURIComponent(campaignId)}/status`, { json: body });
  }

  // --- Webhooks ---------------------------------------------------------------------------
  listWebhooks(): Promise<{ webhooks: Array<{ _id: string; name: string; url: string; events: string[]; isActive?: boolean }> } | Array<{ _id: string; name: string; url: string; events: string[] }>> {
    return this.request("GET", "/v1/webhooks/settings");
  }
  createWebhook(body: { name: string; url: string; secret?: string; events: string[] }): Promise<{ success: boolean; webhook: { _id: string } }> {
    return this.request("POST", "/v1/webhooks/settings", { json: body });
  }

  // --- Misc -------------------------------------------------------------------------------
  usage(): Promise<unknown> {
    return this.request("GET", "/v1/usage");
  }
}
