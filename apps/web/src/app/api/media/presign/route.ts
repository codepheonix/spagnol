import { z } from "zod";
import { presignMediaUpload } from "@sm/core";
import { apiBrand, apiUser, handle, json, parseJson } from "@/lib/api";

const schema = z.object({ brandId: z.string().optional(), filename: z.string().min(1).max(200), mimeType: z.string().min(3).max(100), sizeBytes: z.number().int().positive(), altText: z.string().max(1000).optional().nullable() });

/** Browser-direct upload: returns a short-lived signed PUT URL (or `uploadUrl: null` → use multipart POST /api/media). */
export const POST = handle(async (req) => {
  const user = await apiUser();
  const input = await parseJson(req, schema);
  const brand = await apiBrand(user, input.brandId);
  const r = await presignMediaUpload({ brandId: brand.id, filename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes, altText: input.altText });
  return json({ mediaId: r.asset.id, uploadUrl: r.uploadUrl }, { status: 201 });
});
