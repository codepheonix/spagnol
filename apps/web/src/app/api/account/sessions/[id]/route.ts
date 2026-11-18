import { revokeSession } from "@sm/core";
import { apiSession, handle, json, HttpError } from "@/lib/api";

/** Ends one of the caller's own sessions. Another account's session id answers "not found". */
export const DELETE = handle(async (_req, { params }) => {
  const { user } = await apiSession({ gate: false });
  const { id } = await params;
  if (!(await revokeSession(user.id, id))) throw new HttpError(404, "Session not found.", "not_found");
  return json({ ok: true });
});
