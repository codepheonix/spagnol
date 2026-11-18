"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
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
  const [open, setOpen] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId ?? workspaces[0]?.id ?? "");
  const dialog = useRef<HTMLDialogElement>(null);
  const show = (id: string) => {
    setOpen(id);
    requestAnimationFrame(() => { if (!dialog.current?.open) dialog.current?.showModal(); });
  };
  // A link such as /connections?connect=instagram opens that platform's dialog directly.
  useEffect(() => {
    if (openFirst && workspaces.length > 0 && cards.some((c) => c.id === openFirst && (c.connect || c.viaZernio))) show(openFirst);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFirst]);
  const card = cards.find((c) => c.id === open) ?? null;
  const p = open ? platformById(open) : undefined;
  const ws = workspaces.find((w) => w.id === workspaceId);
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
            <article key={pl.id} className={`pcard${canConnect ? "" : " planned"}`} style={{ "--tint": pl.tint, "--delay": `${-(i % 5) * 1.1}s` } as CSSProperties} onPointerMove={tilt} onPointerLeave={untilt}>
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
                {canConnect ? <button className="primary" onClick={() => show(pl.id)} disabled={workspaces.length === 0}>{live.length ? "Connect another" : "Connect"}</button> : <span className="small muted">Nothing to connect to yet</span>}
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
                <h2 id="connect-title">Connect {p.name}</h2>
                <div className="small muted">{p.method}</div>
              </div>
            </div>

            <label htmlFor="connect-ws">Which workspace will own this account?</label>
            <select id="connect-ws" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name} — {KIND[w.kind] ?? "Company"}</option>)}
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

            <div className="row" style={{ justifyContent: "flex-end", marginTop: 18 }}>
              <button className="ghost" onClick={() => dialog.current?.close()}>Close</button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
