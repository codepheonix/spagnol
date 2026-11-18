import { DIAGRAMS } from "@sm/core";
import { requireUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { ArchitectureView } from "@/components/ArchitectureView";

export const dynamic = "force-dynamic";

/** Architecture & Workflows: the five diagrams, interactive, bound to live monitoring data. */
export default async function ArchitecturePage() {
  await requireUser();
  const locale = await getLocale();
  return (
    <div>
      <h1>{locale === "it" ? "Architettura e flussi" : "Architecture & Workflows"}</h1>
      <p className="muted small" style={{ marginTop: -6, maxWidth: 900 }}>
        {locale === "it"
          ? "Cinque diagrammi del sistema così com’è costruito oggi. Lo stato di ogni nodo è letto dai dati reali (job, tentativi, webhook, account, credenziali) e si aggiorna ogni 30 secondi. Le parti non ancora costruite sono indicate come tali."
          : "Five diagrams of the system as it is built today. Each node’s status is read from real records (jobs, attempts, webhooks, accounts, credentials) and refreshes every 30 seconds. Parts that are not built yet are marked as such."}
      </p>
      <ArchitectureView diagrams={JSON.parse(JSON.stringify(DIAGRAMS))} lang={locale} />
    </div>
  );
}
