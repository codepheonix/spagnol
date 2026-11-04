import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Social Manager", description: "Personal-use social media manager" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
