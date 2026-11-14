import { prisma, type Post, type PostTarget, type Prisma } from "@sm/db";
import { ProviderError, type TargetPost, type ValidationResult } from "@sm/integrations";
import { z } from "zod";
import { adapterFor, AppError, buildAccountContext } from "./connections";
import { mediaRefsFor } from "./media";
import { enqueue, PermanentJobError, RetryableJobError } from "./queue";
import { audit, notify } from "./audit";
import { logger } from "./logger";

export const postInputSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  body: z.string().max(65_000).default(""),
  link: z.string().url().optional().nullable().or(z.literal("")),
  tags: z.array(z.string().max(50)).max(20).default([]),
  campaignTag: z.string().max(80).optional().nullable(),
  mediaIds: z.array(z.string()).max(20).default([]),
  targets: z
    .array(z.object({ socialAccountId: z.string(), overrides: z.record(z.unknown()).default({}) }))
    .default([]),
  scheduledAt: z.string().datetime().optional().nullable(),
  scheduleTimezone: z.string().max(64).optional().nullable(),
});
export type PostInput = z.infer<typeof postInputSchema>;

const postInclude = { media: { include: { media: true }, orderBy: { position: "asc" as const } }, targets: { include: { socialAccount: true } } } satisfies Prisma.PostInclude;
export type PostWithRelations = Prisma.PostGetPayload<{ include: typeof postInclude }>;

async function assertBrandOwned(brandId: string, userId: string) {
  const brand = await prisma.brand.findFirst({ where: { id: brandId, ownerId: userId } });
  if (!brand) throw new AppError("Brand not found.", 404, "not_found");
  return brand;
}

export async function getPost(userId: string, postId: string): Promise<PostWithRelations> {
  const post = await prisma.post.findFirst({ where: { id: postId, brand: { ownerId: userId } }, include: postInclude });
  if (!post) throw new AppError("Post not found.", 404, "not_found");
  return post;
}

export async function createPost(userId: string, brandId: string, input: PostInput): Promise<PostWithRelations> {
  await assertBrandOwned(brandId, userId);
  await assertRelationsOwned(brandId, input);
  const post = await prisma.post.create({
    data: {
      brandId,
      title: input.title ?? null,
      body: input.body,
      link: input.link || null,
      tags: input.tags,
      campaignTag: input.campaignTag ?? null,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      scheduleTimezone: input.scheduleTimezone ?? null,
      media: { create: input.mediaIds.map((mediaId, position) => ({ mediaId, position })) },
      targets: { create: input.targets.map((t) => ({ socialAccountId: t.socialAccountId, overrides: t.overrides as object })) },
    },
    include: postInclude,
  });
  await audit({ actorUserId: userId, brandId, action: "post.create", targetType: "post", targetId: post.id });
  return post;
}

export async function updatePost(userId: string, postId: string, input: PostInput): Promise<PostWithRelations> {
  const existing = await getPost(userId, postId);
  if (!["draft", "validated", "failed", "partial", "canceled"].includes(existing.status)) throw new AppError(`A ${existing.status} post cannot be edited. Cancel it first.`, 409, "post_locked");
  await assertRelationsOwned(existing.brandId, input);
  const keepTargetIds = new Set(input.targets.map((t) => t.socialAccountId));
  await prisma.$transaction([
    prisma.postMedia.deleteMany({ where: { postId } }),
    prisma.postTarget.deleteMany({ where: { postId, socialAccountId: { notIn: [...keepTargetIds] }, status: { notIn: ["published"] } } }),
    prisma.post.update({
      where: { id: postId },
      data: {
        title: input.title ?? null,
        body: input.body,
        link: input.link || null,
        tags: input.tags,
        campaignTag: input.campaignTag ?? null,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        scheduleTimezone: input.scheduleTimezone ?? null,
        status: "draft",
        media: { create: input.mediaIds.map((mediaId, position) => ({ mediaId, position })) },
      },
    }),
  ]);
  for (const t of input.targets) {
    await prisma.postTarget.upsert({ where: { postId_socialAccountId: { postId, socialAccountId: t.socialAccountId } }, create: { postId, socialAccountId: t.socialAccountId, overrides: t.overrides as object }, update: { overrides: t.overrides as object, status: "pending", lastError: null, validation: undefined } });
  }
  await audit({ actorUserId: userId, brandId: existing.brandId, action: "post.update", targetType: "post", targetId: postId });
  return getPost(userId, postId);
}

