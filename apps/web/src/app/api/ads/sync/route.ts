import { enqueue } from "@sm/core";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const POST = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  const job = await enqueue("sync_ads", { brandId: brand.id }, { dedupeKey: `ads:${brand.id}:${Math.floor(Date.now() / 60_000)}`, brandId: brand.id, priority: 5 });
  return json({ jobId: job.id });
});
