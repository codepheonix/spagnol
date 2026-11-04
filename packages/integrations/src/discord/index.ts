/**
 * Discord adapter (native, bot token). Posts messages into a channel where the bot has
 * SEND_MESSAGES / ATTACH_FILES permissions. https://discord.com/developers/docs
 */
import { classifyHttpError, http } from "../http";
import { type AccountContext, type ConnectResult, type HealthResult, type ProviderDescriptor, type PublishResult, type SocialAdapter, type ValidationIssue, type ValidationResult, ProviderError } from "../contract";

const API = "https://discord.com/api/v10";
const MAX_TEXT = 2000;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // default upload limit without Nitro boosts

function token(ctx: AccountContext): string {
  const t = ctx.credentials.botToken;
  if (typeof t !== "string" || !t) throw new ProviderError("Missing Discord bot token.", { category: "auth_expired", retryable: false });
  return t;
}

async function call<T>(botToken: string, method: "GET" | "POST" | "DELETE", path: string, body?: unknown | FormData): Promise<T> {
  const res = body instanceof FormData
    ? await http<T>(`${API}${path}`, { method, headers: { authorization: `Bot ${botToken}` }, body, timeoutMs: 120_000 })
    : await http<T>(`${API}${path}`, { method, headers: { authorization: `Bot ${botToken}` }, json: body });
  if (res.status >= 200 && res.status < 300) return res.data;
  const d = res.data as { message?: string; code?: number } | null;
  throw classifyHttpError(res, `Discord ${method} ${path} → ${res.status}: ${d?.message ?? res.text.slice(0, 200)}`);
}

export const discordDescriptor: ProviderDescriptor = {
  id: "discord",
  backend: "native",
  displayName: "Discord (bot → channel)",
  connect: {
    kind: "credentials",
    fields: [
      { name: "botToken", label: "Bot token (Developer Portal → Bot)", secret: true },
      { name: "channelId", label: "Channel id", placeholder: "123456789012345678", help: "Enable Developer Mode in Discord, right-click the channel → Copy ID. Invite the bot to the server with Send Messages + Attach Files." },
    ],
  },
  capabilities: { connect: "supported", publish_text: "supported", publish_image: "supported", publish_video: "supported", publish_carousel: "supported", publish_document: "supported", publish_link: "supported", delete_post: "supported", edit_post: "supported", schedule_remote: "unsupported", read_analytics: "unsupported", read_comments: "unsupported", read_dm: "unsupported", send_dm: "unsupported", ads_read: "unsupported", ads_write: "unsupported" },
  limits: { maxTextLength: MAX_TEXT, maxImages: 10, maxImageBytes: MAX_FILE_BYTES, maxVideoBytes: MAX_FILE_BYTES },
  implementationStatus: "CODE_COMPLETE_NEEDS_CREDENTIALS",
  docsUrl: "https://discord.com/developers/docs/resources/message",
};

export const discordAdapter: SocialAdapter = {
  descriptor: discordDescriptor,
  async discoverCapabilities() {
    return { ...discordDescriptor.capabilities };
  },
  async connectWithCredentials(input): Promise<ConnectResult> {
    const botToken = (input.botToken ?? "").trim();
    const channelId = (input.channelId ?? "").trim();
    if (!botToken || !/^\d{10,25}$/.test(channelId)) throw new ProviderError("Bot token and a numeric channel id are required.", { category: "validation", retryable: false });
    const me = await call<{ id: string; username: string }>(botToken, "GET", "/users/@me");
    const channel = await call<{ id: string; name?: string; guild_id?: string; type: number }>(botToken, "GET", `/channels/${channelId}`);
    let guildName: string | undefined;
    if (channel.guild_id) {
      const guild = await call<{ name: string }>(botToken, "GET", `/guilds/${channel.guild_id}`);
      guildName = guild.name;
    }
    return {
      accounts: [{ externalAccountId: channel.id, accountType: "channel", displayName: `${guildName ? guildName + " / " : ""}#${channel.name ?? channel.id}`, username: channel.name, profileUrl: channel.guild_id ? `https://discord.com/channels/${channel.guild_id}/${channel.id}` : undefined, metadata: { botId: me.id, botUsername: me.username, guildId: channel.guild_id } }],
      credentials: { botToken },
      expiresAt: null,
    };
  },
  async verifyConnection(ctx): Promise<HealthResult> {
    try {
      await call(token(ctx), "GET", `/channels/${ctx.externalAccountId}`);
      return { ok: true, status: "healthy" };
    } catch (err) {
      return { ok: false, status: "error", message: (err as Error).message };
    }
  },
  async validatePost(_ctx, target): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const text = target.body + (target.link ? `\n${target.link}` : "");
    if (text.length > MAX_TEXT) issues.push({ level: "error", code: "too_long", message: `Discord messages are limited to ${MAX_TEXT} characters.` });
    if (!text.trim() && !target.media.length) issues.push({ level: "error", code: "empty", message: "Message is empty." });
    if (target.media.length > 10) issues.push({ level: "error", code: "too_many_files", message: "At most 10 attachments per message." });
    for (const m of target.media) if (m.sizeBytes > MAX_FILE_BYTES) issues.push({ level: "error", code: "file_too_big", message: `${m.filename}: attachments must be ≤ 10 MB.` });
    return { ok: !issues.some((i) => i.level === "error"), issues, format: target.media.length ? "attachments" : "text" };
  },
  async publish(ctx, target): Promise<PublishResult> {
    const botToken = token(ctx);
    const content = target.body + (target.link ? `\n${target.link}` : "");
    let msg: { id: string; channel_id: string };
    if (!target.media.length) {
      msg = await call(botToken, "POST", `/channels/${ctx.externalAccountId}/messages`, { content });
    } else {
      const form = new FormData();
      const attachments = target.media.map((m, i) => ({ id: i, filename: m.filename, description: m.altText ?? undefined }));
      form.set("payload_json", JSON.stringify({ content, attachments }));
      for (let i = 0; i < target.media.length; i++) {
        const m = target.media[i]!;
        form.set(`files[${i}]`, new Blob([new Uint8Array(await m.read())], { type: m.mimeType }), m.filename);
      }
      msg = await call(botToken, "POST", `/channels/${ctx.externalAccountId}/messages`, form);
    }
    const guildId = ctx.metadata.guildId as string | undefined;
    return { status: "published", remotePostId: msg.id, remoteUrl: guildId ? `https://discord.com/channels/${guildId}/${msg.channel_id}/${msg.id}` : null };
  },
  async getPublishStatus(ctx, remotePostId) {
    try {
      await call(token(ctx), "GET", `/channels/${ctx.externalAccountId}/messages/${remotePostId}`);
      return { status: "published" };
    } catch (err) {
      if (err instanceof ProviderError && err.options.category === "not_found") return { status: "deleted" };
      return { status: "unknown", error: (err as Error).message };
    }
  },
  async deletePost(ctx, remotePostId) {
    await call(token(ctx), "DELETE", `/channels/${ctx.externalAccountId}/messages/${remotePostId}`);
  },
};
