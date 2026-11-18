/**
 * The platforms shown in Social Connections. Glyphs come from Font Awesome's brand set and are
 * rendered unaltered (single colour, original proportions): the 3D treatment lives in the card and
 * the medallion around the glyph, never in the mark itself.
 *
 * `built: false` means this app has no connection for that platform yet. Those cards say so; they
 * never show a Connect button.
 */
import { faBluesky, faDiscord, faFacebook, faGoogle, faInstagram, faLinkedin, faMeta, faPinterest, faSlack, faTelegram, faThreads, faTiktok, faXTwitter, faYoutube } from "@fortawesome/free-brands-svg-icons";
import type { IconDefinition } from "@fortawesome/free-brands-svg-icons";

export interface Platform {
  id: string;
  name: string;
  tint: string;
  icon: IconDefinition;
  covers: string;
  built: boolean;
  /** Shown instead of a Connect button when `built` is false. */
  note?: string;
  /** How an account of this platform is authorised. */
  method?: string;
}

export const PLATFORMS: Platform[] = [
  { id: "instagram", name: "Instagram", tint: "#d62976", icon: faInstagram, covers: "Posts, Reels, comments, comment-to-DM, insights", built: true, method: "Meta's own sign-in. Publishing needs a Business or Creator account." },
  { id: "facebook", name: "Facebook", tint: "#1877f2", icon: faFacebook, covers: "Page posts, comments, Messenger replies, insights", built: true, method: "Facebook sign-in, then you choose the Pages to manage." },
  { id: "meta_ads", name: "Meta", tint: "#0668e1", icon: faMeta, covers: "Ad accounts for Facebook and Instagram advertising", built: false, note: "Ad accounts are read through the optional Zernio gateway today. The direct Meta ads connection is not built yet." },
  { id: "tiktok", name: "TikTok", tint: "#14161b", icon: faTiktok, covers: "Video publishing", built: false, note: "No TikTok connection in this app yet." },
  { id: "youtube", name: "YouTube", tint: "#ff0033", icon: faYoutube, covers: "Videos and Shorts", built: false, note: "No YouTube connection in this app yet." },
  { id: "linkedin", name: "LinkedIn", tint: "#0a66c2", icon: faLinkedin, covers: "Company page and profile posts", built: false, note: "No LinkedIn connection in this app yet." },
  { id: "threads", name: "Threads", tint: "#14161b", icon: faThreads, covers: "Text and image posts", built: false, note: "No Threads connection in this app yet." },
  { id: "pinterest", name: "Pinterest", tint: "#e60023", icon: faPinterest, covers: "Pins and boards", built: false, note: "No Pinterest connection in this app yet." },
  { id: "x", name: "X", tint: "#14161b", icon: faXTwitter, covers: "Posts and threads", built: false, note: "No X connection in this app yet." },
  { id: "telegram", name: "Telegram", tint: "#26a5e4", icon: faTelegram, covers: "Channel and group posts", built: true, method: "A bot token from BotFather, added as admin of your channel." },
  { id: "bluesky", name: "Bluesky", tint: "#0085ff", icon: faBluesky, covers: "Posts with images", built: true, method: "Your handle and an app password (not your main password)." },
  { id: "discord", name: "Discord", tint: "#5865f2", icon: faDiscord, covers: "Channel messages", built: true, method: "A channel webhook URL." },
  { id: "slack", name: "Slack", tint: "#4a154b", icon: faSlack, covers: "Channel messages", built: true, method: "An incoming webhook URL." },
  { id: "googlebusiness", name: "Google Business", tint: "#4285f4", icon: faGoogle, covers: "Business profile posts and reviews", built: false, note: "No Google Business connection in this app yet." },
];

export const platformById = (id: string): Platform | undefined => PLATFORMS.find((p) => p.id === id);
