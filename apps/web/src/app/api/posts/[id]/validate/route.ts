import { validatePost } from "@sm/core";
import { apiUser, handle, json } from "@/lib/api";

export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  return json(await validatePost(user.id, id));
});
