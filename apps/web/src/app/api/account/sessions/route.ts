import { listSessions, revokeOtherSessions } from "@sm/core";
import { apiSession, handle, json } from "@/lib/api";

export const GET = handle(async () => {
  const { user, session } = await apiSession({ gate: false });
  return json({ sessions: await listSessions(user.id, session.id) });
});

/** Signs out every other browser. */
export const DELETE = handle(async () => {
  const { user, session } = await apiSession({ gate: false });
  return json({ ok: true, ended: await revokeOtherSessions(user.id, session.id) });
});
