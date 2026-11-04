import { prisma } from "@sm/db";
import { apiUser, handle, json, HttpError } from "@/lib/api";

export const GET = handle(async (_req, { params }) => {
  const user = await apiUser();
  const { id } = await params;
  const thread = await prisma.inboxThread.findFirst({ where: { id, brand: { ownerId: user.id } } });
  if (!thread) throw new HttpError(404, "Not found.", "not_found");
  const messages = await prisma.inboxMessage.findMany({ where: { threadId: id }, orderBy: { sentAt: "asc" } });
  await prisma.inboxThread.update({ where: { id }, data: { unreadCount: 0 } });
  return json({ thread, messages });
});
