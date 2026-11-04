import { prisma } from "@sm/db";
import { apiUser, handle, json } from "@/lib/api";

export const GET = handle(async () => {
  const user = await apiUser();
  const accounts = await prisma.socialAccount.findMany({ where: { brand: { ownerId: user.id } }, select: { id: true, brandId: true, provider: true, backend: true, displayName: true, status: true, healthStatus: true, lastCheckedAt: true, lastError: true, tokenExpiresAt: true } });
  return json({ accounts, summary: { total: accounts.length, connected: accounts.filter((a) => a.status === "connected").length, needsReconnect: accounts.filter((a) => a.status === "needs_reconnect").length, error: accounts.filter((a) => a.status === "error").length } });
});
