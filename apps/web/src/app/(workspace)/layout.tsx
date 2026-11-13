import type { ReactNode } from "react";
import { Brand } from "@/components/workspace";
import { Navigation, SignOut } from "@/components/navigation";
import { staffProfile } from "@/lib/server-api";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const staff = await staffProfile();
  return (
    <div className="min-h-screen">
      <a className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-white focus:p-3" href="#main">Skip to content</a>
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <Brand />
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden max-w-56 truncate text-sm text-muted-foreground sm:inline">{staff.email}</span>
            <SignOut />
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-8"><Navigation /></div>
      </header>
      <main id="main" className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-7 text-xs text-muted-foreground sm:px-8">All times in Cambodia (UTC+7)</footer>
    </div>
  );
}
