"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./architecture.css";
import { api } from "./api";

// Shapes mirror packages/core/src/architecture (passed in from the server page; no server code is imported here).
type L = { en: string; it: string };
interface ArchNode { id: string; label: L; col: number; row: number; shape: string; state: string; service: string; purpose: L; technology: string; link: string; probe?: string; deps: string[]; troubleshoot: L }
interface ArchEdge { from: string; to: string; label?: L; kind?: string }
interface ArchDiagram { id: string; file: string; title: L; summary: L; nodes: ArchNode[]; edges: ArchEdge[] }
interface JobRef { id: string; type: string; status: string; at: string; error?: string | null }
interface Probe { status: string; summary: string; lastSuccessAt?: string | null; lastFailureAt?: string | null; lastError?: string | null; recentJobs?: JobRef[]; credentials?: Array<{ name: string; configured: boolean }>; retryable?: boolean; metrics?: Record<string, string | number>; nextStep?: string }
interface StatusPayload { at: string; version: string; probes: Record<string, Probe> }
interface RunSummary { id: string; label: string; status: string; at: string }
interface RunTrace { run: RunSummary; stages: Record<string, { state: string; note?: string; at?: string | null }>; events: Array<{ at: string; text: string; level: string }> }

const STATUS_LABEL: Record<string, L> = {
  healthy: { en: "Healthy", it: "Sano" }, running: { en: "Running", it: "In esecuzione" }, waiting: { en: "Waiting", it: "In attesa" }, needs_approval: { en: "Needs approval", it: "Da approvare" },
  warning: { en: "Warning", it: "Attenzione" }, failed: { en: "Failed", it: "Fallito" }, disabled: { en: "Disabled", it: "Disattivato" },
};
// A glyph accompanies every colour so status never depends on colour alone.
const STATUS_GLYPH: Record<string, string> = { healthy: "●", running: "▶", waiting: "◷", needs_approval: "✋", warning: "▲", failed: "✕", disabled: "○" };
const STATE_LABEL: Record<string, L> = {
  implemented: { en: "built", it: "costruito" }, partial: { en: "partly built", it: "in parte" }, planned: { en: "planned", it: "pianificato" }, optional: { en: "optional", it: "facoltativo" },
  external: { en: "external", it: "esterno" }, candidate: { en: "under evaluation", it: "in valutazione" },
};
const STAGE_LABEL: Record<string, L> = { completed: { en: "done", it: "fatto" }, active: { en: "in progress", it: "in corso" }, failed: { en: "failed", it: "fallito" }, skipped: { en: "skipped", it: "saltato" } };
const TRACEABLE = ["publishing-learning", "messaging-leads"];

function probeFor(node: ArchNode, status: StatusPayload | null): Probe {
  if (!node.probe) return { status: "disabled", summary: node.state === "external" ? "Outside this system; no monitor." : "Not built or not deployed — there is nothing to monitor yet." };
  return status?.probes[node.probe] ?? { status: "waiting", summary: "Loading live status…" };
}

