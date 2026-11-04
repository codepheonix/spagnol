import { imageSize } from "image-size";

export const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "video/webm", "application/pdf"]);
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 300 * 1024 * 1024);

export interface MediaProbe {
  ok: boolean;
  error?: string;
  width?: number;
  height?: number;
  detectedMime?: string;
}

/** Sniffs magic bytes so a renamed .exe cannot masquerade as a JPEG. */
export function sniffMime(bytes: Buffer): string | undefined {
  if (bytes.length < 12) return undefined;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("ascii");
    if (brand.startsWith("qt")) return "video/quicktime";
    return "video/mp4";
  }
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return undefined;
}

export function probeMedia(bytes: Buffer, declaredMime: string): MediaProbe {
  if (!ALLOWED_MIME.has(declaredMime)) return { ok: false, error: `Unsupported file type ${declaredMime}.` };
  if (bytes.length === 0) return { ok: false, error: "Empty file." };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: `File exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` };
  const detected = sniffMime(bytes);
  if (!detected) return { ok: false, error: "File content not recognised as an image, video or PDF." };
  const family = (m: string) => m.split("/")[0];
  if (family(detected) !== family(declaredMime) && !(detected === "video/mp4" && declaredMime === "video/quicktime")) return { ok: false, error: `File content (${detected}) does not match the declared type (${declaredMime}).`, detectedMime: detected };
  if (detected.startsWith("image/")) {
    try {
      const dim = imageSize(bytes);
      return { ok: true, width: dim.width, height: dim.height, detectedMime: detected };
    } catch {
      return { ok: false, error: "Could not read image dimensions.", detectedMime: detected };
    }
  }
  return { ok: true, detectedMime: detected };
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "file";
}
