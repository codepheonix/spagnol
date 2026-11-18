import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Logo";

/** Two-panel sign-in layout. Nothing here names a customer: a new installation starts neutral. */
export function AuthShell({ children, lang }: { children: React.ReactNode; lang: "it" | "en" }) {
  const it = lang === "it";
  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="grain" aria-hidden />
        <div className="orbit" aria-hidden />
        <div style={{ position: "relative" }}><Wordmark size={30} /></div>
        <div style={{ position: "relative" }}>
          <h1 className="statement">{it ? "Ogni account, un solo posto." : "Every account, one place."}</h1>
          <p className="sub">{it ? "Collega i tuoi profili social, quelli della tua azienda o dei tuoi clienti. Pubblica, rispondi e gestisci le inserzioni da un unico pannello." : "Connect your own social profiles, your company's, or your clients'. Publish, reply and run ads from one dashboard."}</p>
        </div>
        <div className="foot">{it ? "Gli account si collegano solo con l'accesso ufficiale di ogni piattaforma." : "Accounts connect only through each platform's official sign-in."}</div>
      </aside>
      <div className="auth-form">
        <div style={{ width: "100%", maxWidth: 400 }}>
          {children}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <ThemeToggle labels={{ dark: it ? "Scuro" : "Dark", light: it ? "Chiaro" : "Light" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
