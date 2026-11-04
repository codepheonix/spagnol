import { prisma } from "@sm/db";
import { apiUser, handle, json, HttpError } from "@/lib/api";

export const GET = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const acc = await prisma.socialAccount.findFirst({ where: { id, brand: { ownerId: user.id } } });
  if (!acc) throw new HttpError(404, "Account not found.", "not_found");
  const meta = acc.metadata as { capabilities?: unknown; healthDetails?: unknown };
  return json({ status: acc.status, healthStatus: acc.healthStatus, lastCheckedAt: acc.lastCheckedAt, lastError: acc.lastError, tokenExpiresAt: acc.tokenExpiresAt, capabilities: meta.capabilities ?? null, details: meta.healthDetails ?? null });
});
