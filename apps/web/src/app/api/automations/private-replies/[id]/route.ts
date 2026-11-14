import { z } from "zod";
import { deletePrivateReplyRule, updatePrivateReplyRule } from "@sm/core";
import { apiUser, handle, HttpError, json, parseJson } from "@/lib/api";

const patch = z.object({ enabled: z.boolean().optional(), keyword: z.string().min(1).max(60).optional(), replyText: z.string().min(1).max(1000).optional() });

export const PATCH = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const input = await parseJson(req, patch);
  try {
    return json({ rule: await updatePrivateReplyRule(user.id, id, input) });
  } catch (err) {
    throw new HttpError(404, (err as Error).message, "not_found");
  }
});

export const DELETE = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  try {
    await deletePrivateReplyRule(user.id, id);
    return json({ ok: true });
  } catch (err) {
    throw new HttpError(404, (err as Error).message, "not_found");
  }
});
