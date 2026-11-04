import { z } from "zod";
import { replyToComment } from "@sm/core";
import { apiUser, handle, json, parseJson } from "@/lib/api";

export const POST = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const { body } = await parseJson(req, z.object({ body: z.string().min(1).max(2200) }));
  return json(await replyToComment(user.id, id, body), { status: 201 });
});
