import { createHash, randomUUID } from "node:crypto";
import { prisma, type MediaAsset } from "@sm/db";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, getStorage, probeMedia, safeFilename } from "@sm/media";
import type { MediaRef } from "@sm/integrations";
import { AppError } from "./connections";

export async function createMediaFromBytes(input: { brandId: string; filename: string; mimeType: string; bytes: Buffer; altText?: string | null }): Promise<MediaAsset> {
  const probe = probeMedia(input.bytes, input.mimeType);
  const filename = safeFilename(input.filename);
  const key = `brands/${input.brandId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${filename}`;
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const asset = await prisma.mediaAsset.create({ data: { brandId: input.brandId, storageKey: key, originalName: filename, mimeType: probe.detectedMime ?? input.mimeType, sizeBytes: input.bytes.length, width: probe.width, height: probe.height, checksum, altText: input.altText ?? null, status: probe.ok ? "processing" : "failed", error: probe.ok ? null : probe.error } });
  if (!probe.ok) return asset;
  try {
    await getStorage().put(key, input.bytes, asset.mimeType);
    return prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "ready" } });
  } catch (err) {
    return prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "failed", error: (err as Error).message } });
  }
}

/** Step 1 of a browser-direct upload: reserve the asset and return a signed PUT URL (null when the driver cannot sign). */
export async function presignMediaUpload(input: { brandId: string; filename: string; mimeType: string; sizeBytes: number; altText?: string | null }): Promise<{ asset: MediaAsset; uploadUrl: string | null }> {
  if (!ALLOWED_MIME.has(input.mimeType)) throw new AppError(`Unsupported file type ${input.mimeType}.`, 415, "unsupported_type");
  if (input.sizeBytes > MAX_UPLOAD_BYTES) throw new AppError("File too large.", 413, "too_big");
  const filename = safeFilename(input.filename);
  const key = `brands/${input.brandId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${filename}`;
  const uploadUrl = await getStorage().signedPutUrl(key, input.mimeType, 900);
  const asset = await prisma.mediaAsset.create({ data: { brandId: input.brandId, storageKey: key, originalName: filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes, altText: input.altText ?? null, status: "received" } });
  return { asset, uploadUrl };
}

/** Step 2: the browser finished the PUT; download, sniff and measure before marking `ready`. */
export async function finalizeMediaUpload(brandId: string, mediaId: string): Promise<MediaAsset> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, brandId } });
  if (!asset) throw new AppError("Media not found.", 404, "not_found");
  if (asset.status === "ready") return asset;
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "processing" } });
  let bytes: Buffer;
  try {
    bytes = await getStorage().get(asset.storageKey);
  } catch (err) {
    return prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "failed", error: `upload not found in storage: ${(err as Error).message}` } });
  }
  const probe = probeMedia(bytes, asset.mimeType);
  if (!probe.ok) {
    await getStorage().delete(asset.storageKey).catch(() => undefined);
    return prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "failed", error: probe.error } });
  }
  return prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "ready", mimeType: probe.detectedMime ?? asset.mimeType, sizeBytes: bytes.length, width: probe.width, height: probe.height, checksum: createHash("sha256").update(bytes).digest("hex"), error: null } });
}

/** Builds adapter-facing media references; refuses media that is not `ready`. */
export async function mediaRefsFor(assets: MediaAsset[]): Promise<MediaRef[]> {
  const storage = getStorage();
  return assets.map((a) => {
    if (a.status !== "ready") throw new AppError(`Media ${a.originalName} is not ready (${a.status}).`, 409, "media_not_ready");
    return {
      id: a.id,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      width: a.width,
      height: a.height,
      durationMs: a.durationMs,
      altText: a.altText,
      filename: a.originalName,
      read: () => storage.get(a.storageKey),
      signedUrl: storage.name !== "local" ? () => storage.signedGetUrl(a.storageKey, 3600) : undefined,
    };
  });
}

export async function deleteMedia(brandId: string, mediaId: string): Promise<void> {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaId, brandId } });
  if (!asset) throw new AppError("Media not found.", 404, "not_found");
  const used = await prisma.postMedia.count({ where: { mediaId } });
  if (used) throw new AppError("Media is attached to a post; remove it from the post first.", 409, "media_in_use");
  await getStorage().delete(asset.storageKey).catch(() => undefined);
  await prisma.mediaAsset.delete({ where: { id: mediaId } });
}

/** Removes uploads that failed or were never attached after N days. */
export async function cleanupOrphanMedia(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const orphans = await prisma.mediaAsset.findMany({ where: { createdAt: { lt: cutoff }, postMedia: { none: {} } }, take: 200 });
  for (const a of orphans) {
    await getStorage().delete(a.storageKey).catch(() => undefined);
    await prisma.mediaAsset.delete({ where: { id: a.id } });
  }
  return orphans.length;
}
