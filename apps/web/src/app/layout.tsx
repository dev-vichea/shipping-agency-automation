import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Geist, JetBrains_Mono } from "next/font/google";
import { TelegramWebAppInitializer } from "@/features/integrations/telegram-web-app-initializer";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Harborway — Shipping operations", template: "%s | Harborway" },
  description: "Internal shipping document and import workspace",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${jetbrainsMono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("harborway-theme");if(t==="dark"){document.documentElement.classList.add("dark")}else{document.documentElement.classList.remove("dark")}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen">
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <TelegramWebAppInitializer />
        <Toaster />
        {children}
      </body>
    </html>
  );
}