async function assertRelationsOwned(brandId: string, input: PostInput) {
  if (input.mediaIds.length) {
    const n = await prisma.mediaAsset.count({ where: { id: { in: input.mediaIds }, brandId } });
    if (n !== new Set(input.mediaIds).size) throw new AppError("One or more media items do not belong to this brand.", 403, "cross_brand");
  }
  if (input.targets.length) {
    const ids = input.targets.map((t) => t.socialAccountId);
    const n = await prisma.socialAccount.count({ where: { id: { in: ids }, brandId } });
    if (n !== new Set(ids).size) throw new AppError("One or more accounts do not belong to this brand.", 403, "cross_brand");
  }
}

async function targetPostFor(post: PostWithRelations, target: PostTarget): Promise<TargetPost> {
  const media = await mediaRefsFor(post.media.map((m) => m.media));
  return { postId: post.id, targetId: target.id, body: post.body, title: post.title, link: post.link, media, overrides: (target.overrides as Record<string, unknown>) ?? {}, scheduledAt: post.scheduledAt, timezone: post.scheduleTimezone };
}

/** Validates every target against its adapter and stores the report. */
export async function validatePost(userId: string, postId: string): Promise<{ post: PostWithRelations; reports: Record<string, ValidationResult> }> {
  const post = await getPost(userId, postId);
  const reports: Record<string, ValidationResult> = {};
  let allOk = post.targets.length > 0;
  for (const t of post.targets) {
    let report: ValidationResult;
    if (t.socialAccount.status !== "connected") {
      report = { ok: false, issues: [{ level: "error", code: "account_" + t.socialAccount.status, message: `${t.socialAccount.displayName} is ${t.socialAccount.status.replace("_", " ")}.` }] };
    } else {
      try {
        const ctx = await buildAccountContext(t.socialAccount);
        report = await adapterFor(t.socialAccount).validatePost(ctx, await targetPostFor(post, t));
      } catch (err) {
        report = { ok: false, issues: [{ level: "error", code: "validation_error", message: (err as Error).message }] };
      }
    }
    reports[t.id] = report;
    if (!report.ok) allOk = false;
    await prisma.postTarget.update({ where: { id: t.id }, data: { validation: report as object, status: report.ok ? (t.status === "blocked" ? "pending" : t.status) : "blocked", lastError: report.ok ? null : report.issues.filter((i) => i.level === "error").map((i) => i.message).join(" ") } });
  }
  if (!post.targets.length) reports.__post = { ok: false, issues: [{ level: "error", code: "no_targets", message: "Select at least one account." }] };
  await prisma.post.update({ where: { id: postId }, data: { status: allOk ? "validated" : post.status === "draft" ? "draft" : post.status } });
  return { post: await getPost(userId, postId), reports };
}

/**
 * Publish now or at `scheduledAt`. Creates one durable job per target. Targets that failed
 * validation stay `blocked` and are not enqueued (partial success is visible per target).
 */
export async function schedulePost(userId: string, postId: string, opts: { scheduledAt?: Date | null; scheduleTimezone?: string | null; now?: boolean }): Promise<PostWithRelations> {
  const { post, reports } = await validatePost(userId, postId);
  const okTargets = post.targets.filter((t) => reports[t.id]?.ok);
  if (!okTargets.length) throw new AppError("No target passed validation.", 422, "validation_failed");
  const runAt = opts.now ? new Date() : (opts.scheduledAt ?? post.scheduledAt);
  if (!runAt) throw new AppError("Choose a time or publish now.", 400, "no_time");
  if (!opts.now && runAt.getTime() < Date.now() - 60_000) throw new AppError("The scheduled time is in the past.", 400, "past_time");
  await prisma.post.update({ where: { id: postId }, data: { status: "scheduled", scheduledAt: runAt, scheduleTimezone: opts.scheduleTimezone ?? post.scheduleTimezone ?? "Europe/Rome" } });
  for (const t of okTargets) {
    if (t.status === "published") continue; // a destination that already went out is never sent again
    await prisma.postTarget.update({ where: { id: t.id }, data: { status: "queued", nextRetryAt: runAt, lastError: null, errorCategory: null } });
    // Rescheduling moves the existing queued job instead of leaving it at the old time.
    await prisma.job.updateMany({ where: { dedupeKey: `publish:${t.id}`, status: "queued" }, data: { runAt } });
    await enqueue("publish_target", { postTargetId: t.id }, { runAt, dedupeKey: `publish:${t.id}`, maxAttempts: 6, priority: 10, brandId: post.brandId });
  }
  await audit({ actorUserId: userId, brandId: post.brandId, action: opts.now ? "post.publish_now" : "post.schedule", targetType: "post", targetId: postId, details: { runAt: runAt.toISOString(), targets: okTargets.length } });
  return getPost(userId, postId);
}

