import type { Metadata } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/hanken-grotesk";
import "./globals.css";
import { themeInitScript } from "@/components/ThemeToggle";
import { getLocale } from "@/lib/i18n";

export const metadata: Metadata = { title: { default: "iGerald", template: "%s · iGerald" }, description: "Manage social accounts, publishing, replies and advertising for yourself, your company or your clients.", applicationName: "iGerald" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
