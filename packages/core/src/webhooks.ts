import { prisma } from "@sm/db";
import { verifyHmacSignature } from "@sm/security";
import { enqueue } from "./queue";
import { getZernioConfig } from "./settings";
import { notify } from "./audit";
import { rollupPostStatus } from "./posts";

/**
 * Ingests a Zernio webhook delivery: verify signature (when a secret is configured), dedupe on
 * X-Zernio-Event-Id, store, then react (inbox sync, post status reconciliation).
 */
export async function ingestZernioWebhook(input: { rawBody: string; headers: Record<string, string | null | undefined> }): Promise<{ status: "stored" | "duplicate" | "rejected"; reason?: string }> {
  const z = await getZernioConfig();
  const eventId = input.headers["x-zernio-event-id"] ?? input.headers["x-late-event-id"];
  const eventType = input.headers["x-zernio-event"] ?? input.headers["x-late-event"] ?? "unknown";
  const signature = input.headers["x-zernio-signature"] ?? input.headers["x-late-signature"];
  let signatureValid = false;
  if (z?.webhookSecret) {
    signatureValid = verifyHmacSignature(z.webhookSecret, input.rawBody, signature);
    if (!signatureValid) return { status: "rejected", reason: "bad signature" };
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    return { status: "rejected", reason: "invalid json" };
  }
  const providerEventId = eventId ?? (typeof payload.id === "string" ? payload.id : null);
  if (!providerEventId) return { status: "rejected", reason: "missing event id" };
  try {
    await prisma.webhookEvent.create({ data: { provider: "zernio", providerEventId, eventType, headers: { "x-zernio-event": eventType } as object, payload: payload as object, signatureValid } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { status: "duplicate" };
    throw err;
  }
  await enqueue("process_webhook_event", { provider: "zernio", providerEventId }, { dedupeKey: `webhook:zernio:${providerEventId}`, priority: 5 });
  return { status: "stored" };
}

export async function processWebhookEventJob(provider: string, providerEventId: string): Promise<unknown> {
  const ev = await prisma.webhookEvent.findUnique({ where: { provider_providerEventId: { provider, providerEventId } } });
  if (!ev || ev.status === "processed") return { skipped: true };
  const payload = ev.payload as Record<string, unknown>;
  const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
  const type = ev.eventType ?? "";
  try {
    if (type.startsWith("post.")) {
      const zernioPostId = (data.postId as string | undefined) ?? (data.id as string | undefined) ?? ((data.post as { _id?: string } | undefined)?._id);
      if (zernioPostId) {
        const targets = await prisma.postTarget.findMany({ where: { remotePostId: zernioPostId }, include: { socialAccount: true } });
        for (const t of targets) {
          if (type === "post.published" || type === "post.platform.published") {
            const platforms = (data.platforms as Array<{ accountId?: string; platformPostUrl?: string; status?: string }> | undefined) ?? [];
            const mine = platforms.find((p) => p.accountId === t.socialAccount.gatewayAccountId);
            await prisma.postTarget.update({ where: { id: t.id }, data: { status: "published", publishedAt: new Date(), reconciledAt: new Date(), remoteUrl: mine?.platformPostUrl ?? (data.platformPostUrl as string | undefined) ?? t.remoteUrl } });
          } else if (type === "post.failed" || type === "post.platform.failed") {
            await prisma.postTarget.update({ where: { id: t.id }, data: { status: "failed_permanent", lastError: (data.error as string | undefined) ?? (data.errorMessage as string | undefined) ?? "failed (webhook)" } });
            await notify({ brandId: t.socialAccount.brandId, level: "error", title: `Publishing failed on ${t.socialAccount.displayName}`, link: `/posts/${t.postId}` });
          } else {
            await enqueue("reconcile_target", { postTargetId: t.id }, { dedupeKey: `reconcile:${t.id}`, maxAttempts: 20 });
          }
          await rollupPostStatus(t.postId);
        }
      }
    } else if (type === "comment.received" || type === "message.received" || type === "conversation.started" || type === "review.new") {
      const gatewayAccountId = (data.accountId as string | undefined) ?? ((data.account as { _id?: string } | undefined)?._id);
      const account = gatewayAccountId ? await prisma.socialAccount.findFirst({ where: { gatewayAccountId } }) : null;
      if (account) {
        await enqueue(type === "comment.received" ? "sync_comments" : "sync_inbox", { socialAccountId: account.id }, { dedupeKey: `${type === "comment.received" ? "comments" : "inbox"}:${account.id}:${Math.floor(Date.now() / 60_000)}`, brandId: account.brandId });
        if (type !== "comment.received") await notify({ brandId: account.brandId, title: `New message on ${account.displayName}`, link: "/inbox" });
        else await notify({ brandId: account.brandId, title: `New comment on ${account.displayName}`, link: "/inbox?tab=comments" });
      }
    } else if (type === "account.disconnected" || type === "account.permissions_changed") {
      const gatewayAccountId = (data.accountId as string | undefined) ?? ((data.account as { _id?: string } | undefined)?._id);
      if (gatewayAccountId) {
        const acc = await prisma.socialAccount.findFirst({ where: { gatewayAccountId } });
        if (acc) await enqueue("check_account_health", { socialAccountId: acc.id }, { dedupeKey: `health:${acc.id}:${Date.now()}`, brandId: acc.brandId });
      }
    } else if (type === "analytics.synced") {
      const gatewayAccountId = data.accountId as string | undefined;
      const acc = gatewayAccountId ? await prisma.socialAccount.findFirst({ where: { gatewayAccountId } }) : null;
      if (acc) await enqueue("sync_analytics", { socialAccountId: acc.id }, { dedupeKey: `analytics:${acc.id}:${Math.floor(Date.now() / 3_600_000)}`, brandId: acc.brandId });
    } else if (type === "lead.received") {
      const brandAccount = await prisma.socialAccount.findFirst({ where: { gatewayAccountId: data.accountId as string | undefined } });
      await prisma.contactRecord.create({ data: { brandId: brandAccount?.brandId ?? (await prisma.brand.findFirstOrThrow()).id, provider: "metaads", externalId: (data.leadId as string | undefined) ?? providerEventId, name: (data.name as string | undefined) ?? null, email: (data.email as string | undefined) ?? null, phone: (data.phone as string | undefined) ?? null, source: "lead_form", optInStatus: "opted_in", optInAt: new Date(), metadata: data as object } });
      await notify({ brandId: brandAccount?.brandId, title: "New lead received", link: "/contacts" });
    }
    await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: "processed", processedAt: new Date() } });
    return { processed: type };
  } catch (err) {
    await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: "failed", error: (err as Error).message } });
    throw err;
  }
}
