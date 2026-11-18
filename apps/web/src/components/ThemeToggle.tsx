"use client";
import { useEffect, useState } from "react";

type Theme = "dark" | "light";

function readTheme(): Theme {
  try {
    const v = localStorage.getItem("sm_theme");
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "dark";
}

export function ThemeToggle({ labels }: { labels: { dark: string; light: string } }) {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => setTheme(readTheme()), []);
  const apply = (t: Theme) => {
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("sm_theme", t);
    } catch {}
  };
  return (
    <span className="theme-toggle" role="group" aria-label="Theme">
      <button type="button" className={theme === "dark" ? "on" : ""} onClick={() => apply("dark")}>{labels.dark}</button>
      <button type="button" className={theme === "light" ? "on" : ""} onClick={() => apply("light")}>{labels.light}</button>
    </span>
  );
}

/** Inline script that applies the saved theme before first paint (no flash). */
export const themeInitScript = `(function(){try{var d=document.documentElement,t=localStorage.getItem("sm_theme");if(t==="light"||t==="dark"){d.setAttribute("data-theme",t)}if(localStorage.getItem("ig_nav")==="closed"&&window.innerWidth>900){d.setAttribute("data-nav","closed")}}catch(e){}})();`;
