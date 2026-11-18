/**
 * Workspaces. A workspace is a `Brand` row: everything a user connects, publishes or automates
 * belongs to exactly one of them, and every query starts from its owner.
 *
 *   personal — someone's own accounts
 *   business — the owner's own company
 *   client   — a company managed on behalf of a customer (the agency case)
 *
 * The kind describes who the workspace is for. It does not change what a connected account can do:
 * that is decided by the platform (a personal workspace may hold an Instagram Business account).
 */
import { prisma } from "@sm/db";
import type { Brand, SocialAccount } from "@sm/db";
import { audit } from "./audit";
import { AppError } from "./connections";

export const WORKSPACE_KINDS = ["personal", "business", "client"] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export interface WorkspaceInput {
  name: string;
  kind: WorkspaceKind;
  websiteUrl?: string | null;
  industry?: string | null;
  country?: string | null;
  locale?: "it" | "en";
  timezone?: string;
  description?: string | null;
  brandVoice?: string | null;
  targetAudience?: string | null;
  logoUrl?: string | null;
}

const clean = (v: string | null | undefined, max: number) => {
  const s = (v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

export function isWorkspaceKind(v: unknown): v is WorkspaceKind {
  return typeof v === "string" && (WORKSPACE_KINDS as readonly string[]).includes(v);
}

export async function createWorkspace(userId: string, input: WorkspaceInput): Promise<Brand> {
  const name = input.name.trim();
  if (!name) throw new AppError("A workspace needs a name.", 422, "validation");
  if (!isWorkspaceKind(input.kind)) throw new AppError("Unknown workspace type.", 422, "validation");
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "workspace";
  let slug = base;
  for (let i = 2; await prisma.brand.findFirst({ where: { ownerId: userId, slug }, select: { id: true } }); i++) slug = `${base}-${i}`;
  const brand = await prisma.brand.create({
    data: {
      ownerId: userId,
      name: name.slice(0, 80),
      slug,
      kind: input.kind,
      websiteUrl: clean(input.websiteUrl, 300),
      industry: clean(input.industry, 80),
      country: clean(input.country, 60),
      description: clean(input.description, 1000),
      brandVoice: clean(input.brandVoice, 1000),
      targetAudience: clean(input.targetAudience, 1000),
      logoUrl: clean(input.logoUrl, 500),
      locale: input.locale ?? "en",
      timezone: input.timezone ?? "Europe/Rome",
    },
  });
  await audit({ actorUserId: userId, brandId: brand.id, action: "workspace.create", details: { kind: brand.kind } });
  return brand;
}

export async function updateWorkspace(userId: string, id: string, input: Partial<WorkspaceInput> & { archived?: boolean }): Promise<Brand> {
  const existing = await prisma.brand.findFirst({ where: { id, ownerId: userId } });
  if (!existing) throw new AppError("Workspace not found.", 404, "not_found");
  if (input.kind !== undefined && !isWorkspaceKind(input.kind)) throw new AppError("Unknown workspace type.", 422, "validation");
  const opt = (v: string | null | undefined, max: number) => (v === undefined ? undefined : clean(v, max));
  const brand = await prisma.brand.update({
    where: { id },
    data: {
      name: input.name?.trim() ? input.name.trim().slice(0, 80) : undefined,
      kind: input.kind,
      websiteUrl: opt(input.websiteUrl, 300),
      industry: opt(input.industry, 80),
      country: opt(input.country, 60),
      description: opt(input.description, 1000),
      brandVoice: opt(input.brandVoice, 1000),
      targetAudience: opt(input.targetAudience, 1000),
      logoUrl: opt(input.logoUrl, 500),
      locale: input.locale,
      timezone: input.timezone,
      archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null,
    },
  });
  await audit({ actorUserId: userId, brandId: id, action: input.archived === undefined ? "workspace.update" : input.archived ? "workspace.archive" : "workspace.restore" });
  return brand;
}

export interface WorkspaceOverview {
  id: string;
  name: string;
  kind: WorkspaceKind;
  industry: string | null;
  country: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  archived: boolean;
  createdAt: Date;
  accounts: number;
  accountsNeedingAttention: number;
  scheduledPosts: number;
  publishedPosts: number;
  failedPosts: number;
  adAccounts: number;
}

/** Every workspace the user owns, with real counts. Archived ones are included only on request. */
export async function listWorkspaces(userId: string, opts: { includeArchived?: boolean } = {}): Promise<WorkspaceOverview[]> {
  const brands = await prisma.brand.findMany({ where: { ownerId: userId, ...(opts.includeArchived ? {} : { archivedAt: null }) }, orderBy: { createdAt: "asc" } });
  if (brands.length === 0) return [];
  const ids = brands.map((b) => b.id);
  const [accounts, posts, ads] = await Promise.all([
    prisma.socialAccount.groupBy({ by: ["brandId", "status"], where: { brandId: { in: ids } }, _count: { _all: true } }),
    prisma.post.groupBy({ by: ["brandId", "status"], where: { brandId: { in: ids } }, _count: { _all: true } }),
    prisma.adAccount.groupBy({ by: ["brandId"], where: { brandId: { in: ids } }, _count: { _all: true } }),
  ]);
  const sum = <T extends { brandId: string; _count: { _all: number } }>(rows: T[], brandId: string, keep: (r: T) => boolean) => rows.filter((r) => r.brandId === brandId && keep(r)).reduce((n, r) => n + r._count._all, 0);
  return brands.map((b) => ({
    id: b.id,
    name: b.name,
    kind: isWorkspaceKind(b.kind) ? b.kind : "business",
    industry: b.industry,
    country: b.country,
    websiteUrl: b.websiteUrl,
    logoUrl: b.logoUrl,
    archived: Boolean(b.archivedAt),
    createdAt: b.createdAt,
    accounts: sum(accounts, b.id, (r) => r.status !== "disconnected"),
    accountsNeedingAttention: sum(accounts, b.id, (r) => r.status === "needs_reconnect" || r.status === "error"),
    scheduledPosts: sum(posts, b.id, (r) => r.status === "scheduled"),
    publishedPosts: sum(posts, b.id, (r) => r.status === "published"),
    failedPosts: sum(posts, b.id, (r) => r.status === "failed" || r.status === "partial"),
    adAccounts: sum(ads, b.id, () => true),
  }));
}

export interface AccountRow {
  id: string;
  provider: string;
  backend: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  accountType: string | null;
  status: SocialAccount["status"];
  lastError: string | null;
  lastCheckedAt: Date | null;
  workspaceId: string;
  workspaceName: string;
  workspaceKind: WorkspaceKind;
  /** null = the platform has not reported a follower count to this app (never shown as 0). */
  followers: number | null;
  publishErrors: number;
  activeAutomations: number;
  canPublish: boolean | null;
  canMessage: boolean | null;
  adsEligible: boolean;
  lastActivityAt: Date | null;
}

export interface AccountFilters {
  workspaceId?: string;
  kind?: WorkspaceKind;
  provider?: string;
  status?: string;
  automation?: "on" | "off";
  ads?: "yes" | "no";
}

const capability = (metadata: unknown, keys: string[]): boolean | null => {
  const caps = ((metadata ?? {}) as { capabilities?: Record<string, string> }).capabilities;
  if (!caps) return null; // not checked yet: unknown, not "no"
  const seen = keys.map((k) => caps[k]).filter(Boolean);
  if (seen.length === 0) return null;
  return seen.some((v) => v === "supported");
};

/** Every connected account across the user's active workspaces — never anyone else's. */
export async function listAllAccounts(userId: string, filters: AccountFilters = {}): Promise<AccountRow[]> {
  const brands = await prisma.brand.findMany({ where: { ownerId: userId, archivedAt: null, ...(filters.workspaceId ? { id: filters.workspaceId } : {}), ...(filters.kind ? { kind: filters.kind } : {}) } });
  if (brands.length === 0) return [];
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const accounts = await prisma.socialAccount.findMany({
    where: { brandId: { in: brands.map((b) => b.id) }, status: filters.status ? (filters.status as SocialAccount["status"]) : { not: "disconnected" }, ...(filters.provider ? { provider: filters.provider } : {}) },
    orderBy: [{ brandId: "asc" }, { provider: "asc" }, { createdAt: "asc" }],
  });
  if (accounts.length === 0) return [];
  const ids = accounts.map((a) => a.id);
  const [failed, lastTargets, rules, adAccounts, followerRows] = await Promise.all([
    prisma.postTarget.groupBy({ by: ["socialAccountId"], where: { socialAccountId: { in: ids }, status: { in: ["failed_permanent", "failed_retryable", "needs_reconnect"] } }, _count: { _all: true } }),
    prisma.postTarget.groupBy({ by: ["socialAccountId"], where: { socialAccountId: { in: ids } }, _max: { updatedAt: true } }),
    prisma.automationRule.findMany({ where: { brandId: { in: [...brandById.keys()] }, enabled: true }, select: { brandId: true, trigger: true } }),
    prisma.adAccount.findMany({ where: { brandId: { in: [...brandById.keys()] } }, select: { brandId: true, provider: true } }),
    prisma.analyticsMetric.findMany({ where: { socialAccountId: { in: ids }, scope: "account", metric: "followers", value: { not: null } }, orderBy: { bucketTime: "desc" }, distinct: ["socialAccountId"], select: { socialAccountId: true, value: true } }),
  ]);
  const failedBy = new Map(failed.map((f) => [f.socialAccountId, f._count._all]));
  const lastBy = new Map(lastTargets.map((t) => [t.socialAccountId, t._max.updatedAt]));
  const followersBy = new Map(followerRows.map((f) => [f.socialAccountId, f.value]));
  const rows = accounts.map((a): AccountRow => {
    const b = brandById.get(a.brandId)!;
    const mine = rules.filter((r) => {
      if (r.brandId !== a.brandId) return false;
      const target = ((r.trigger ?? {}) as { filters?: { socialAccountId?: string } }).filters?.socialAccountId;
      return !target || target === a.id; // a rule with no account filter applies to the whole workspace
    }).length;
    const meta = a.provider === "facebook" || a.provider === "instagram";
    return {
      id: a.id,
      provider: a.provider,
      backend: a.backend,
      displayName: a.displayName,
      username: a.username,
      avatarUrl: a.avatarUrl,
      profileUrl: a.profileUrl,
      accountType: a.accountType,
      status: a.status,
      lastError: a.lastError,
      lastCheckedAt: a.lastCheckedAt,
      workspaceId: b.id,
      workspaceName: b.name,
      workspaceKind: isWorkspaceKind(b.kind) ? b.kind : "business",
      followers: followersBy.get(a.id) ?? null,
      publishErrors: failedBy.get(a.id) ?? 0,
      activeAutomations: mine,
      canPublish: capability(a.metadata, ["publish_image", "publish_video", "publish_text"]),
      canMessage: capability(a.metadata, ["read_dm", "reply_comment"]),
      adsEligible: meta && adAccounts.some((ad) => ad.brandId === a.brandId),
      lastActivityAt: lastBy.get(a.id) ?? a.lastCheckedAt,
    };
  });
  return rows.filter((r) => (filters.automation ? (filters.automation === "on") === r.activeAutomations > 0 : true) && (filters.ads ? (filters.ads === "yes") === r.adsEligible : true));
}

export function summarizeAccounts(rows: AccountRow[]) {
  return {
    total: rows.length,
    workspaces: new Set(rows.map((r) => r.workspaceId)).size,
    personal: rows.filter((r) => r.workspaceKind === "personal").length,
    business: rows.filter((r) => r.workspaceKind !== "personal").length,
    needReconnect: rows.filter((r) => r.status === "needs_reconnect" || r.status === "error").length,
    withAutomation: rows.filter((r) => r.activeAutomations > 0).length,
    adsEligible: rows.filter((r) => r.adsEligible).length,
    withPublishErrors: rows.filter((r) => r.publishErrors > 0).length,
  };
}
