/** Plain-language labels for the status values stored in the database. */

export const POST_LABEL: Record<string, string> = {
  draft: "Draft",
  validated: "Ready",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  partial: "Partly published",
  failed: "Failed",
  canceled: "Canceled",
};

export function targetLabel(status: string, errorCategory?: string | null): string {
  switch (status) {
    case "pending":
      return "Not sent";
    case "blocked":
      return "Needs a fix";
    case "queued":
      return "Scheduled";
    case "uploading":
      return "Publishing";
    case "processing":
      return "Checking publication";
    case "published":
      return "Published";
    case "failed_retryable":
      return errorCategory === "uncertain" ? "Checking publication" : "Retrying";
    case "failed_permanent":
      return errorCategory === "uncertain" ? "Needs your check" : "Failed";
    case "needs_reconnect":
      return "Reconnect needed";
    case "canceled":
      return "Canceled";
    default:
      return status;
  }
}

export const CONNECTION_LABEL: Record<string, string> = {
  connected: "Connected",
  needs_reconnect: "Reconnect needed",
  disconnected: "Disconnected",
  error: "Problem",
};

export const PROVIDER_NAME: Record<string, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram",
  telegram: "Telegram",
  bluesky: "Bluesky",
  discord: "Discord",
  slack: "Slack",
  threads: "Threads",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  x: "X (Twitter)",
  reddit: "Reddit",
  googlebusiness: "Google Business",
  whatsapp: "WhatsApp",
  snapchat: "Snapchat",
};
