import { prisma } from "@sm/db";
import { retryDeadJob, audit } from "@sm/core";
import { apiUser, handle, json, HttpError } from "@/lib/api";

/** Retries a failed background job — only one that belongs to a workspace of the signed-in user (or to no workspace). */
export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const mine = await prisma.job.findFirst({ where: { id, OR: [{ brandId: null }, { brand: { ownerId: user.id } }] }, select: { id: true } });
  if (!mine) throw new HttpError(404, "Job not found.", "not_found");
  const job = await retryDeadJob(id);
  await audit({ actorUserId: user.id, action: "job.retry", targetType: "job", targetId: id });
  return json({ job });
});
