/**
 * Provider-independent adapter contract.
 *
 * Adapters talk to OFFICIAL provider APIs only. They must return verified remote results
 * (remote ids, permalinks, statuses) — never success placeholders. Unsupported operations are
 * reported through capability states, not by throwing generic errors.
 */

export type ProviderId =
  | "telegram"
  | "bluesky"
  | "discord"
  | "slack"
  | "facebook"
  | "instagram"
  | "threads"
  | "youtube"
  | "linkedin"
  | "pinterest"
  | "reddit"
  | "tiktok"
  | "x"
  | "googlebusiness"
  | "whatsapp"
  | "snapchat";

export type AdapterBackend = "native" | "zernio";

export type Capability =
  | "connect"
  | "publish_text"
  | "publish_image"
  | "publish_video"
  | "publish_carousel"
  | "publish_story"
  | "publish_short"
  | "publish_document"
  | "publish_link"
  | "schedule_remote" // provider/gateway stores the schedule itself
  | "delete_post"
  | "edit_post"
  | "first_comment"
  | "read_analytics"
  | "read_comments"
  | "reply_comment"
  | "hide_comment"
  | "read_dm"
  | "send_dm"
  | "read_reviews"
  | "reply_review"
  | "ads_read"
  | "ads_write";

export type CapabilityState =
  | "supported"
  | "unsupported"
  | "needs_credentials"
  | "needs_approval"
  | "needs_upgrade"
  | "blocked_by_region"
  | "not_tested";

export type CapabilityMap = Partial<Record<Capability, CapabilityState>>;

export interface CapabilityNote {
  capability: Capability;
  state: CapabilityState;
  reason?: string;
}

/** Implementation status recorded per provider (see docs/provider-capabilities.md). */
export type ImplementationStatus =
  | "LIVE_VERIFIED"
  | "CODE_COMPLETE_NEEDS_CREDENTIALS"
  | "AWAITING_PLATFORM_APPROVAL"
  | "UNSUPPORTED_BY_PROVIDER"
  | "REGION_OR_ACCOUNT_RESTRICTED"
  | "NOT_IMPLEMENTED"
  | "FAILED";

export type ConnectMethod =
  | { kind: "oauth"; notes?: string }
  | { kind: "credentials"; fields: CredentialField[]; notes?: string }
  | { kind: "gateway"; notes?: string };

export interface CredentialField {
  name: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
}

export interface ProviderDescriptor {
  id: ProviderId;
  backend: AdapterBackend;
  displayName: string;
  connect: ConnectMethod;
  /** Static capability matrix (before an account is connected). */
  capabilities: CapabilityMap;
  limits: {
    maxTextLength?: number;
    maxImages?: number;
    maxVideoBytes?: number;
    maxImageBytes?: number;
    maxVideoSeconds?: number;
    imageMimeTypes?: string[];
    videoMimeTypes?: string[];
  };
  implementationStatus: ImplementationStatus;
  docsUrl?: string;
  /** Required env vars for this adapter to be usable at all. */
  requiredEnv?: string[];
}

export interface RemoteAccount {
  externalAccountId: string;
  accountType?: string;
  displayName: string;
  username?: string;
  profileUrl?: string;
  avatarUrl?: string;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}

export interface ConnectResult {
  accounts: RemoteAccount[];
  /** Credentials to be encrypted at rest. Per-account credentials override the shared one. */
  credentials: Record<string, unknown>;
  perAccountCredentials?: Record<string, Record<string, unknown>>;
  expiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
}

export interface AccountContext {
  accountId: string; // local id
  brandId: string;
  provider: ProviderId;
  backend: AdapterBackend;
  externalAccountId: string;
  accountType?: string | null;
  metadata: Record<string, unknown>;
  /** Decrypted credentials; must never be logged. */
  credentials: Record<string, unknown>;
  /** Gateway-level config (e.g. Zernio API key) when backend = zernio. */
  gateway?: { apiKey: string; baseUrl: string; profileId?: string; accountId?: string };
}

export interface MediaRef {
  id: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  altText?: string | null;
  filename: string;
  /** Reads the bytes from storage (private). */
  read: () => Promise<Buffer>;
  /** Short-lived signed URL readable by the provider, if the storage driver supports it. */
  signedUrl?: () => Promise<string | null>;
}

export interface TargetPost {
  postId: string;
  targetId: string;
  body: string;
  title?: string | null;
  link?: string | null;
  media: MediaRef[];
  /** Provider-specific overrides: caption, privacy, boardId, subreddit, contentType... */
  overrides: Record<string, unknown>;
  scheduledAt?: Date | null;
  timezone?: string | null;
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Which content format will be used (text, image, carousel, video...). */
  format?: string;
}

