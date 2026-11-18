import type { CSSProperties } from "react";
import { platformById } from "@/lib/platforms";

/** A platform's official glyph on a machined disc. `off` desaturates it (not connected). */
export function PlatformMedal({ id, size, off, className = "" }: { id: string; size?: "sm"; off?: boolean; className?: string }) {
  const p = platformById(id);
  if (!p) return <span className={`medal ${size ?? ""} ${className}`} aria-hidden />;
  const [w, h, , , d] = p.icon.icon;
  return (
    <span className={`medal ${size ?? ""} ${off ? "off" : ""} ${className}`} style={{ "--tint": p.tint } as CSSProperties} role="img" aria-label={p.name}>
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden focusable="false">
        <path d={Array.isArray(d) ? d.join(" ") : d} />
      </svg>
    </span>
  );
}
