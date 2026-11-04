import { prisma } from "@sm/db";
import { apiBrand, apiUser, handle, json } from "@/lib/api";

export const GET = handle(async (req) => {
  const user = await apiUser();
  const brand = await apiBrand(user, new URL(req.url).searchParams.get("brandId"));
  return json({ reviews: await prisma.review.findMany({ where: { brandId: brand.id }, orderBy: { remoteCreatedAt: "desc" }, take: 100 }), note: "Reviews arrive from Google Business Profile accounts (Zernio backend) once connected." });
});
