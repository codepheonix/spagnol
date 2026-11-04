import { prisma } from "@sm/db";
import { finalizeMediaUpload } from "@sm/core";
import { apiUser, handle, json, HttpError } from "@/lib/api";

export const maxDuration = 120;

export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const asset = await prisma.mediaAsset.findFirst({ where: { id, brand: { ownerId: user.id } } });
  if (!asset) throw new HttpError(404, "Not found.", "not_found");
  return json({ media: await finalizeMediaUpload(asset.brandId, id) });
});
