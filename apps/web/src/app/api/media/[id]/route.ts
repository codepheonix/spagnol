import { z } from "zod";
import { prisma } from "@sm/db";
import { deleteMedia } from "@sm/core";
import { getStorage } from "@sm/media";
import { apiUser, handle, json, parseJson, HttpError } from "@/lib/api";

/** Streams the private object to the signed-in owner (preview). */
export const GET = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const asset = await prisma.mediaAsset.findFirst({ where: { id, brand: { ownerId: user.id } } });
  if (!asset) throw new HttpError(404, "Not found.", "not_found");
  const bytes = await getStorage().get(asset.storageKey);
  return new Response(new Uint8Array(bytes), { headers: { "content-type": asset.mimeType, "cache-control": "private, max-age=3600", "content-disposition": `inline; filename="${asset.originalName}"` } });
});

export const PATCH = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const asset = await prisma.mediaAsset.findFirst({ where: { id, brand: { ownerId: user.id } } });
  if (!asset) throw new HttpError(404, "Not found.", "not_found");
  const input = await parseJson(req, z.object({ altText: z.string().max(1000).optional().nullable(), caption: z.string().max(2200).optional().nullable() }));
  return json({ media: await prisma.mediaAsset.update({ where: { id }, data: input }) });
});

export const DELETE = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const asset = await prisma.mediaAsset.findFirst({ where: { id, brand: { ownerId: user.id } } });
  if (!asset) throw new HttpError(404, "Not found.", "not_found");
  await deleteMedia(asset.brandId, id);
  return json({ ok: true });
});
