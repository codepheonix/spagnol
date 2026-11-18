import { z } from "zod";
import { hasRecentAuth, setCampaignStatus } from "@sm/core";
import { apiSession, HttpError, handle, json, parseJson } from "@/lib/api";

export const PATCH = handle(async (req, { params }) => {
  const { user, session } = await apiSession();
  const { id } = await params;
  const { status } = await parseJson(req, z.object({ status: z.enum(["active", "paused"]) }));
  // Pausing is always allowed at once; starting to spend needs a recently confirmed password.
  if (status === "active" && !hasRecentAuth(session)) throw new HttpError(403, "Confirm your password to continue.", "reauth_required");
  await setCampaignStatus(user.id, id, status);
  return json({ ok: true, status });
});
