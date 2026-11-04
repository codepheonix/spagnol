import { disconnectAccount } from "@sm/core";
import { apiUser, handle, json } from "@/lib/api";

export const DELETE = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const revoke = new URL(req.url).searchParams.get("revoke") !== "0";
  await disconnectAccount({ socialAccountId: id, userId: user.id, revokeRemote: revoke });
  return json({ ok: true });
});
