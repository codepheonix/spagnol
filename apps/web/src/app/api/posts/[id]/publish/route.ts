import { schedulePost } from "@sm/core";
import { apiUser, handle, json } from "@/lib/api";

export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  return json({ post: await schedulePost(user.id, id, { now: true }) });
});
