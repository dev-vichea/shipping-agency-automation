import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Shipping Agency", template: "%s | Shipping Agency" },
  description: "Internal shipping document and import workspace",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body className="min-h-screen font-sans">{children}</body></html>;
}
