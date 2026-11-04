import { analyticsOverview } from "@sm/core";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  return json({ accounts: await analyticsOverview(brand.id) });
});