function FlowNode({ data }: NodeProps) {
  const d = data as { node: ArchNode; probe: Probe; lang: "en" | "it"; stage?: string; selected: boolean; tracing: boolean };
  const st = d.probe.status;
  return (
    <div className={`arch-node state-${d.node.state} shape-${d.node.shape} st-${st}${d.selected ? " is-selected" : ""}${d.tracing ? ` stage-${d.stage ?? "none"}` : ""}`} role="button" aria-label={`${d.node.label[d.lang]} — ${STATUS_LABEL[st]?.[d.lang] ?? st}`}>
      <Handle type="target" position={Position.Top} />
      <div className="arch-title">{d.node.label[d.lang]}</div>
      <div className="arch-meta">
        <span className={`arch-status st-${st}`}><span aria-hidden>{STATUS_GLYPH[st]}</span> {STATUS_LABEL[st]?.[d.lang] ?? st}</span>
        {d.node.state !== "implemented" && <span className="arch-state">{STATE_LABEL[d.node.state]?.[d.lang] ?? d.node.state}</span>}
      </div>
      {d.tracing && d.stage && <div className={`arch-stage stage-${d.stage}`}>{STAGE_LABEL[d.stage]?.[d.lang] ?? d.stage}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
const nodeTypes = { arch: FlowNode };
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

export function ArchitectureView({ diagrams, lang }: { diagrams: ArchDiagram[]; lang: "en" | "it" }) {
  const [active, setActive] = useState(diagrams[0]!.id);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState("");
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const T = (en: string, it: string) => (lang === "it" ? it : en);
  const diagram = diagrams.find((d) => d.id === active)!;

  const loadStatus = useCallback(() => {
    api<StatusPayload>("/api/architecture/status").then((s) => { setStatus(s); setStatusErr(null); }).catch((e: Error) => setStatusErr(e.message));
  }, []);
  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 30_000);
    return () => clearInterval(t);
  }, [loadStatus]);

  useEffect(() => {
    setSelected(null);
    setRunId("");
    setTrace(null);
    setRuns([]);
    if (TRACEABLE.includes(active)) api<{ runs: RunSummary[] }>(`/api/architecture/runs?diagram=${active}`).then((r) => setRuns(r.runs)).catch(() => setRuns([]));
  }, [active]);
  useEffect(() => {
    if (!runId) { setTrace(null); return; }
    api<RunTrace>(`/api/architecture/runs?diagram=${active}&id=${runId}`).then(setTrace).catch(() => setTrace(null));
  }, [runId, active]);

  const nodes: Node[] = useMemo(() => diagram.nodes.map((n) => ({ id: n.id, type: "arch", position: { x: n.col * 270, y: n.row * 128 }, data: { node: n, probe: probeFor(n, status), lang, stage: trace?.stages[n.id]?.state, selected: selected === n.id, tracing: Boolean(trace) }, draggable: true })), [diagram, status, lang, trace, selected]);
  const edges: Edge[] = useMemo(() => diagram.edges.map((e, i) => {
    const onPath = trace ? ["completed", "active", "failed"].includes(trace.stages[e.from]?.state ?? "") && ["completed", "active", "failed"].includes(trace.stages[e.to]?.state ?? "") : false;
    return { id: `${e.from}-${e.to}-${i}`, source: e.from, target: e.to, type: "smoothstep", label: e.label?.[lang], className: `arch-edge kind-${e.kind ?? "normal"}${trace ? (onPath ? " on-path" : " off-path") : ""}`, animated: onPath && trace?.stages[e.to]?.state === "active", markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } };
  }), [diagram, lang, trace]);

  // Tall workflows get a taller canvas (the page scrolls) so nodes stay readable without zooming.
  const canvasHeight = Math.max(560, (Math.max(...diagram.nodes.map((n) => n.row)) + 1) * 104 + 60);
  const node = diagram.nodes.find((n) => n.id === selected) ?? null;
  const probe = node ? probeFor(node, status) : null;
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const n of diagram.nodes) { const s = probeFor(n, status).status; out[s] = (out[s] ?? 0) + 1; }
    return out;
  }, [diagram, status]);

  return (
    <div className="arch">
      <div className="arch-tabs" role="tablist" aria-label={T("Diagrams", "Diagrammi")}>
        {diagrams.map((d, i) => (
          <button key={d.id} role="tab" aria-selected={d.id === active} className={d.id === active ? "on" : ""} onClick={() => setActive(d.id)}>
            <span className="mono">{String.fromCharCode(65 + i)}</span> {d.title[lang]}
          </button>
        ))}
      </div>
      <p className="small muted" style={{ margin: "8px 0 10px" }}>{diagram.summary[lang]}</p>

      <div className="arch-bar">
        <div className="arch-legend" aria-label={T("Live status", "Stato in tempo reale")}>
          {Object.keys(STATUS_LABEL).map((s) => <span key={s} className={`arch-status st-${s}`}><span aria-hidden>{STATUS_GLYPH[s]}</span> {STATUS_LABEL[s]![lang]} <b>{counts[s] ?? 0}</b></span>)}
        </div>
        <div className="small muted">
          {statusErr ? <span style={{ color: "var(--err)" }}>{T("Status unavailable", "Stato non disponibile")}: {statusErr}</span> : status ? <>{T("Live data read", "Dati reali letti")} {when(status.at)} · build <span className="mono">{status.version}</span></> : T("Loading…", "Caricamento…")}{" "}
          <button type="button" onClick={loadStatus}>{T("Refresh", "Aggiorna")}</button>
        </div>
      </div>

      {TRACEABLE.includes(active) && (
        <div className="arch-runs">
          <label htmlFor="arch-run">{active === "publishing-learning" ? T("Follow a real post", "Segui un post reale") : T("Follow a real comment", "Segui un commento reale")}</label>
          <select id="arch-run" value={runId} onChange={(e) => setRunId(e.target.value)}>
            <option value="">{runs.length ? T("— none: show live status only —", "— nessuno: solo stato in tempo reale —") : T("— no runs recorded yet —", "— nessuna esecuzione registrata —")}</option>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.at.slice(0, 16).replace("T", " ")} · {r.status} · {r.label}</option>)}
          </select>
          {trace && <span className="small muted">{T("Path", "Percorso")}: {Object.entries(STAGE_LABEL).map(([k, v]) => <span key={k} className={`arch-stage-chip stage-${k}`}>{v[lang]}</span>)}</span>}
        </div>
      )}

      <div className="arch-body">
        <div className="arch-canvas" data-testid="arch-canvas" style={{ height: canvasHeight }}>
          <ReactFlow key={active} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.06 }} minZoom={0.25} maxZoom={1.6} zoomOnScroll={false} preventScrolling={false} nodesConnectable={false} elementsSelectable onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)} proOptions={{ hideAttribution: false }}>
            <Background gap={22} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="arch-inspector" aria-live="polite">
          {!node || !probe ? (
            <div className="muted small">
              <p><b>{T("Click a node", "Clicca un nodo")}</b> {T("to see the service behind it, its live health, the latest success and failure, recent jobs, which credentials are configured, and the next troubleshooting step.", "per vedere il servizio, lo stato reale, l’ultimo successo ed errore, i job recenti, quali credenziali sono configurate e il prossimo passo di diagnosi.")}</p>
              <p>{T("Solid border = built. Amber = partly built. Dashed grey = planned. Dashed blue = optional or under evaluation. Nothing that is not built can show as healthy.", "Bordo pieno = costruito. Ambra = in parte. Grigio tratteggiato = pianificato. Blu tratteggiato = facoltativo o in valutazione. Ciò che non è costruito non può risultare sano.")}</p>
              {trace && (
                <div>
                  <h3>{T("Run timeline", "Cronologia esecuzione")}</h3>
                  <ul className="arch-events">{trace.events.map((ev, i) => <li key={i} className={ev.level === "error" ? "err" : ""}><span className="mono">{when(ev.at)}</span> {ev.text}</li>)}</ul>
                </div>
              )}
            </div>
          ) : (
            <div>
              <h2 style={{ marginTop: 0 }}>{node.label[lang]}</h2>
              <p><span className={`arch-status st-${probe.status}`}><span aria-hidden>{STATUS_GLYPH[probe.status]}</span> {STATUS_LABEL[probe.status]?.[lang] ?? probe.status}</span> <span className="arch-state">{STATE_LABEL[node.state]?.[lang] ?? node.state}</span></p>
              <p className="small">{probe.summary}</p>
              {trace?.stages[node.id] && <p className={`arch-stage-chip stage-${trace.stages[node.id]!.state}`} style={{ display: "block" }}>{T("In this run", "In questa esecuzione")}: {STAGE_LABEL[trace.stages[node.id]!.state]?.[lang]}{trace.stages[node.id]!.note ? ` — ${trace.stages[node.id]!.note}` : ""}</p>}
              <dl className="arch-dl">
                <dt>{T("Service", "Servizio")}</dt><dd className="mono">{node.service}</dd>
                <dt>{T("Purpose", "Scopo")}</dt><dd>{node.purpose[lang]}</dd>
                <dt>{T("Technology", "Tecnologia")}</dt><dd>{node.technology}</dd>
                <dt>{T("Code / docs", "Codice / documenti")}</dt><dd><a href={node.link} target="_blank" rel="noreferrer">{node.link.replace("https://github.com/codepheonix/spagnol/tree/main/", "")}</a></dd>
                <dt>{T("Latest success", "Ultimo successo")}</dt><dd>{when(probe.lastSuccessAt)}</dd>
                <dt>{T("Latest failure", "Ultimo errore")}</dt><dd>{when(probe.lastFailureAt)}</dd>
                {probe.lastError && (<><dt>{T("Error message", "Messaggio d’errore")}</dt><dd className="arch-error">{probe.lastError}</dd></>)}
                <dt>{T("Retry possible", "Riprova possibile")}</dt><dd>{probe.retryable ? T("yes — see next step", "sì — vedi prossimo passo") : T("nothing to retry", "nulla da riprovare")}</dd>
                <dt>{T("Depends on", "Dipende da")}</dt><dd>{node.deps.length ? node.deps.map((id) => { const dn = diagram.nodes.find((x) => x.id === id); return <button key={id} type="button" className="arch-dep" onClick={() => setSelected(id)}>{dn?.label[lang] ?? id}</button>; }) : "—"}</dd>
                {probe.metrics && (<><dt>{T("Numbers", "Numeri")}</dt><dd className="mono small">{Object.entries(probe.metrics).map(([k, v]) => `${k}: ${v}`).join(" · ")}</dd></>)}
              </dl>
              {probe.credentials && (
                <div>
                  <h3>{T("Credentials (names only, values never shown)", "Credenziali (solo nomi, i valori non sono mai mostrati)")}</h3>
                  <ul className="arch-creds">{probe.credentials.map((c) => <li key={c.name}><span className="mono">{c.name}</span> <span className={`badge ${c.configured ? "ok" : ""}`}>{c.configured ? T("configured", "configurata") : T("missing", "mancante")}</span></li>)}</ul>
                </div>
              )}
              <h3>{T("Recent jobs", "Job recenti")}</h3>
              {probe.recentJobs?.length ? (
                <div className="scroll-x"><table className="arch-jobs"><tbody>{probe.recentJobs.map((j) => <tr key={j.id}><td className="mono small" title={j.id}>{j.id.slice(-8)}</td><td className="mono small">{j.type}</td><td><span className={`badge ${j.status === "succeeded" ? "ok" : j.status === "dead" || j.status === "failed" ? "err" : ""}`}>{j.status}</span></td><td className="small muted">{j.at.slice(5, 16).replace("T", " ")}</td></tr>)}</tbody></table></div>
              ) : <p className="small muted">{T("No job recorded for this node.", "Nessun job registrato per questo nodo.")}</p>}
              {probe.recentJobs?.some((j) => j.error) && <p className="small arch-error">{probe.recentJobs.find((j) => j.error)!.error}</p>}
              <h3>{T("Next troubleshooting step", "Prossimo passo di diagnosi")}</h3>
              <p className="small">{probe.nextStep ?? node.troubleshoot[lang]}</p>
              <p className="small"><a href="/health">{T("Open System Health", "Apri Stato del sistema")}</a> · <a href="/activity">{T("Open Activity log", "Apri registro Attività")}</a></p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
