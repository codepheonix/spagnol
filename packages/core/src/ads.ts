/**
 * Ads: read-only sync first (via the Zernio gateway), drafts with provider dry-run, and an
 * activation gate that demands a fresh confirmation token created by a user action.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@sm/db";
import { ZernioClient } from "@sm/integrations";
import { AppError } from "./connections";
import { getZernioConfig } from "./settings";
import { audit } from "./audit";

async function zernio() {
  const z = await getZernioConfig();
  if (!z) throw new AppError("Zernio API key is not configured.", 412, "zernio_not_configured");
  return new ZernioClient(z.apiKey, z.baseUrl);
}

/** Pulls ad accounts (category=ads) connected on the brand's Zernio profile and their campaigns. */
export async function syncAdAccounts(brandId: string): Promise<{ accounts: number; campaigns: number }> {
  const brand = await prisma.brand.findUniqueOrThrow({ where: { id: brandId } });
  const c = await zernio();
  const profile = await c.ensureProfile(brand.id, brand.name, brand.timezone);
  const { accounts } = await c.listAccounts({ profileId: profile._id, category: "ads" });
  let campaigns = 0;
  for (const a of accounts) {
    const adAccount = await prisma.adAccount.upsert({
      where: { brandId_provider_externalId: { brandId, provider: a.platform, externalId: a.platformUserId ?? a._id } },
      create: { brandId, provider: a.platform, backend: "zernio", externalId: a.platformUserId ?? a._id, name: a.displayName ?? a.username ?? a._id, status: a.isActive ? "connected" : "needs_reconnect", gatewayAccountId: a._id, metadata: (a.metadata ?? {}) as object, syncedAt: new Date(), currency: (a.metadata?.currency as string | undefined) ?? null, timezone: (a.metadata?.timezone as string | undefined) ?? null },
      update: { name: a.displayName ?? a.username ?? a._id, status: a.isActive ? "connected" : "needs_reconnect", gatewayAccountId: a._id, syncedAt: new Date() },
    });
    const platform = a.platform === "metaads" ? "facebook" : a.platform.replace(/ads$/, "");
    const { campaigns: list } = await c.listAdCampaigns({ profileId: profile._id, platform, accountId: a._id, includeEmpty: true, limit: 100 });
    for (const cp of list) {
      const budget = cp.campaignBudget as { amount?: number; type?: string } | null;
      await prisma.adCampaign.upsert({
        where: { adAccountId_externalId: { adAccountId: adAccount.id, externalId: String(cp.platformCampaignId) } },
        create: { adAccountId: adAccount.id, externalId: String(cp.platformCampaignId), name: String(cp.campaignName ?? ""), status: String(cp.status ?? "unknown"), objective: (cp.goal as string | undefined) ?? null, dailyBudgetMinor: budget?.type === "daily" && budget.amount ? Math.round(budget.amount * 100) : null, lifetimeBudgetMinor: budget?.type === "lifetime" && budget.amount ? Math.round(budget.amount * 100) : null, currency: (cp.currency as string | null) ?? null, metrics: (cp.metrics ?? {}) as object, raw: cp as object },
        update: { name: String(cp.campaignName ?? ""), status: String(cp.status ?? "unknown"), metrics: (cp.metrics ?? {}) as object, raw: cp as object, syncedAt: new Date() },
      });
      campaigns++;
    }
  }
  return { accounts: accounts.length, campaigns };
}

export async function setCampaignStatus(userId: string, campaignId: string, status: "active" | "paused"): Promise<void> {
  const campaign = await prisma.adCampaign.findFirst({ where: { id: campaignId, adAccount: { brand: { ownerId: userId } } }, include: { adAccount: true } });
  if (!campaign) throw new AppError("Campaign not found.", 404, "not_found");
  if (campaign.adAccount.readOnly && status === "active") throw new AppError("This ad account is in read-only mode. Enable writes in its settings first.", 403, "read_only");
  const c = await zernio();
  const platform = campaign.adAccount.provider === "metaads" ? "facebook" : campaign.adAccount.provider.replace(/ads$/, "");
  await c.setCampaignStatus(campaign.externalId, { status, platform });
  await prisma.adCampaign.update({ where: { id: campaign.id }, data: { status } });
  await audit({ actorUserId: userId, brandId: campaign.adAccount.brandId, action: `ads.campaign.${status}`, targetType: "ad_campaign", targetId: campaign.id });
}

/** Creates a short-lived confirmation token tied to a draft; activation requires it (never created by background jobs). */
export async function createActivationConfirmation(userId: string, draftId: string): Promise<{ token: string; expiresAt: Date; summary: Record<string, unknown> }> {
  const draft = await prisma.adCampaignDraft.findFirst({ where: { id: draftId, brand: { ownerId: userId } }, include: { adAccount: true } });
  if (!draft) throw new AppError("Draft not found.", 404, "not_found");
  if (draft.adAccount.readOnly) throw new AppError("Ad account is read-only.", 403, "read_only");
  const spec = draft.spec as { budget?: { amount?: number; type?: string }; currency?: string };
  const amountMinor = Math.round((spec.budget?.amount ?? 0) * 100);
  if (draft.adAccount.spendCapMinor !== null && amountMinor > draft.adAccount.spendCapMinor) throw new AppError(`Budget exceeds the spend ceiling configured for this ad account.`, 422, "spend_cap");
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await prisma.adCampaignDraft.update({ where: { id: draft.id }, data: { confirmationToken: token, confirmationExpiresAt: expiresAt } });
  await audit({ actorUserId: userId, brandId: draft.brandId, action: "ads.confirmation.create", targetType: "ad_draft", targetId: draft.id, details: { amountMinor, currency: spec.currency ?? draft.adAccount.currency } });
  return { token, expiresAt, summary: { name: draft.name, budget: spec.budget, currency: spec.currency ?? draft.adAccount.currency, adAccount: draft.adAccount.name } };
}

export async function activateDraft(userId: string, draftId: string, token: string): Promise<never> {
  const draft = await prisma.adCampaignDraft.findFirst({ where: { id: draftId, brand: { ownerId: userId } } });
  if (!draft) throw new AppError("Draft not found.", 404, "not_found");
  if (!draft.confirmationToken || draft.confirmationToken !== token || !draft.confirmationExpiresAt || draft.confirmationExpiresAt < new Date()) throw new AppError("Confirmation token missing or expired. Confirm again.", 403, "confirmation_required");
  // Campaign creation through the gateway is intentionally not enabled until the ad account is
  // LIVE_VERIFIED in read mode and the owner enables writes (docs/acceptance-tests.md §Ads).
  await audit({ actorUserId: userId, brandId: draft.brandId, action: "ads.activate", outcome: "denied", targetType: "ad_draft", targetId: draft.id, details: { reason: "write path not enabled" } });
  throw new AppError("Campaign activation is disabled until the read-only ads sync is verified live and writes are enabled for this ad account.", 403, "ads_write_disabled");
}
