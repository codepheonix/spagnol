"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";
import { PLATFORMS, platformById } from "@/lib/platforms";
import { PlatformMedal } from "./PlatformMedal";
import { ConnectButton, CredentialsConnect } from "./Connections";

type Field = { name: string; label: string; secret?: boolean; placeholder?: string; help?: string };
export interface CardAccount { id: string; displayName: string; username: string | null; avatarUrl: string | null; status: string; workspaceId: string; workspaceName: string }
export interface CardState {
  id: string;
  /** How this app connects the platform, or null when no connection exists in the code. */
  connect: null | { kind: "oauth" } | { kind: "credentials"; fields: Field[]; notes?: string };
  viaZernio: boolean;
  accounts: CardAccount[];
}
export interface Workspace { id: string; name: string; kind: string }

const KIND: Record<string, string> = { personal: "Personal", business: "Company", client: "Client company" };

/** Tilts a card toward the pointer and moves its highlight. Skipped for touch and reduced motion. */
function tilt(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty("--ry", `${(x - 0.5) * 14}deg`);
  el.style.setProperty("--rx", `${(0.5 - y) * 12}deg`);
  el.style.setProperty("--mx", `${x * 100}%`);
  el.style.setProperty("--my", `${y * 100}%`);
}
function untilt(e: PointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty("--ry", "0deg");
  e.currentTarget.style.setProperty("--rx", "0deg");
}

