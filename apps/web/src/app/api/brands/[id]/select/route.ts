import { cookies } from "next/headers";
import { prisma } from "@sm/db";
import { apiUser, handle, json, HttpError } from "@/lib/api";
import { BRAND_COOKIE } from "@/lib/auth";

export const POST = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const brand = await prisma.brand.findFirst({ where: { id, ownerId: user.id, archivedAt: null } });
  if (!brand) throw new HttpError(404, "Brand not found.", "not_found");
  (await cookies()).set(BRAND_COOKIE, brand.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return json({ ok: true, brand });
});
