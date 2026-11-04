import { prisma, type JobStatus } from "@sm/db";
import { apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  await apiUser();
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as JobStatus | null;
  const jobs = await prisma.job.findMany({ where: { status: status ?? undefined }, orderBy: [{ status: "asc" }, { runAt: "desc" }], take: 100, select: { id: true, type: true, status: true, runAt: true, attempts: true, maxAttempts: true, lastError: true, lockedBy: true, lockedAt: true, finishedAt: true, dedupeKey: true, brandId: true, createdAt: true } });
  return json({ jobs });
});
