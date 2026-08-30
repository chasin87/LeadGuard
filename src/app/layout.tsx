import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LeadGuard", template: "%s | LeadGuard" },
  description: "Bescherm advertentiebudget en leads met continue controle van conversieroutes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
