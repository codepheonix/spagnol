import { getPost, postInputSchema, updatePost } from "@sm/core";
import { apiUser, handle, json, parseJson } from "@/lib/api";

export const GET = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  return json({ post: await getPost(user.id, id) });
});

export const PATCH = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const input = await parseJson(req, postInputSchema);
  return json({ post: await updatePost(user.id, id, input) });
});
