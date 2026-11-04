import { deletePublishedTarget } from "@sm/core";
import { apiUser, handle, json } from "@/lib/api";

export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id, targetId } = await params;
  await deletePublishedTarget(user.id, id, targetId);
  return json({ ok: true });
});
