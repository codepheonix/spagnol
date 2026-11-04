import { cookies } from "next/headers";

export type Locale = "en" | "it";

const dict = {
  en: {
    dashboard: "Dashboard",
    brands: "Brands",
    accounts: "Accounts",
    media: "Media",
    posts: "Posts",
    calendar: "Calendar",
    inbox: "Inbox",
    analytics: "Analytics",
    ads: "Ads",
    automations: "Automations",
    settings: "Settings",
    health: "Health",
    activity: "Activity",
    logout: "Sign out",
    login: "Sign in",
    email: "Email",
    password: "Password",
    newPost: "New post",
    save: "Save",
    publishNow: "Publish now",
    schedule: "Schedule",
    cancel: "Cancel",
    retry: "Retry",
    connect: "Connect",
    disconnect: "Disconnect",
    status: "Status",
    noData: "No data yet.",
    unsupported: "unsupported",
    unavailable: "unavailable",
    activeBrand: "Active brand",
    language: "Language",
  },
  it: {
    dashboard: "Pannello",
    brands: "Brand",
    accounts: "Account",
    media: "Media",
    posts: "Post",
    calendar: "Calendario",
    inbox: "Messaggi",
    analytics: "Statistiche",
    ads: "Inserzioni",
    automations: "Automazioni",
    settings: "Impostazioni",
    health: "Stato",
    activity: "Attività",
    logout: "Esci",
    login: "Accedi",
    email: "Email",
    password: "Password",
    newPost: "Nuovo post",
    save: "Salva",
    publishNow: "Pubblica ora",
    schedule: "Programma",
    cancel: "Annulla",
    retry: "Riprova",
    connect: "Collega",
    disconnect: "Scollega",
    status: "Stato",
    noData: "Nessun dato.",
    unsupported: "non supportato",
    unavailable: "non disponibile",
    activeBrand: "Brand attivo",
    language: "Lingua",
  },
} as const;

export type Key = keyof typeof dict.en;

export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  const v = jar.get("sm_locale")?.value;
  return v === "en" || v === "it" ? v : ((process.env.DEFAULT_LOCALE as Locale) ?? "it");
}

export async function t(): Promise<(k: Key) => string> {
  const locale = await getLocale();
  return (k) => dict[locale][k] ?? dict.en[k];
}
