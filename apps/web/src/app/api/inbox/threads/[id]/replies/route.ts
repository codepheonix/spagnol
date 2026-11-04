import { z } from "zod";
import { replyToThread } from "@sm/core";
import { apiUser, handle, json, parseJson } from "@/lib/api";

export const POST = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const { body } = await parseJson(req, z.object({ body: z.string().min(1).max(4000) }));
  return json(await replyToThread(user.id, id, body), { status: 201 });
});