export async function cancelPost(userId: string, postId: string): Promise<PostWithRelations> {
  const post = await getPost(userId, postId);
  if (post.status === "published") throw new AppError("Already published — delete it per network instead.", 409, "already_published");
  for (const t of post.targets) {
    if (["queued", "pending", "blocked", "failed_retryable"].includes(t.status)) {
      await prisma.job.updateMany({ where: { dedupeKey: `publish:${t.id}`, status: "queued" }, data: { status: "canceled", finishedAt: new Date() } });
      await prisma.postTarget.update({ where: { id: t.id }, data: { status: "canceled" } });
    }
  }
  await prisma.post.update({ where: { id: postId }, data: { status: "canceled", canceledAt: new Date() } });
  await audit({ actorUserId: userId, brandId: post.brandId, action: "post.cancel", targetType: "post", targetId: postId });
  return getPost(userId, postId);
}

export async function retryTarget(userId: string, postId: string, targetId: string): Promise<PostTarget> {
  const post = await getPost(userId, postId);
  const t = post.targets.find((x) => x.id === targetId);
  if (!t) throw new AppError("Target not found.", 404, "not_found");
  if (t.status === "published") throw new AppError("Already published.", 409, "already_published");
  if (["queued", "uploading", "processing"].includes(t.status)) throw new AppError("This destination is already being sent.", 409, "in_flight");
  // Networks with no way to look a post up: the owner pressing Retry is the review. (Networks that
  // can be checked — Facebook, Instagram — are still checked by the worker before anything is re-sent.)
  if (!adapterFor(t.socialAccount).findRecentPost) await prisma.publishAttempt.updateMany({ where: { postTargetId: t.id, status: { in: ["started", "unknown"] } }, data: { status: "failed", error: "uncertain result; owner chose to send again", finishedAt: new Date() } });
  const updated = await prisma.postTarget.update({ where: { id: t.id }, data: { status: "queued", lastError: null, errorCategory: null, nextRetryAt: new Date() } });
  await enqueue("publish_target", { postTargetId: t.id }, { dedupeKey: `publish:${t.id}`, maxAttempts: 6, priority: 10, brandId: post.brandId });
  await prisma.post.update({ where: { id: postId }, data: { status: "scheduled" } });
  await audit({ actorUserId: userId, brandId: post.brandId, action: "post.retry_target", targetType: "post_target", targetId: t.id });
  return updated;
}

export async function duplicatePost(userId: string, postId: string): Promise<PostWithRelations> {
  const src = await getPost(userId, postId);
  const copy = await prisma.post.create({ data: { brandId: src.brandId, title: src.title, body: src.body, link: src.link, tags: src.tags, campaignTag: src.campaignTag, media: { create: src.media.map((m) => ({ mediaId: m.mediaId, position: m.position })) }, targets: { create: src.targets.map((t) => ({ socialAccountId: t.socialAccountId, overrides: t.overrides as object })) } }, include: postInclude });
  return copy;
}

