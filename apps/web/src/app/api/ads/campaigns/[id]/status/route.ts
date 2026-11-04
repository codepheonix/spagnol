import { z } from "zod";
import { setCampaignStatus } from "@sm/core";
import { apiUser, handle, json, parseJson } from "@/lib/api";

export const PATCH = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const { status } = await parseJson(req, z.object({ status: z.enum(["active", "paused"]) }));
  await setCampaignStatus(user.id, id, status);
  return json({ ok: true, status });
});
