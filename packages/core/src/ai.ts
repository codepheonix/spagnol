/**
 * Optional AI assistance (OpenRouter-compatible chat completions). Only produces DRAFTS the
 * owner reviews; it never publishes or messages anyone by itself.
 */
import { http } from "@sm/integrations";
import { getAiConfig } from "./settings";
import { AppError } from "./connections";

export interface DraftRequest {
  brandName: string;
  /** Workspace profile, all optional. Nothing about any particular company is built into the prompt. */
  industry?: string | null;
  description?: string | null;
  brandVoice?: string | null;
  targetAudience?: string | null;
  brief: string;
  platform: string;
  language: "it" | "en";
  tone?: string;
  maxLength?: number;
  hashtags?: boolean;
}

export async function generateDraft(input: DraftRequest): Promise<{ text: string; model: string }> {
  const cfg = await getAiConfig();
  if (!cfg) throw new AppError("AI is not configured (Settings → AI API key).", 412, "ai_not_configured");
  const profile = [
    input.industry ? `Industry: ${input.industry}.` : "",
    input.description ? `About: ${input.description}` : "",
    input.brandVoice ? `Voice: ${input.brandVoice}` : "",
    input.targetAudience ? `Audience: ${input.targetAudience}` : "",
  ].filter(Boolean).join(" ");
  const system = `You write social media posts for ${input.brandName}. ${profile} Use only what is stated here and in the brief; do not invent facts, prices or claims. Write in ${input.language === "it" ? "Italian" : "English"} for ${input.platform}. ${input.tone ? `Tone: ${input.tone}.` : ""} Keep under ${input.maxLength ?? 2200} characters. ${input.hashtags ? "Add 3–8 relevant hashtags at the end." : "No hashtags."} Return only the post text.`;
  const res = await http<{ choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }>(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}`, "http-referer": process.env.PUBLIC_APP_URL ?? "http://localhost:3000", "x-title": "iGerald" },
    json: { model: cfg.model, messages: [{ role: "system", content: system }, { role: "user", content: input.brief }], temperature: 0.7, max_tokens: 800 },
    timeoutMs: 60_000,
  });
  const text = res.data?.choices?.[0]?.message?.content?.trim();
  if (res.status !== 200 || !text) throw new AppError(`AI request failed: ${res.data?.error?.message ?? res.status}`, 502, "ai_error");
  return { text, model: cfg.model };
}