/** Recomputes the parent post status from its targets. */
export async function rollupPostStatus(postId: string): Promise<Post> {
  const targets = await prisma.postTarget.findMany({ where: { postId } });
  const active = targets.filter((t) => t.status !== "canceled");
  const published = active.filter((t) => t.status === "published").length;
  const failed = active.filter((t) => t.status === "failed_permanent" || t.status === "needs_reconnect" || t.status === "blocked").length;
  const inFlight = active.filter((t) => ["queued", "uploading", "processing", "failed_retryable", "pending"].includes(t.status)).length;
  let status: Post["status"];
  if (active.length === 0) status = "canceled";
  else if (published === active.length) status = "published";
  else if (inFlight > 0) status = "publishing";
  else if (published > 0 && failed > 0) status = "partial";
  else if (failed === active.length) status = "failed";
  else status = "publishing";
  return prisma.post.update({ where: { id: postId }, data: { status, publishedAt: status === "published" ? new Date() : undefined } });
}

// ---------------------------------------------------------------------------
// Worker-side: publish one target with idempotency + reconciliation
// ---------------------------------------------------------------------------

export async function publishTargetJob(postTargetId: string): Promise<unknown> {
  const target = await prisma.postTarget.findUnique({ where: { id: postTargetId }, include: { socialAccount: true } });
  if (!target) throw new PermanentJobError("target vanished");
  if (["canceled", "published"].includes(target.status)) return { skipped: target.status };
  const post = await prisma.post.findUniqueOrThrow({ where: { id: target.postId }, include: postInclude });
  if (post.status === "canceled") return { skipped: "post canceled" };
  const log = logger.child({ postId: post.id, targetId: target.id, provider: target.socialAccount.provider });

  // Reconcile first: an earlier attempt may have succeeded remotely before we recorded it.
  const prior = await prisma.publishAttempt.findFirst({ where: { postTargetId, remotePostId: { not: null } }, orderBy: { startedAt: "desc" } });
  if (prior?.remotePostId) {
    const url = (prior.responseSummary as { remoteUrl?: string | null } | null)?.remoteUrl ?? null;
    await markPublished(target.id, post.id, prior.remotePostId, url, "reconciled from earlier attempt");
    return { reconciled: prior.remotePostId };
  }

  if (target.socialAccount.status !== "connected") {
    await prisma.postTarget.update({ where: { id: target.id }, data: { status: "needs_reconnect", lastError: `Reconnect ${target.socialAccount.displayName} (${target.socialAccount.status.replace("_", " ")}), then retry.`, errorCategory: "auth_expired" } });
    await rollupPostStatus(post.id);
    throw new PermanentJobError(`account ${target.socialAccount.status}`);
  }

  // An earlier send whose outcome is unknown (timeout, or the worker stopped mid-send): the network
  // may already have the post. Look for it there BEFORE sending anything again.
  const uncertain = await prisma.publishAttempt.findMany({ where: { postTargetId, status: { in: ["started", "unknown"] } }, orderBy: { startedAt: "asc" } });
  if (uncertain.length) {
    const lookupAdapter = adapterFor(target.socialAccount);
    const ids = uncertain.map((a) => a.id);
    if (lookupAdapter.findRecentPost) {
      let found: { remotePostId: string; remoteUrl?: string | null } | null;
      try {
        found = await lookupAdapter.findRecentPost(await buildAccountContext(target.socialAccount), await targetPostFor(post, target), new Date(uncertain[0]!.startedAt.getTime() - 120_000));
      } catch (err) {
        // Cannot verify right now → do not send blindly; try the check again later.
        const e = err as Error;
        const authExpired = err instanceof ProviderError && err.options.category === "auth_expired";
        await prisma.postTarget.update({ where: { id: target.id }, data: { status: authExpired ? "needs_reconnect" : "failed_retryable", errorCategory: authExpired ? "auth_expired" : "uncertain", lastError: `Checking publication: could not ask ${target.socialAccount.provider} whether the earlier send went through (${e.message.slice(0, 300)}). Nothing was re-sent.` } });
        await rollupPostStatus(post.id);
        if (authExpired) throw new PermanentJobError(e.message);
        throw new RetryableJobError(`reconcile lookup failed: ${e.message}`, 120);
      }
      if (found) {
        await prisma.publishAttempt.update({ where: { id: ids[ids.length - 1]! }, data: { status: "succeeded", remotePostId: found.remotePostId, responseSummary: { status: "published", remoteUrl: found.remoteUrl ?? null, reconciled: true } as object, finishedAt: new Date() } });
        await prisma.publishAttempt.updateMany({ where: { id: { in: ids.slice(0, -1) } }, data: { status: "failed", error: "superseded: publication confirmed on a later check", finishedAt: new Date() } });
        await markPublished(target.id, post.id, found.remotePostId, found.remoteUrl ?? null, "confirmed on the network after an interrupted send — not re-sent");
        log.info({ remotePostId: found.remotePostId }, "uncertain send reconciled: already published");
        return { reconciled: found.remotePostId };
      }
      await prisma.publishAttempt.updateMany({ where: { id: { in: ids } }, data: { status: "failed", error: "checked on the network: the earlier send did not publish", finishedAt: new Date() } });
    } else if (target.socialAccount.backend === "native") {
      // No way to check on this network and no idempotency key: a person decides whether to send again.
      await prisma.postTarget.update({ where: { id: target.id }, data: { status: "failed_permanent", errorCategory: "uncertain", lastError: `The earlier send may or may not have gone through, and ${target.socialAccount.provider} offers no way to check. Look at the account; press Retry only if the post is not there.` } });
      await rollupPostStatus(post.id);
      await notify({ brandId: post.brandId, level: "warning", title: `Check ${target.socialAccount.displayName} before retrying`, body: "An interrupted send needs your review.", link: `/posts/${post.id}` });
      throw new PermanentJobError("uncertain send needs review");
    }
    // Gateway backends (Zernio) dedupe on the idempotency key, so a repeat is safe there.
  }

  const attemptNumber = target.attempts + 1;
  const idempotencyKey = `${target.id}`; // stable per logical destination → providers dedupe on retry
  const attempt = await prisma.publishAttempt.create({ data: { postTargetId: target.id, idempotencyKey: `${target.id}:${attemptNumber}`, attemptNumber, status: "started" } });
  await prisma.postTarget.update({ where: { id: target.id }, data: { status: "uploading", attempts: attemptNumber, lastAttemptAt: new Date() } });

  try {
    const ctx = await buildAccountContext(target.socialAccount);
    const adapter = adapterFor(target.socialAccount);
    const tp = await targetPostFor(post, target);
    const validation = await adapter.validatePost(ctx, tp);
    if (!validation.ok) throw new ProviderError(validation.issues.map((i) => i.message).join(" "), { category: "validation", retryable: false });
    const result = await adapter.publish(ctx, tp, idempotencyKey);
    await prisma.publishAttempt.update({ where: { id: attempt.id }, data: { status: "succeeded", remotePostId: result.remotePostId, providerRequestId: result.providerRequestId ?? null, responseSummary: { status: result.status, remoteUrl: result.remoteUrl ?? null, raw: (result.raw as object) ?? null } as object, finishedAt: new Date() } });
    if (result.status === "published") {
      await markPublished(target.id, post.id, result.remotePostId, result.remoteUrl ?? null);
    } else {
      await prisma.postTarget.update({ where: { id: target.id }, data: { status: "processing", remotePostId: result.remotePostId, remoteUrl: result.remoteUrl ?? null, lastError: null } });
      await rollupPostStatus(post.id);
      const delay = result.status === "scheduled_remote" && post.scheduledAt ? Math.max(60_000, post.scheduledAt.getTime() - Date.now() + 120_000) : 60_000;
      await enqueue("reconcile_target", { postTargetId: target.id }, { runAt: new Date(Date.now() + delay), dedupeKey: `reconcile:${target.id}`, maxAttempts: 20, brandId: post.brandId });
    }
    log.info({ remotePostId: result.remotePostId, status: result.status }, "publish accepted by provider");
    return { remotePostId: result.remotePostId, status: result.status };
  } catch (err) {
    const e = err as Error;
    const pe = err instanceof ProviderError ? err : null;
    // "unknown" = the request may have reached the provider (timeout / dropped connection).
    const outcomeUnknown = pe?.options.category === "network" && !pe.options.notSent;
    await prisma.publishAttempt.update({ where: { id: attempt.id }, data: { status: outcomeUnknown ? "unknown" : "failed", error: e.message.slice(0, 2000), providerRequestId: pe?.options.providerRequestId ?? null, finishedAt: new Date() } });
    const retryable = pe ? pe.options.retryable : true;
    const needsReconnect = pe?.options.category === "auth_expired";
    if (needsReconnect) {
      await prisma.socialAccount.update({ where: { id: target.socialAccountId }, data: { status: "needs_reconnect", healthStatus: "error", lastError: e.message } });
      await notify({ brandId: post.brandId, level: "error", title: `Reconnect ${target.socialAccount.displayName}`, body: e.message, link: "/accounts" });
    }
    const exhausted = attemptNumber >= 6;
    const status = needsReconnect ? "needs_reconnect" : retryable && !exhausted ? "failed_retryable" : "failed_permanent";
    await prisma.postTarget.update({ where: { id: target.id }, data: { status, lastError: outcomeUnknown ? `Result uncertain (${e.message.slice(0, 300)}). Checking whether it was published before sending again.` : e.message.slice(0, 2000), errorCategory: outcomeUnknown ? "uncertain" : (pe?.options.category ?? "unknown") } });
    await rollupPostStatus(post.id);
    if (status === "failed_permanent") await notify({ brandId: post.brandId, level: "error", title: `Publishing failed on ${target.socialAccount.displayName}`, body: e.message, link: `/posts/${post.id}` });
    log.warn({ err: e.message, status }, "publish failed");
    if (retryable && !needsReconnect && !exhausted) throw new RetryableJobError(e.message, pe?.options.retryAfterSeconds);
    throw new PermanentJobError(e.message);
  }
}

