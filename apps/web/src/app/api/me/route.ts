import { prisma } from "@sm/db";
import { apiUser, handle, json } from "@/lib/api";
import { getActiveBrand } from "@/lib/auth";

export const GET = handle(async () => {
  const user = await apiUser();
  const brand = await getActiveBrand(user);
  const brands = await prisma.brand.findMany({ where: { ownerId: user.id, archivedAt: null }, orderBy: { createdAt: "asc" } });
  return json({ user: { id: user.id, email: user.email, name: user.name, timezone: user.timezone, locale: user.locale }, activeBrandId: brand?.id ?? null, brands });
});
