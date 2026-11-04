import { prisma } from "@sm/db";
import { queueStats } from "@sm/core";
import { apiUser, handle, json } from "@/lib/api";

export const GET = handle(async () => {
  await apiUser();
  const stats = await queueStats();
  const heartbeats = await prisma.systemSetting.findMany({ where: { key: { startsWith: "worker.heartbeat." } } });
  const workers = heartbeats.map((h) => ({ id: h.key.replace("worker.heartbeat.", ""), lastSeenAt: (h.value as { at?: string }).at ?? null }));
  const dead = await prisma.job.findMany({ where: { status: "dead" }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, type: true, lastError: true, attempts: true, updatedAt: true, payload: true } });
  const lastTick = await prisma.systemSetting.findUnique({ where: { key: "jobs.lastTick" } });
  return json({ stats, workers, dead, lastTick: lastTick?.value ?? null });
});
