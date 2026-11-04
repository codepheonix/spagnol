import { z } from "zod";
import { prisma } from "@sm/db";
import { apiUser, handle, json, parseJson, HttpError } from "@/lib/api";

export const PATCH = handle(async (req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const slot = await prisma.scheduleSlot.findFirst({ where: { id, brand: { ownerId: user.id } } });
  if (!slot) throw new HttpError(404, "Slot not found.", "not_found");
  const input = await parseJson(req, z.object({ active: z.boolean().optional(), time: z.string().regex(/^\d{2}:\d{2}$/).optional(), weekday: z.number().int().min(0).max(6).optional() }));
  return json({ slot: await prisma.scheduleSlot.update({ where: { id }, data: input }) });
});

export const DELETE = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const slot = await prisma.scheduleSlot.findFirst({ where: { id, brand: { ownerId: user.id } } });
  if (!slot) throw new HttpError(404, "Slot not found.", "not_found");
  await prisma.scheduleSlot.delete({ where: { id } });
  return json({ ok: true });
});
