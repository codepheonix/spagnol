/**
 * Telegram Bot API adapter (native).
 * Docs: https://core.telegram.org/bots/api
 *
 * Auth: bot token from @BotFather + a target chat (channel @username or numeric id) where the
 * bot is an administrator with "post messages" rights. No personal-account impersonation.
 */
import { classifyHttpError, http } from "../http";
import {
  type AccountContext,
  type CapabilityMap,
  type ConnectResult,
  type HealthResult,
  type ProviderDescriptor,
  type PublishResult,
  type PublishStatus,
  type SocialAdapter,
  type TargetPost,
  type ValidationIssue,
  type ValidationResult,
  ProviderError,
} from "../contract";

// Overridable only for the local smoke test (scripts/smoke.ts) which runs a stub Bot API.
const API = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";
const MAX_TEXT = 4096;
const MAX_CAPTION = 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // multipart upload limit for bots

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

interface TgChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

interface TgMessage {
  message_id: number;
  chat: TgChat;
  date: number;
}

interface TgCredentials {
  botToken: string;
}

async function call<T>(botToken: string, method: string, payload?: Record<string, unknown> | FormData): Promise<T> {
  const url = `${API}/bot${botToken}/${method}`;
  const res =
    payload instanceof FormData
      ? await http<TgResponse<T>>(url, { method: "POST", body: payload, timeoutMs: 120_000 })
      : await http<TgResponse<T>>(url, { method: "POST", json: payload ?? {} });
  const data = res.data;
  if (res.status === 200 && data && data.ok && data.result !== undefined) return data.result;
  const description = (data && data.description) || `Telegram API error (${res.status})`;
  if (res.status === 429 || data?.error_code === 429) {
    throw new ProviderError(description, {
      category: "rate_limited",
      retryable: true,
      retryAfterSeconds: data?.parameters?.retry_after ?? 30,
      providerCode: 429,
    });
  }
  if (res.status === 401) throw new ProviderError("Bot token rejected by Telegram.", { category: "auth_expired", retryable: false, status: 401 });
  if (res.status === 403) throw new ProviderError(description, { category: "permission", retryable: false, status: 403 });
  if (res.status === 400) throw new ProviderError(description, { category: "validation", retryable: false, status: 400, providerCode: data?.error_code });
  throw classifyHttpError(res, description);
}

function creds(ctx: AccountContext): TgCredentials {
  const token = ctx.credentials.botToken;
  if (typeof token !== "string" || !token) throw new ProviderError("Missing Telegram bot token.", { category: "auth_expired", retryable: false });
  return { botToken: token };
}

function permalink(chat: { username?: string | null; id: string | number }, messageId: number): string | null {
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  const id = String(chat.id);
  // Private supergroups/channels: t.me/c/<internal id>/<message id>
  if (id.startsWith("-100")) return `https://t.me/c/${id.slice(4)}/${messageId}`;
  return null;
}

export const telegramDescriptor: ProviderDescriptor = {
  id: "telegram",
  backend: "native",
  displayName: "Telegram (bot → channel/group)",
  connect: {
    kind: "credentials",
    fields: [
      { name: "botToken", label: "Bot token (from @BotFather)", secret: true, placeholder: "123456:ABC..." },
      { name: "chatId", label: "Channel/group (@username or numeric id)", placeholder: "@mychannel", help: "The bot must be an administrator with permission to post." },
    ],
    notes: "Create a bot with @BotFather, add it as an administrator of your channel, then paste the token here (stored encrypted).",
  },
  capabilities: {
    connect: "supported",
    publish_text: "supported",
    publish_image: "supported",
    publish_video: "supported",
    publish_carousel: "supported", // sendMediaGroup (2–10 items)
    publish_document: "supported",
    publish_link: "supported",
    delete_post: "supported",
    edit_post: "supported",
    schedule_remote: "unsupported",
    read_analytics: "unsupported", // Bot API exposes no view counts for channel posts
    read_comments: "unsupported", // discussion-group comments require a bot in the group + webhook (not implemented)
    read_dm: "unsupported",
    send_dm: "unsupported",
    ads_read: "unsupported",
    ads_write: "unsupported",
  },
  limits: {
    maxTextLength: MAX_TEXT,
    maxImages: 10,
    maxImageBytes: MAX_PHOTO_BYTES,
    maxVideoBytes: MAX_VIDEO_BYTES,
    imageMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    videoMimeTypes: ["video/mp4", "video/quicktime"],
  },
  implementationStatus: "CODE_COMPLETE_NEEDS_CREDENTIALS",
  docsUrl: "https://core.telegram.org/bots/api",
};

