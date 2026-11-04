import { prisma } from "@sm/db";
import { createMediaFromBytes } from "@sm/core";
import { MAX_UPLOAD_BYTES } from "@sm/media";
import { apiBrand, apiUser, handle, json, HttpError } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  const assets = await prisma.mediaAsset.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: "desc" }, take: 200 });
  return json({ media: assets });
});

/** multipart/form-data upload: file (required), altText (optional). Validated by magic bytes + limits. */
export const POST = handle(async (req) => {
  const user = await apiUser();
  const form = await req.formData();
  const brand = await apiBrand(user, (form.get("brandId") as string | null) ?? null);
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, "No file.", "no_file");
  const out = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, `${file.name} exceeds the upload limit.`, "too_big");
    const bytes = Buffer.from(await file.arrayBuffer());
    out.push(await createMediaFromBytes({ brandId: brand.id, filename: file.name, mimeType: file.type || "application/octet-stream", bytes, altText: (form.get("altText") as string | null) ?? null }));
  }
  return json({ media: out }, { status: 201 });
});
