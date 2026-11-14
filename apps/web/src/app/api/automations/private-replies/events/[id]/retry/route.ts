import { registerAllHandlers, processDueJobs, retryPrivateReply } from "@sm/core";
import { apiUser, handle, HttpError, json } from "@/lib/api";

/** Owner-initiated retry of a failed/uncertain private reply (after checking the inbox). */
export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  try {
    await retryPrivateReply(user.id, id);
  } catch (err) {
    throw new HttpError(409, (err as Error).message, "conflict");
  }
  registerAllHandlers();
  await processDueJobs(`retry-${process.pid}`, 3).catch(() => undefined);
  return json({ ok: true });
});
