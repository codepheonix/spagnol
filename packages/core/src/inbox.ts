import { prisma } from "@sm/db";
import { adapterFor, AppError, buildAccountContext } from "./connections";
import { audit } from "./audit";

export async function syncComments(socialAccountId: string): Promise<{ upserted: number; unsupported?: boolean }> {
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: socialAccountId } });
  if (account.status !== "connected") return { upserted: 0 };
  const adapter = adapterFor(account);
  if (!adapter.fetchComments) return { upserted: 0, unsupported: true };
  const ctx = await buildAccountContext(account);
  const page = await adapter.fetchComments(ctx, {});
  let n = 0;
  for (const c of page.comments) {
    await prisma.comment.upsert({
      where: { socialAccountId_externalCommentId: { socialAccountId, externalCommentId: c.externalCommentId } },
      create: { brandId: account.brandId, socialAccountId, provider: account.provider, externalPostId: c.externalPostId, externalCommentId: c.externalCommentId, parentExternalId: c.parentExternalId ?? null, authorId: c.authorId ?? null, authorName: c.authorName ?? null, body: c.body, isOwner: c.isOwner ?? false, hidden: c.hidden ?? false, remoteCreatedAt: c.createdAt, metadata: (c.metadata ?? {}) as object },
      update: { body: c.body, hidden: c.hidden ?? false, authorName: c.authorName ?? null },
    });
    n++;
  }
  return { upserted: n };
}

export async function syncInbox(socialAccountId: string): Promise<{ threads: number; messages: number; unsupported?: boolean }> {
  const account = await prisma.socialAccount.findUniqueOrThrow({ where: { id: socialAccountId } });
  if (account.status !== "connected") return { threads: 0, messages: 0 };
  const adapter = adapterFor(account);
  if (!adapter.fetchInbox) return { threads: 0, messages: 0, unsupported: true };
  const ctx = await buildAccountContext(account);
  const page = await adapter.fetchInbox(ctx, null);
  let threads = 0;
  let messages = 0;
  for (const t of page.threads) {
    const thread = await prisma.inboxThread.upsert({
      where: { socialAccountId_externalThreadId: { socialAccountId, externalThreadId: t.externalThreadId } },
      create: { brandId: account.brandId, socialAccountId, provider: account.provider, externalThreadId: t.externalThreadId, participantId: t.participantId ?? null, participantName: t.participantName ?? null, participantUrl: t.participantUrl ?? null, lastMessageAt: t.lastMessageAt ?? null, lastMessageText: t.lastMessageText ?? null, unreadCount: t.unreadCount ?? 0, metadata: (t.metadata ?? {}) as object },
      update: { participantName: t.participantName ?? undefined, lastMessageAt: t.lastMessageAt ?? undefined, lastMessageText: t.lastMessageText ?? undefined, unreadCount: t.unreadCount ?? undefined },
    });
    threads++;
    for (const m of t.messages ?? []) {
      await prisma.inboxMessage.upsert({
        where: { threadId_externalMessageId: { threadId: thread.id, externalMessageId: m.externalMessageId } },
        create: { threadId: thread.id, externalMessageId: m.externalMessageId, direction: m.direction, body: m.body ?? null, attachments: (m.attachments ?? []) as object, senderName: m.senderName ?? null, sentAt: m.sentAt, metadata: (m.metadata ?? {}) as object },
        update: { body: m.body ?? null },
      });
      messages++;
    }
  }
  return { threads, messages };
}

export async function replyToComment(userId: string, commentId: string, body: string) {
  const comment = await prisma.comment.findFirst({ where: { id: commentId, brand: { ownerId: userId } }, include: { socialAccount: true } });
  if (!comment) throw new AppError("Comment not found.", 404, "not_found");
  const adapter = adapterFor(comment.socialAccount);
  if (!adapter.replyComment) throw new AppError("Replying is not supported by this network's API.", 400, "unsupported");
  const res = await adapter.replyComment(await buildAccountContext(comment.socialAccount), { externalPostId: comment.externalPostId, externalCommentId: comment.externalCommentId, body });
  await prisma.comment.update({ where: { id: comment.id }, data: { repliedAt: new Date() } });
  await prisma.comment.upsert({ where: { socialAccountId_externalCommentId: { socialAccountId: comment.socialAccountId, externalCommentId: res.externalCommentId } }, create: { brandId: comment.brandId, socialAccountId: comment.socialAccountId, provider: comment.provider, externalPostId: comment.externalPostId, externalCommentId: res.externalCommentId, parentExternalId: comment.externalCommentId, body, isOwner: true, remoteCreatedAt: new Date() }, update: {} });
  await audit({ actorUserId: userId, brandId: comment.brandId, action: "comment.reply", targetType: "comment", targetId: comment.id, details: { remoteId: res.externalCommentId } });
  return res;
}

export async function replyToThread(userId: string, threadId: string, body: string) {
  const thread = await prisma.inboxThread.findFirst({ where: { id: threadId, brand: { ownerId: userId } }, include: { socialAccount: true } });
  if (!thread) throw new AppError("Conversation not found.", 404, "not_found");
  const adapter = adapterFor(thread.socialAccount);
  if (!adapter.sendMessage) throw new AppError("Sending messages is not supported by this network's API.", 400, "unsupported");
  const res = await adapter.sendMessage(await buildAccountContext(thread.socialAccount), { externalThreadId: thread.externalThreadId, body });
  await prisma.inboxMessage.create({ data: { threadId: thread.id, externalMessageId: res.externalMessageId, direction: "outbound", body, sentAt: new Date(), deliveryStatus: "sent" } });
  await prisma.inboxThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date(), lastMessageText: body, unreadCount: 0 } });
  await audit({ actorUserId: userId, brandId: thread.brandId, action: "inbox.reply", targetType: "thread", targetId: thread.id, details: { remoteId: res.externalMessageId } });
  return res;
}
