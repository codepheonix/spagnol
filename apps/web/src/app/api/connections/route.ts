import { prisma } from "@sm/db";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  const accounts = await prisma.socialAccount.findMany({ where: { brandId: brand.id }, orderBy: [{ provider: "asc" }, { createdAt: "asc" }] });
  return json({ accounts: accounts.map((a) => ({ ...a, metadata: { ...(a.metadata as object), capabilities: (a.metadata as { capabilities?: unknown }).capabilities } })) });
});
