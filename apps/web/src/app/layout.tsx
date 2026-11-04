import type { Metadata } from "next";
import "./globals.css";
import { themeInitScript } from "@/components/ThemeToggle";

export const metadata: Metadata = { title: "Social Manager", description: "Social media manager for the Spagnol brands" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
