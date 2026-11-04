import { z } from "zod";
import { prisma } from "@sm/db";
import { hashPassword, verifyPassword } from "@sm/security";
import { audit } from "@sm/core";
import { apiUser, handle, json, parseJson, HttpError } from "@/lib/api";

const schema = z.object({ currentPassword: z.string(), newPassword: z.string().min(10).max(200) });

export const POST = handle(async (req) => {
  const user = await apiUser();
  const { currentPassword, newPassword } = await parseJson(req, schema);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new HttpError(403, "Current password is wrong.", "bad_password");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
  await audit({ actorUserId: user.id, action: "auth.password_change" });
  return json({ ok: true });
});
