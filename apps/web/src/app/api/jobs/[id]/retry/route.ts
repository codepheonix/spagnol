import { retryDeadJob, audit } from "@sm/core";
import { apiUser, handle, json } from "@/lib/api";

export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const job = await retryDeadJob(id);
  await audit({ actorUserId: user.id, action: "job.retry", targetType: "job", targetId: id });
  return json({ job });
});
