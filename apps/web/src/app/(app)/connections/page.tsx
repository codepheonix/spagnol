import Link from "next/link";
import { prisma } from "@sm/db";
import { listDescriptors } from "@sm/integrations";
import { getZernioConfig, providerAppStatus } from "@sm/core";
import { requireUser, getActiveBrand } from "@/lib/auth";
import { ConnectionCenter, type CardState } from "@/components/ConnectionCenter";
import { PLATFORMS, platformById } from "@/lib/platforms";

export const metadata = { title: "Social connections" };

type Field = { name: string; label: string; secret?: boolean; placeholder?: string; help?: string };

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const active = await getActiveBrand(user);
  const workspaces = await prisma.brand.findMany({ where: { ownerId: user.id, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, kind: true } });
  const [apps, zernio, accounts] = await Promise.all([
    providerAppStatus(),
    getZernioConfig(),
    prisma.socialAccount.findMany({ where: { brandId: { in: workspaces.map((w) => w.id) }, status: { not: "disconnected" } }, orderBy: { createdAt: "asc" }, select: { id: true, provider: true, displayName: true, username: true, avatarUrl: true, status: true, brandId: true } }),
  ]);
  const descriptors = listDescriptors();
  const names = new Map(workspaces.map((w) => [w.id, w.name]));
  const cards: CardState[] = PLATFORMS.map((p) => {
    const native = p.built ? descriptors.find((d) => d.id === p.id && d.backend === "native") : undefined;
    const connect: CardState["connect"] = !native ? null : native.connect.kind === "credentials" ? { kind: "credentials", fields: (native.connect.fields ?? []) as Field[], notes: native.connect.notes } : native.connect.kind === "oauth" ? { kind: "oauth" } : null;
    return {
      id: p.id,
      connect,
      viaZernio: Boolean(zernio) && descriptors.some((d) => d.id === p.id && d.backend === "zernio"),
      accounts: accounts.filter((a) => a.provider === p.id).map((a) => ({ id: a.id, displayName: a.displayName, username: a.username, avatarUrl: a.avatarUrl, status: a.status, workspaceId: a.brandId, workspaceName: names.get(a.brandId) ?? "" })),
    };
  });
  const metaReady = Boolean(apps.META_APP_ID && apps.META_APP_SECRET);
  const igLoginReady = Boolean(apps.INSTAGRAM_APP_ID && apps.INSTAGRAM_APP_SECRET);

  return (
    <div>
      <div className="head">
        <div>
          <h1>Social connections</h1>
          <p className="lead">Pick a platform, choose the workspace that will own the account, and sign in on the platform&apos;s own page. iGerald never sees or stores a password.</p>
        </div>
        <div className="row">
          <Link className="btn" href="/organizations?add=1">+ Add company</Link>
          <Link className="btn" href="/accounts">All accounts</Link>
        </div>
      </div>

      {sp.connected && <div className="msg ok" role="status">Connected {sp.connected} account{sp.connected === "1" ? "" : "s"}. {sp.provider ? `${platformById(sp.provider)?.name ?? sp.provider}: ` : ""}it is now listed under All accounts.</div>}
      {sp.reconnected && <div className="msg ok" role="status">Permission renewed. Scheduled posts and history for this account are kept.</div>}
      {sp.error && <div className="msg err" role="alert"><b>The connection was not completed{sp.provider ? ` (${platformById(sp.provider)?.name ?? sp.provider})` : ""}.</b> {sp.error}</div>}
      {workspaces.length === 0 && (
        <div className="empty" style={{ marginBottom: 18 }}>
          <h3>Create a workspace first</h3>
          <p>Every connected account belongs to a workspace — your own, your company&apos;s, or a client&apos;s. Create one and the Connect buttons unlock.</p>
          <Link className="btn primary" href="/organizations?first=1">Create a workspace</Link>
        </div>
      )}
      {!metaReady && workspaces.length > 0 && (
        <div className="msg info">
          <b>Facebook and Instagram need one setup step.</b> Meta only opens its sign-in page for a registered app, and this installation has none yet. <Link href="/accounts/setup/meta"><b>Register the Meta app</b></Link> (free, about ten minutes), then connect as many accounts as you like.
        </div>
      )}

      <ConnectionCenter cards={cards} workspaces={workspaces} activeWorkspaceId={active?.id ?? null} metaReady={metaReady} igLoginReady={igLoginReady} zernioReady={Boolean(zernio)} openFirst={sp.connect ?? null} />

      <p className="small muted" style={{ maxWidth: "80ch" }}>
        Cards marked “Not available yet” are platforms this app cannot connect to today; they have no Connect button so nothing here pretends to work. Platform names and logos belong to their owners and are shown only to identify each service.
      </p>
    </div>
  );
}
