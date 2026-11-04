import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies an HMAC-SHA256 signature over the raw request body.
 * Accepts `hex`, `sha256=hex` and base64 encodings (providers differ).
 */
export function verifyHmacSignature(secret: string, rawBody: string | Buffer, header: string | null | undefined): boolean {
  if (!header || !secret) return false;
  const provided = header.replace(/^sha256=/i, "").trim();
  const mac = createHmac("sha256", secret).update(rawBody);
  const digest = mac.digest();
  const candidates = [digest.toString("hex"), digest.toString("base64")];
  return candidates.some((c) => {
    const a = Buffer.from(c);
    const b = Buffer.from(provided);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** Meta-style `X-Hub-Signature-256: sha256=<hex>` verification. */
export function verifyMetaSignature(appSecret: string, rawBody: string | Buffer, header: string | null | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  return verifyHmacSignature(appSecret, rawBody, header);
}

/**
 * Telegram webhook secret check (`X-Telegram-Bot-Api-Secret-Token`).
 */
export function verifyTelegramSecret(expected: string, header: string | null | undefined): boolean {
  if (!expected || !header) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
