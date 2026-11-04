/**
 * Slack adapter (native, bot token from a Slack app installed in the workspace).
 * Scopes needed: chat:write, files:write, channels:read (or groups:read for private channels).
 * https://api.slack.com/methods
 */
import { http } from "../http";
import { type AccountContext, type ConnectResult, type HealthResult, type ProviderDescriptor, type PublishResult, type SocialAdapter, type ValidationIssue, type ValidationResult, ProviderError } from "../contract";

const API = "https://slack.com/api";
const MAX_TEXT = 40_000;

function token(ctx: AccountContext): string {
  const t = ctx.credentials.botToken;
  if (typeof t !== "string" || !t) throw new ProviderError("Missing Slack bot token.", { category: "auth_expired", retryable: false });
  return t;
}

async function call<T extends { ok: boolean; error?: string }>(botToken: string, method: string, body?: Record<string, unknown> | FormData): Promise<T> {
  const res = body instanceof FormData
    ? await http<T>(`${API}/${method}`, { method: "POST", headers: { authorization: `Bearer ${botToken}` }, body })
    : await http<T>(`${API}/${method}`, { method: "POST", headers: { authorization: `Bearer ${botToken}` }, json: body ?? {} });
  const d = res.data;
  if (res.status === 429) throw new ProviderError("Slack rate limit.", { category: "rate_limited", retryable: true, retryAfterSeconds: Number(res.headers.get("retry-after") ?? 30) });
  if (!d || !d.ok) {
    const code = d?.error ?? `http_${res.status}`;
    const cat = code === "invalid_auth" || code === "token_revoked" || code === "not_authed" ? "auth_expired" : code === "missing_scope" || code === "not_in_channel" || code === "channel_not_found" ? "permission" : "validation";
    throw new ProviderError(`Slack ${method} failed: ${code}`, { category: cat, retryable: false, providerCode: code });
  }
  return d;
}

export const slackDescriptor: ProviderDescriptor = {
  id: "slack",
  backend: "native",
  displayName: "Slack (app → channel)",
  connect: {
    kind: "credentials",
    fields: [
      { name: "botToken", label: "Bot User OAuth Token (xoxb-…)", secret: true, help: "From api.slack.com/apps → your app → OAuth & Permissions. Scopes: chat:write, files:write, channels:read." },
      { name: "channelId", label: "Channel id", placeholder: "C0123456789", help: "Channel details → copy the Channel ID. Invite the app to the channel (/invite @app)." },
    ],
  },
  capabilities: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_document: "supported", publish_carousel: "supported", publish_link: "supported", delete_post: "supported", edit_post: "supported", schedule_remote: "supported", read_analytics: "unsupported", read_comments: "unsupported", read_dm: "unsupported", send_dm: "unsupported", ads_read: "unsupported", ads_write: "unsupported" },
  limits: { maxTextLength: MAX_TEXT },
  implementationStatus: "CODE_COMPLETE_NEEDS_CREDENTIALS",
  docsUrl: "https://api.slack.com/methods/chat.postMessage",
};

export const slackAdapter: SocialAdapter = {
  descriptor: slackDescriptor,
  async discoverCapabilities() {
    return { ...slackDescriptor.capabilities };
  },
  async connectWithCredentials(input): Promise<ConnectResult> {
    const botToken = (input.botToken ?? "").trim();
    const channelId = (input.channelId ?? "").trim();
    if (!botToken.startsWith("xoxb-") || !channelId) throw new ProviderError("A bot token (xoxb-…) and channel id are required.", { category: "validation", retryable: false });
    const auth = await call<{ ok: boolean; team: string; team_id: string; user_id: string; url: string }>(botToken, "auth.test");
    const info = await call<{ ok: boolean; channel: { id: string; name: string } }>(botToken, "conversations.info", { channel: channelId });
    return {
      accounts: [{ externalAccountId: info.channel.id, accountType: "channel", displayName: `${auth.team} / #${info.channel.name}`, username: info.channel.name, profileUrl: `${auth.url}archives/${info.channel.id}`, metadata: { teamId: auth.team_id, botUserId: auth.user_id, workspaceUrl: auth.url } }],
      credentials: { botToken },
      expiresAt: null,
    };
  },
  async verifyConnection(ctx): Promise<HealthResult> {
    try {
      await call(token(ctx), "auth.test");
      await call(token(ctx), "conversations.info", { channel: ctx.externalAccountId });
      return { ok: true, status: "healthy" };
    } catch (err) {
      return { ok: false, status: "error", message: (err as Error).message };
    }
  },
  async validatePost(_ctx, target): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const text = target.body + (target.link ? `\n${target.link}` : "");
    if (!text.trim() && !target.media.length) issues.push({ level: "error", code: "empty", message: "Message is empty." });
    if (text.length > MAX_TEXT) issues.push({ level: "error", code: "too_long", message: "Message too long for Slack." });
    return { ok: !issues.some((i) => i.level === "error"), issues, format: target.media.length ? "files" : "text" };
  },
  async publish(ctx, target): Promise<PublishResult> {
    const botToken = token(ctx);
    const channel = ctx.externalAccountId;
    const text = target.body + (target.link ? `\n${target.link}` : "");
    const workspaceUrl = (ctx.metadata.workspaceUrl as string | undefined) ?? "";
    if (!target.media.length) {
      const res = await call<{ ok: boolean; ts: string; channel: string }>(botToken, "chat.postMessage", { channel, text, unfurl_links: true });
      return { status: "published", remotePostId: res.ts, remoteUrl: workspaceUrl ? `${workspaceUrl}archives/${channel}/p${res.ts.replace(".", "")}` : null };
    }
    // files.getUploadURLExternal → PUT bytes → files.completeUploadExternal (shares into channel with initial comment)
    const files: Array<{ id: string; title?: string }> = [];
    for (const m of target.media) {
      const bytes = await m.read();
      const up = await call<{ ok: boolean; upload_url: string; file_id: string }>(botToken, "files.getUploadURLExternal", new URLSearchParamsForm({ filename: m.filename, length: String(bytes.length) }));
      const put = await fetch(up.upload_url, { method: "POST", body: new Uint8Array(bytes) });
      if (!put.ok) throw new ProviderError(`Slack upload failed (${put.status}).`, { category: "provider_error", retryable: true });
      files.push({ id: up.file_id, title: m.altText ?? m.filename });
    }
    const done = await call<{ ok: boolean; files: Array<{ id: string; permalink?: string }> }>(botToken, "files.completeUploadExternal", { files, channel_id: channel, initial_comment: text || undefined });
    return { status: "published", remotePostId: `file:${done.files.map((f) => f.id).join(",")}`, remoteUrl: done.files[0]?.permalink ?? null };
  },
  async deletePost(ctx, remotePostId) {
    const botToken = token(ctx);
    if (remotePostId.startsWith("file:")) {
      for (const id of remotePostId.slice(5).split(",")) await call(botToken, "files.delete", { file: id });
    } else {
      await call(botToken, "chat.delete", { channel: ctx.externalAccountId, ts: remotePostId });
    }
  },
};

/** Slack's getUploadURLExternal expects form-encoded params. */
class URLSearchParamsForm extends FormData {
  constructor(params: Record<string, string>) {
    super();
    for (const [k, v] of Object.entries(params)) this.set(k, v);
  }
}
