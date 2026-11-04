import { retryTarget } from "@sm/core";
import { apiUser, handle, json } from "@/lib/api";

export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id, targetId } = await params;
  return json({ target: await retryTarget(user.id, id, targetId) });
});