export interface PublishResult {
  status: "published" | "processing" | "scheduled_remote";
  remotePostId: string;
  remoteUrl?: string | null;
  providerRequestId?: string | null;
  raw?: unknown; // redacted summary only
}

export interface PublishStatus {
  status: "published" | "processing" | "failed" | "deleted" | "unknown";
  remoteUrl?: string | null;
  error?: string | null;
  errorCategory?: string | null;
}

export interface HealthResult {
  ok: boolean;
  status: "healthy" | "warning" | "error";
  message?: string;
  scopes?: string[];
  expiresAt?: Date | null;
  details?: Record<string, unknown>;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface MetricResult {
  scope: "account" | "post";
  subjectId: string;
  metric: string;
  granularity: "lifetime" | "day" | "week" | "month";
  bucketTime: Date;
  breakdown?: string;
  value: number | null;
  source: string;
  providerUpdatedAt?: Date | null;
}

export interface RemoteComment {
  externalCommentId: string;
  externalPostId: string;
  parentExternalId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  body: string;
  isOwner?: boolean;
  hidden?: boolean;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface CommentsPage {
  comments: RemoteComment[];
  nextCursor?: string | null;
}

export interface RemoteMessage {
  externalMessageId: string;
  direction: "inbound" | "outbound";
  body?: string | null;
  attachments?: unknown[];
  senderName?: string | null;
  sentAt: Date;
  metadata?: Record<string, unknown>;
}

export interface RemoteThread {
  externalThreadId: string;
  participantId?: string | null;
  participantName?: string | null;
  participantUrl?: string | null;
  lastMessageAt?: Date | null;
  lastMessageText?: string | null;
  unreadCount?: number | null;
  messages?: RemoteMessage[];
  metadata?: Record<string, unknown>;
}

export interface InboxPage {
  threads: RemoteThread[];
  nextCursor?: string | null;
}

/** Normalized error for provider calls. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly options: {
      category:
        | "auth_expired"
        | "permission"
        | "rate_limited"
        | "validation"
        | "not_found"
        | "provider_error"
        | "network"
        | "unsupported"
        | "unknown";
      retryable: boolean;
      retryAfterSeconds?: number;
      providerCode?: string | number;
      providerRequestId?: string;
      status?: number;
    },
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface SocialAdapter {
  readonly descriptor: ProviderDescriptor;

  /** Capability discovery for a specific connected account (may call the provider). */
  discoverCapabilities(ctx: AccountContext): Promise<CapabilityMap>;

  // --- Connection ---------------------------------------------------------------
  buildAuthorizationUrl?(input: {
    brandId: string;
    state: string;
    redirectUri: string;
    codeChallenge?: string;
    extra?: Record<string, string>;
  }): Promise<string>;
  exchangeAuthorizationCode?(input: {
    code: string;
    state: string;
    redirectUri: string;
    codeVerifier?: string;
    callbackParams: Record<string, string>;
  }): Promise<ConnectResult>;
  /** For providers whose documented auth is a bot token / app password. */
  connectWithCredentials?(input: Record<string, string>): Promise<ConnectResult>;
  verifyConnection(ctx: AccountContext): Promise<HealthResult>;
  refreshCredentials?(ctx: AccountContext): Promise<{ credentials: Record<string, unknown>; expiresAt?: Date | null }>;
  revoke?(ctx: AccountContext): Promise<void>;

  // --- Publishing ---------------------------------------------------------------
  validatePost(ctx: AccountContext, target: TargetPost): Promise<ValidationResult>;
  publish(ctx: AccountContext, target: TargetPost, idempotencyKey: string): Promise<PublishResult>;
  getPublishStatus?(ctx: AccountContext, remotePostId: string): Promise<PublishStatus>;
  deletePost?(ctx: AccountContext, remotePostId: string): Promise<void>;

  // --- Engagement & analytics ----------------------------------------------------
  fetchMetrics?(ctx: AccountContext, range: DateRange): Promise<MetricResult[]>;
  fetchComments?(ctx: AccountContext, input: { externalPostId?: string; cursor?: string | null }): Promise<CommentsPage>;
  replyComment?(ctx: AccountContext, input: { externalPostId: string; externalCommentId: string; body: string }): Promise<{ externalCommentId: string }>;
  fetchInbox?(ctx: AccountContext, cursor?: string | null): Promise<InboxPage>;
  sendMessage?(ctx: AccountContext, input: { externalThreadId: string; body: string }): Promise<{ externalMessageId: string }>;
}

export function unsupported(capabilities: Capability[], reason?: string): CapabilityNote[] {
  return capabilities.map((capability) => ({ capability, state: "unsupported", reason }));
}
