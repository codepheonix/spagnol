"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label, badge }: { href: string; label: string; badge?: number }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link href={href} className={`item${active ? " active" : ""}`}>
      <span>{label}</span>
      {badge ? <span className="badge warn">{badge}</span> : null}
    </Link>
  );
}