async function markPublished(targetId: string, postId: string, remotePostId: string, remoteUrl: string | null, note?: string) {
  await prisma.postTarget.update({ where: { id: targetId }, data: { status: "published", remotePostId, remoteUrl: remoteUrl ?? undefined, publishedAt: new Date(), reconciledAt: new Date(), lastError: note ?? null, errorCategory: null } });
  await rollupPostStatus(postId);
}

/** Polls the provider until a processing/remotely scheduled target reaches a terminal state. */
export async function reconcileTargetJob(postTargetId: string): Promise<unknown> {
  const target = await prisma.postTarget.findUnique({ where: { id: postTargetId }, include: { socialAccount: true } });
  if (!target || !target.remotePostId) return { skipped: "no remote id" };
  if (target.status === "published" || target.status === "canceled") return { skipped: target.status };
  const adapter = adapterFor(target.socialAccount);
  if (!adapter.getPublishStatus) {
    await markPublished(target.id, target.postId, target.remotePostId, target.remoteUrl);
    return { assumed: "published (provider has no status endpoint)" };
  }
  const ctx = await buildAccountContext(target.socialAccount);
  const s = await adapter.getPublishStatus(ctx, target.remotePostId);
  if (s.status === "published") {
    await markPublished(target.id, target.postId, target.remotePostId, s.remoteUrl ?? target.remoteUrl);
    return { status: "published" };
  }
  if (s.status === "failed" || s.status === "deleted") {
    await prisma.postTarget.update({ where: { id: target.id }, data: { status: "failed_permanent", lastError: s.error ?? `remote status ${s.status}`, errorCategory: s.errorCategory ?? s.status } });
    await rollupPostStatus(target.postId);
    return { status: s.status };
  }
  if (s.remoteUrl && s.remoteUrl !== target.remoteUrl) await prisma.postTarget.update({ where: { id: target.id }, data: { remoteUrl: s.remoteUrl } });
  throw new RetryableJobError(`still ${s.status}`, 120);
}

export async function deletePublishedTarget(userId: string, postId: string, targetId: string): Promise<void> {
  const post = await getPost(userId, postId);
  const t = post.targets.find((x) => x.id === targetId);
  if (!t || t.status !== "published" || !t.remotePostId) throw new AppError("Nothing published to delete.", 409, "not_published");
  const adapter = adapterFor(t.socialAccount);
  if (!adapter.deletePost) throw new AppError("This network has no official delete endpoint — remove it in the app of the network.", 400, "unsupported");
  await adapter.deletePost(await buildAccountContext(t.socialAccount), t.remotePostId);
  await prisma.postTarget.update({ where: { id: t.id }, data: { status: "canceled", lastError: "deleted remotely by owner" } });
  await rollupPostStatus(postId);
  await audit({ actorUserId: userId, brandId: post.brandId, action: "post.delete_remote", targetType: "post_target", targetId });
}