export const telegramAdapter: SocialAdapter = {
  descriptor: telegramDescriptor,

  async discoverCapabilities(ctx): Promise<CapabilityMap> {
    const caps: CapabilityMap = { ...telegramDescriptor.capabilities };
    try {
      const { botToken } = creds(ctx);
      const member = await call<{ status: string; can_post_messages?: boolean; can_edit_messages?: boolean; can_delete_messages?: boolean }>(
        botToken,
        "getChatMember",
        { chat_id: ctx.externalAccountId, user_id: Number(ctx.metadata.botId) },
      );
      const canPost = member.status === "creator" || (member.status === "administrator" && member.can_post_messages !== false);
      if (!canPost) {
        for (const c of ["publish_text", "publish_image", "publish_video", "publish_carousel", "publish_document", "publish_link"] as const) caps[c] = "needs_approval";
      }
      if (member.status === "administrator" && member.can_delete_messages === false) caps.delete_post = "unsupported";
      if (member.status === "administrator" && member.can_edit_messages === false) caps.edit_post = "unsupported";
    } catch {
      // keep static matrix; health check will surface the error
    }
    return caps;
  },

  async connectWithCredentials(input): Promise<ConnectResult> {
    const botToken = (input.botToken ?? "").trim();
    const chatId = (input.chatId ?? "").trim();
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) throw new ProviderError("That does not look like a Telegram bot token.", { category: "validation", retryable: false });
    if (!chatId) throw new ProviderError("Chat id or @username is required.", { category: "validation", retryable: false });
    const me = await call<{ id: number; username?: string; first_name?: string }>(botToken, "getMe");
    const chat = await call<TgChat>(botToken, "getChat", { chat_id: chatId });
    const member = await call<{ status: string; can_post_messages?: boolean }>(botToken, "getChatMember", { chat_id: chat.id, user_id: me.id });
    const canPost = member.status === "creator" || (member.status === "administrator" && member.can_post_messages !== false);
    if (!canPost) {
      throw new ProviderError(`Bot @${me.username} is not an administrator with posting rights in "${chat.title ?? chat.id}".`, {
        category: "permission",
        retryable: false,
      });
    }
    return {
      accounts: [
        {
          externalAccountId: String(chat.id),
          accountType: chat.type,
          displayName: chat.title ?? chat.first_name ?? String(chat.id),
          username: chat.username,
          profileUrl: chat.username ? `https://t.me/${chat.username}` : undefined,
          metadata: { botId: me.id, botUsername: me.username, chatType: chat.type },
        },
      ],
      credentials: { botToken },
      expiresAt: null,
    };
  },

  async verifyConnection(ctx): Promise<HealthResult> {
    try {
      const { botToken } = creds(ctx);
      const me = await call<{ id: number; username?: string }>(botToken, "getMe");
      const member = await call<{ status: string; can_post_messages?: boolean }>(botToken, "getChatMember", {
        chat_id: ctx.externalAccountId,
        user_id: me.id,
      });
      const canPost = member.status === "creator" || (member.status === "administrator" && member.can_post_messages !== false);
      return canPost
        ? { ok: true, status: "healthy", message: `Bot @${me.username} can post.`, details: { memberStatus: member.status } }
        : { ok: false, status: "error", message: `Bot @${me.username} lost posting rights (status: ${member.status}).` };
    } catch (err) {
      return { ok: false, status: "error", message: (err as Error).message };
    }
  },

  async validatePost(_ctx, target): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const images = target.media.filter((m) => m.mimeType.startsWith("image/"));
    const videos = target.media.filter((m) => m.mimeType.startsWith("video/"));
    const docs = target.media.filter((m) => !m.mimeType.startsWith("image/") && !m.mimeType.startsWith("video/"));
    let format = "text";
    const text = target.body + (target.link ? `\n${target.link}` : "");
    if (target.media.length === 0) {
      if (!text.trim()) issues.push({ level: "error", code: "empty", message: "Text is required for a Telegram message." });
      if (text.length > MAX_TEXT) issues.push({ level: "error", code: "too_long", message: `Text exceeds ${MAX_TEXT} characters.` });
    } else {
      if (text.length > MAX_CAPTION) issues.push({ level: "error", code: "caption_too_long", message: `Caption exceeds ${MAX_CAPTION} characters.` });
      if (target.media.length > 10) issues.push({ level: "error", code: "too_many_media", message: "Telegram media groups hold at most 10 items." });
      if (docs.length > 0 && target.media.length > 1) issues.push({ level: "error", code: "mixed_media", message: "Documents cannot be mixed with photos/videos in one message." });
      for (const m of images) if (m.sizeBytes > MAX_PHOTO_BYTES) issues.push({ level: "error", code: "image_too_big", message: `${m.filename}: photos must be ≤ 10 MB.` });
      for (const m of videos) if (m.sizeBytes > MAX_VIDEO_BYTES) issues.push({ level: "error", code: "video_too_big", message: `${m.filename}: bot uploads must be ≤ 50 MB.` });
      format = target.media.length > 1 ? "media_group" : docs.length ? "document" : videos.length ? "video" : "photo";
    }
    return { ok: !issues.some((i) => i.level === "error"), issues, format };
  },

  async publish(ctx, target, _idempotencyKey): Promise<PublishResult> {
    const { botToken } = creds(ctx);
    const chatId = ctx.externalAccountId;
    const caption = target.body + (target.link ? `\n${target.link}` : "");
    const parseMode = typeof target.overrides.parseMode === "string" ? target.overrides.parseMode : undefined;
    const disableNotification = target.overrides.disableNotification === true;

    if (target.media.length === 0) {
      const msg = await call<TgMessage>(botToken, "sendMessage", {
        chat_id: chatId,
        text: caption,
        parse_mode: parseMode,
        disable_notification: disableNotification,
        link_preview_options: target.overrides.disableWebPagePreview === true ? { is_disabled: true } : undefined,
      });
      return { status: "published", remotePostId: String(msg.message_id), remoteUrl: permalink(msg.chat, msg.message_id) };
    }

    if (target.media.length === 1) {
      const m = target.media[0]!;
      const form = new FormData();
      form.set("chat_id", chatId);
      if (caption) form.set("caption", caption);
      if (parseMode) form.set("parse_mode", parseMode);
      if (disableNotification) form.set("disable_notification", "true");
      const bytes = await m.read();
      const blob = new Blob([new Uint8Array(bytes)], { type: m.mimeType });
      let method = "sendDocument";
      let field = "document";
      if (m.mimeType.startsWith("image/") && m.mimeType !== "image/gif") {
        method = "sendPhoto";
        field = "photo";
      } else if (m.mimeType === "image/gif") {
        method = "sendAnimation";
        field = "animation";
      } else if (m.mimeType.startsWith("video/")) {
        method = "sendVideo";
        field = "video";
        form.set("supports_streaming", "true");
      }
      form.set(field, blob, m.filename);
      const msg = await call<TgMessage>(botToken, method, form);
      return { status: "published", remotePostId: String(msg.message_id), remoteUrl: permalink(msg.chat, msg.message_id) };
    }

    // Media group (2–10): caption goes on the first item.
    const form = new FormData();
    form.set("chat_id", chatId);
    if (disableNotification) form.set("disable_notification", "true");
    const media: Record<string, unknown>[] = [];
    for (let i = 0; i < target.media.length; i++) {
      const m = target.media[i]!;
      const attach = `file${i}`;
      form.set(attach, new Blob([new Uint8Array(await m.read())], { type: m.mimeType }), m.filename);
      media.push({
        type: m.mimeType.startsWith("video/") ? "video" : "photo",
        media: `attach://${attach}`,
        caption: i === 0 && caption ? caption : undefined,
        parse_mode: i === 0 && parseMode ? parseMode : undefined,
      });
    }
    form.set("media", JSON.stringify(media));
    const msgs = await call<TgMessage[]>(botToken, "sendMediaGroup", form);
    const first = msgs[0];
    if (!first) throw new ProviderError("Telegram returned an empty media group response.", { category: "provider_error", retryable: false });
    return {
      status: "published",
      remotePostId: msgs.map((m) => m.message_id).join(","),
      remoteUrl: permalink(first.chat, first.message_id),
      raw: { messageIds: msgs.map((m) => m.message_id) },
    };
  },

  async getPublishStatus(_ctx, _remotePostId): Promise<PublishStatus> {
    // Bot API has no "get message" call; a successful send response is the provider's confirmation.
    return { status: "published" };
  },

  async deletePost(ctx, remotePostId): Promise<void> {
    const { botToken } = creds(ctx);
    for (const id of remotePostId.split(",")) {
      await call<boolean>(botToken, "deleteMessage", { chat_id: ctx.externalAccountId, message_id: Number(id) });
    }
  },
};
