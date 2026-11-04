import { ThemeToggle } from "./ThemeToggle";

const BRANDS = ["Spagnol Mobili", "Spagnol Salotti", "Lavalle Arredobagno", "Valplana", "Spagnol Contract"];

/** Two-panel auth layout: the brand statement on the left, the form on the right. */
export function AuthShell({ children, lang }: { children: React.ReactNode; lang: "it" | "en" }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="grain" aria-hidden />
        <div className="wordmark" style={{ position: "relative" }}><span className="mark" aria-hidden />Social Manager</div>
        <div style={{ position: "relative" }}>
          <h1 className="statement">{lang === "it" ? "Un solo posto per ogni brand del gruppo." : "One place for every brand in the group."}</h1>
          <div className="brands">
            {BRANDS.map((b, i) => (
              <div key={b}>{i === 0 ? <span>{b}</span> : b}</div>
            ))}
          </div>
        </div>
        <div className="foot">{lang === "it" ? "Post, calendario, messaggi, statistiche e inserzioni — Facebook, Instagram e altri canali." : "Posts, calendar, inbox, analytics and ads — Facebook, Instagram and other channels."}</div>
      </aside>
      <div className="auth-form">
        <div style={{ width: "100%", maxWidth: 400 }}>
          {children}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <ThemeToggle labels={{ dark: lang === "it" ? "Scuro" : "Dark", light: lang === "it" ? "Chiaro" : "Light" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
