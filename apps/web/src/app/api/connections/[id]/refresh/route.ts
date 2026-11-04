import { prisma } from "@sm/db";
import { checkAccountHealth } from "@sm/core";
import { apiUser, handle, json, HttpError } from "@/lib/api";

export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const acc = await prisma.socialAccount.findFirst({ where: { id, brand: { ownerId: user.id } } });
  if (!acc) throw new HttpError(404, "Account not found.", "not_found");
  const updated = await checkAccountHealth(acc.id);
  return json({ account: updated });
});
