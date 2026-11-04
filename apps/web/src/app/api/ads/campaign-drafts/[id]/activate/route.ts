import { z } from "zod";
import { activateDraft } from "@sm/core";
import { apiUser, handle, json, parseJson } from "@/lib/api";

export const POST = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const { confirmationToken } = await parseJson(req, z.object({ confirmationToken: z.string() }));
  await activateDraft(user.id, id, confirmationToken);
  return json({ ok: true });
});
