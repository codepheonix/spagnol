"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useEffect, useState, type ReactNode } from "react";
import { platformById } from "@/lib/platforms";
import { PlatformMedal } from "./PlatformMedal";
import type { SceneNode } from "./ConstellationScene";

const Scene = dynamic(() => import("./ConstellationScene"), { ssr: false });

class Guard extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The 3D overview. Falls back to flat medallions when WebGL is missing; the links below always work. */
export function Constellation({ nodes }: { nodes: SceneNode[] }) {
  const [mode, setMode] = useState<"wait" | "3d" | "flat">("wait");
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    try {
      const c = document.createElement("canvas");
      setMode(c.getContext("webgl2") || c.getContext("webgl") ? "3d" : "flat");
    } catch {
      setMode("flat");
    }
  }, []);
  const flat = (
    <div className="fallback">
      {nodes.map((n) => <Link key={n.id} href={n.href} aria-label={platformById(n.id)?.name}><PlatformMedal id={n.id} off={!n.connected} /></Link>)}
    </div>
  );
  const connected = nodes.filter((n) => n.connected);
  return (
    <div className="stage">
      {mode === "3d" ? <Guard fallback={flat}><Scene nodes={nodes} reduced={reduced} /></Guard> : mode === "flat" ? flat : null}
      <div className="legend">
        {connected.length === 0 ? <span className="chip">No platform connected yet — the core lights up when the first one is</span> : connected.map((n) => <Link key={n.id} className="chip" href={n.href}><span className="dot on" />{platformById(n.id)?.name}, {n.count} {n.count === 1 ? "account" : "accounts"}</Link>)}
      </div>
    </div>
  );
}