export function ConnectionCenter({ cards, workspaces, activeWorkspaceId, metaReady, igLoginReady, zernioReady, openFirst }: { cards: CardState[]; workspaces: Workspace[]; activeWorkspaceId: string | null; metaReady: boolean; igLoginReady: boolean; zernioReady: boolean; openFirst?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  // A workspace created inside the dialog is usable at once, before the page data refreshes.
  const [created, setCreated] = useState<Workspace[]>([]);
  const all = [...workspaces, ...created.filter((c) => !workspaces.some((w) => w.id === c.id))];
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId ?? workspaces[0]?.id ?? "");
  const [first, setFirst] = useState({ kind: "personal", name: "" });
  const [firstErr, setFirstErr] = useState<string | null>(null);
  const [firstBusy, setFirstBusy] = useState(false);
  const createFirst = async () => {
    setFirstErr(null);
    if (!first.name.trim()) { setFirstErr("Give the workspace a name."); return; }
    setFirstBusy(true);
    try {
      const r = await api<{ brand: Workspace }>("/api/brands", { method: "POST", json: { kind: first.kind, name: first.name.trim(), locale: "en" } });
      await api(`/api/brands/${r.brand.id}/select`, { method: "POST" });
      setCreated((c) => [...c, { id: r.brand.id, name: r.brand.name, kind: r.brand.kind }]);
      setWorkspaceId(r.brand.id);
      router.refresh();
    } catch (e) {
      setFirstErr((e as Error).message);
    } finally {
      setFirstBusy(false);
    }
  };
  const dialog = useRef<HTMLDialogElement>(null);
  const show = (id: string) => {
    setOpen(id);
    requestAnimationFrame(() => { if (!dialog.current?.open) dialog.current?.showModal(); });
  };
  // A link such as /connections?connect=instagram opens that platform's dialog directly.
  useEffect(() => {
    if (openFirst && cards.some((c) => c.id === openFirst)) show(openFirst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFirst]);
  const card = cards.find((c) => c.id === open) ?? null;
  const p = open ? platformById(open) : undefined;
  const ws = all.find((w) => w.id === workspaceId);
  const canConnectOpen = Boolean(card?.connect) || Boolean(card?.viaZernio && zernioReady);
  const setupHref = "/accounts/setup/meta";
  const isMeta = open === "facebook" || open === "instagram";

  return (
    <>
      <div className="pgrid">
        {PLATFORMS.map((pl, i) => {
          const c = cards.find((x) => x.id === pl.id);
          const live = c?.accounts ?? [];
          const canConnect = Boolean(c?.connect) || Boolean(c?.viaZernio);
          return (
            <article
              key={pl.id}
              className={`pcard${canConnect ? "" : " planned"}`}
              style={{ "--tint": pl.tint, "--delay": `${-(i % 5) * 1.1}s`, cursor: "pointer" } as CSSProperties}
              onPointerMove={tilt}
              onPointerLeave={untilt}
              onClick={(e) => { if (!(e.target as HTMLElement).closest("a, button")) show(pl.id); }}
            >
              <div className="row lift" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <PlatformMedal id={pl.id} off={!canConnect} />
                {live.length > 0 ? <span className="badge connected">{live.length} connected</span> : canConnect ? <span className="badge">Not connected</span> : <span className="badge">Not available yet</span>}
              </div>
              <div className="lift-s">
                <h3>{pl.name}</h3>
                <div className="what">{canConnect ? pl.covers : pl.note}</div>
              </div>
              {live.slice(0, 2).map((a) => (
                <div key={a.id} className="acct lift-s" title={`${a.displayName} — ${a.workspaceName}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {a.avatarUrl ? <img src={a.avatarUrl} alt="" referrerPolicy="no-referrer" /> : null}
                  <span><b>{a.username ? "@" + a.username : a.displayName}</b> <span className="muted">in {a.workspaceName}</span></span>
                  {a.status !== "connected" && <span className={`badge ${a.status}`}>{a.status === "needs_reconnect" ? "Reconnect" : a.status}</span>}
                </div>
              ))}
              {live.length > 2 && <div className="small muted lift-s">and {live.length - 2} more</div>}
              <div className="foot lift-s">
                {canConnect ? <button className="primary" onClick={() => show(pl.id)}>{live.length ? "Connect another" : "Connect"}</button> : <button className="small" onClick={() => show(pl.id)}>Why not yet?</button>}
                {live.length > 0 && <Link className="btn ghost small" href={`/accounts?provider=${pl.id}`}>Manage</Link>}
              </div>
            </article>
          );
        })}
      </div>

      <dialog ref={dialog} className="sheet" aria-labelledby="connect-title" onClose={() => setOpen(null)} onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
        {p && card && (
          <div className="body">
            <div className="top">
              <PlatformMedal id={p.id} />
              <div>
                <h2 id="connect-title">{canConnectOpen ? `Connect ${p.name}` : `${p.name} is not available yet`}</h2>
                <div className="small muted">{canConnectOpen ? p.method : p.covers}</div>
              </div>
            </div>

            {!canConnectOpen ? (
              <div className="msg info" role="status">
                <b>{p.note ?? `iGerald has no ${p.name} connection yet.`}</b> Nothing is missing on your side, and no sign-in was attempted. The platforms you can connect today are Instagram, Facebook, Telegram, Bluesky, Discord and Slack.
              </div>
            ) : all.length === 0 ? (
              <div>
                <div className="msg info" role="status"><b>One thing first.</b> Every account lives in a workspace — yours, your company&apos;s or a client&apos;s. Create your first one here and you go straight on to connecting {p.name}.</div>
                <label htmlFor="first-kind">Who is it for?</label>
                <select id="first-kind" value={first.kind} onChange={(e) => setFirst({ ...first, kind: e.target.value })}>
                  <option value="personal">Me — my own accounts</option>
                  <option value="business">My company</option>
                  <option value="client">A client company</option>
                </select>
                <label htmlFor="first-name">{first.kind === "personal" ? "Workspace name" : "Company name"}</label>
                <input id="first-name" type="text" value={first.name} maxLength={80} placeholder={first.kind === "personal" ? "My accounts" : "Company name"} onChange={(e) => setFirst({ ...first, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createFirst(); } }} />
                {firstErr && <div className="msg err" role="alert">{firstErr}</div>}
                <div className="actions"><button className="primary" disabled={firstBusy} onClick={() => void createFirst()}>{firstBusy ? "Creating…" : `Create workspace and continue`}</button></div>
              </div>
            ) : (
              <>
            <label htmlFor="connect-ws">Which workspace will own this account?</label>
            <select id="connect-ws" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              {all.map((w) => <option key={w.id} value={w.id}>{w.name} — {KIND[w.kind] ?? "Company"}</option>)}
            </select>
            <p className="small muted" style={{ marginTop: 6 }}>The account, its posts and its messages stay inside {ws ? <b>{ws.name}</b> : "that workspace"} and are never shown in another one.</p>

            {open === "instagram" && (
              <div className="msg info">
                <b>Which Instagram accounts work.</b> Instagram lets apps publish, read comments and send replies only for <b>Business</b> and <b>Creator</b> accounts. A personal profile can sign in but cannot be automated — that is Instagram&apos;s rule, not a setting here. Switching is free: in the Instagram app open <i>Settings → Account type and tools → Switch to professional account</i>.
              </div>
            )}
            {open === "facebook" && <div className="msg info">Facebook lets apps publish to <b>Pages</b>, not to personal profiles. After you sign in you pick which Pages this workspace manages.</div>}

            {isMeta && !metaReady && !(open === "instagram" && igLoginReady) ? (
              <div className="msg err">
                <b>The sign-in page cannot open yet.</b> This installation has not been registered with Meta, so there is no app for Facebook or Instagram to authorise. It is a one-time step and takes about ten minutes.
                <div style={{ marginTop: 8 }}><Link className="btn small" href={setupHref}>Register the Meta app</Link></div>
              </div>
            ) : (
              <>
                <ol className="steps">
                  {card.connect?.kind === "oauth" && (<><li>{p.name === "Instagram" ? "Instagram or Facebook" : p.name} opens its own sign-in page.</li><li>You approve the permissions it lists.</li><li>You come back here and the account appears with what it can do.</li></>)}
                  {card.connect?.kind === "credentials" && (<><li>Paste the details below. They are checked with {p.name} before anything is saved.</li><li>The account appears with what it can do.</li></>)}
                </ol>
                <div className="actions">
                  {open === "facebook" && metaReady && <ConnectButton brandId={workspaceId} provider="facebook" label="Continue with Facebook" className="primary" setupHref={setupHref} />}
                  {open === "instagram" && igLoginReady && <ConnectButton brandId={workspaceId} provider="instagram" loginMethod="instagram_login" label="Continue with Instagram" className="primary" setupHref={setupHref} />}
                  {open === "instagram" && metaReady && <ConnectButton brandId={workspaceId} provider="instagram" loginMethod="facebook_login" label={igLoginReady ? "Continue with Facebook instead (account linked to a Page)" : "Continue with Instagram via Facebook sign-in"} className={igLoginReady ? "" : "primary"} setupHref={setupHref} />}
                  {card.connect?.kind === "credentials" && <CredentialsConnect key={`${open}-${workspaceId}`} brandId={workspaceId} provider={open!} fields={card.connect.fields} notes={card.connect.notes} startOpen />}
                </div>
                {open === "instagram" && metaReady && !igLoginReady && <p className="small muted" style={{ marginTop: 10 }}>This route signs in through Facebook and needs the Instagram account to be linked to a Facebook Page. Signing in on Instagram directly (no Page) needs the optional Instagram app in the Meta setup.</p>}
              </>
            )}

            {card.viaZernio && zernioReady && (
              <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                <div className="small muted" style={{ marginBottom: 8 }}><b>Optional: connect through Zernio.</b> Zernio is a separate paid service; accounts connected this way are billed by Zernio on your own Zernio plan. Check their pricing before using it.</div>
                <ConnectButton brandId={workspaceId} provider={open!} backend="zernio" label="Connect through Zernio (paid)" className="small" />
              </div>
            )}

              </>
            )}

            <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
              <button className="ghost" onClick={() => dialog.current?.close()}>Close</button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
