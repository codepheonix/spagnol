import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/hanken-grotesk";
import "./globals.css";
import { themeInitScript } from "@/components/ThemeToggle";
import { headers } from "next/headers";
import { getLocale } from "@/lib/i18n";

export const metadata: Metadata = { title: { default: "iGerald", template: "%s · iGerald" }, description: "Manage social accounts, publishing, replies and advertising for yourself, your company or your clients.", applicationName: "iGerald" };

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0b0e14" }, { media: "(prefers-color-scheme: light)", color: "#e9ecf1" }] };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // The Content Security Policy only lets scripts carrying this response's nonce run (see middleware.ts).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang={locale} data-theme="dark" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
