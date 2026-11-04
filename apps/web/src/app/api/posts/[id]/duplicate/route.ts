import { duplicatePost } from "@sm/core";
import { apiUser, handle, json } from "@/lib/api";

export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  return json({ post: await duplicatePost(user.id, id) }, { status: 201 });
});
