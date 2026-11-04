import { prisma, type Prisma } from "@sm/db";

export async function audit(input: { actorUserId?: string | null; brandId?: string | null; action: string; targetType?: string; targetId?: string; outcome?: "ok" | "denied" | "error"; details?: Prisma.InputJsonValue; ip?: string | null }) {
  try {
    await prisma.auditLog.create({ data: { actorUserId: input.actorUserId ?? null, brandId: input.brandId ?? null, action: input.action, targetType: input.targetType, targetId: input.targetId, outcome: input.outcome ?? "ok", details: input.details ?? {}, ip: input.ip ?? null } });
  } catch {
    // audit must never break the main flow
  }
}

export async function notify(input: { brandId?: string | null; level?: "info" | "warning" | "error"; title: string; body?: string; link?: string }) {
  try {
    await prisma.notification.create({ data: { brandId: input.brandId ?? null, level: input.level ?? "info", title: input.title, body: input.body, link: input.link } });
  } catch {
    /* ignore */
  }
}
