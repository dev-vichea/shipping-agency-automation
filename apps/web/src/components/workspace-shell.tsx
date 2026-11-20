"use client";

import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Header } from "@/components/header";
import { Sidebar, SidebarContents } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { DialogCloseButton } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Company } from "@/lib/contracts";
import { SIDEBAR_COOKIE } from "@/lib/workspace-navigation";

export function WorkspaceShell({ children, initiallyExpanded, companies, ...header }: Omit<ComponentProps<typeof Header>, "sidebarControl"> & {
  companies: Company[]; children: ReactNode; initiallyExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    function closeOnDesktop(event: MediaQueryListEvent) {
      if (event.matches) setMobileOpen(false);
    }
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function toggleSidebar() {
    const next = !expanded;
    setExpanded(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "expanded" : "collapsed"}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  const toggleLabel = expanded ? "Collapse sidebar" : "Expand sidebar";
  return <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
    <div data-sidebar={expanded ? "expanded" : "collapsed"} className="workspace-shell min-h-screen bg-background lg:flex">
      <a className="sr-only focus:not-sr-only focus:fixed focus:z-60 focus:bg-card focus:p-3" href="#main">Skip to content</a>
      <Sidebar expanded={expanded} companies={companies} profile={header.profile} counts={header.counts} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Header {...header} sidebarControl={<>
          <Button type="button" size="icon-sm" variant="ghost" className="hidden lg:inline-flex" aria-controls="desktop-sidebar"
            aria-expanded={expanded} aria-label={toggleLabel} title={toggleLabel} onClick={toggleSidebar}>
            {expanded ? <PanelLeftClose aria-hidden /> : <PanelLeftOpen aria-hidden />}
          </Button>
          <SheetTrigger asChild><Button type="button" size="icon-sm" variant="ghost" className="lg:hidden" aria-label="Open navigation"><Menu aria-hidden /></Button></SheetTrigger>
        </>} />
        <main id="main" className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 px-page py-6 lg:px-page-desktop lg:py-7">
          {children}
        </main>
      </div>
    </div>
    <SheetContent side="left" className="max-w-[min(18rem,calc(100%_-_2rem))] overflow-hidden border-[#064e67] bg-[#075e7b] p-0" aria-describedby={undefined}>
      <SheetTitle className="sr-only">Navigation</SheetTitle>
      <SidebarContents expanded companies={companies} profile={header.profile} counts={header.counts} onNavigate={() => setMobileOpen(false)} close={
        <DialogCloseButton label="Close navigation" className="ml-auto shrink-0 text-white hover:bg-white/15 hover:text-white focus-visible:ring-white/60" />
      } />
    </SheetContent>
  </Sheet>;
}
