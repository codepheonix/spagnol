"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const EXACT = new Set(["/", "/accounts"]);

export function NavLink({ href, label, badge }: { href: string; label: string; badge?: number }) {
  const path = usePathname();
  const active = EXACT.has(href) ? path === href : path === href || path.startsWith(href + "/");
  return (
    <Link href={href} className={`item${active ? " active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => { if (document.documentElement.getAttribute("data-nav") === "open") document.documentElement.removeAttribute("data-nav"); }}>
      <span>{label}</span>
      {badge ? <span className="badge warn">{badge}</span> : null}
    </Link>
  );
}

/** Shows or hides the sidebar. On a phone it opens as a drawer; on a desktop the choice is remembered. */
export function NavToggle({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="iconbtn ghost"
      aria-label={label}
      title={label}
      onClick={() => {
        const root = document.documentElement;
        const cur = root.getAttribute("data-nav");
        if (window.matchMedia("(max-width: 900px)").matches) {
          if (cur === "open") root.removeAttribute("data-nav");
          else root.setAttribute("data-nav", "open");
          return;
        }
        if (cur === "closed") root.removeAttribute("data-nav");
        else root.setAttribute("data-nav", "closed");
        try {
          localStorage.setItem("ig_nav", cur === "closed" ? "open" : "closed");
        } catch {}
      }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden><path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none" /></svg>
    </button>
  );
}
