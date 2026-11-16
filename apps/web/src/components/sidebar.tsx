"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Anchor, Building2 } from "lucide-react";
import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Company } from "@/lib/contracts";
import { companyParam, scopedPath } from "@/lib/scope";
import { cn } from "@/lib/utils";
import { isActiveRoute, navGroups, navLinks } from "@/lib/workspace-navigation";

const ALL_COMPANIES = "all";

export function SidebarContents({ expanded, companies, onNavigate, close }: {
  expanded: boolean;
  companies: Company[];
  onNavigate?: () => void;
  close?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const companyId = companyParam(params.get("company_id") ?? undefined);
  const selectedCompany = companies.find((c) => c.id === companyId);
  const currentCompanyName = selectedCompany ? selectedCompany.name : "All companies";

  function switchCompany(value: string) {
    const next = new URLSearchParams(params.toString());
    next.delete("offset");
    next.delete("version");
    if (value === ALL_COMPANIES) next.delete("company_id");
    else next.set("company_id", value);
    const page = navLinks.find(({ href }) => isActiveRoute(pathname, href));
    const targetPath = page?.filtered ? page.href : pathname;
    router.push(next.size ? `${targetPath}?${next.toString()}` : targetPath);
    onNavigate?.();
  }

  return <div className="flex h-full min-h-0 flex-col bg-[#075e7b] text-white">
    <div className="flex h-16 shrink-0 items-center gap-2 border-b border-white/15 px-3">
      <Link href={scopedPath("/home", companyId)} aria-label="Harborway home" onClick={onNavigate} className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-white">
        <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-white/14"><Anchor size={19} strokeWidth={2.15} aria-hidden /></span>
        <span aria-hidden className={cn("overflow-hidden text-base font-semibold whitespace-nowrap tracking-tight motion-safe:transition-opacity motion-safe:duration-150",
          expanded ? "opacity-100" : "opacity-0")}>Harborway</span>
      </Link>
      {close}
    </div>
    <Tooltip.Provider delayDuration={180}>
      <div className={cn("shrink-0 border-b border-white/10", expanded ? "px-2.5 py-1.5" : "px-2 py-1.5 flex justify-center")}>
        <Select value={companyId || ALL_COMPANIES} onValueChange={switchCompany}>
          {expanded ? (
            <SelectTrigger aria-label="Company filter" className="w-full h-8 rounded-md border-0 bg-transparent px-2 text-xs font-medium text-white/90 hover:bg-white/10 hover:text-white shadow-none focus-visible:ring-1 focus-visible:ring-white/30 focus:outline-none [&_svg]:text-white/70 [&_[data-slot=select-label]]:text-white/90">
              <Building2 size={14} className="shrink-0 text-white/70" aria-hidden />
              <span data-slot="select-label" className="min-w-0 truncate text-xs"><SelectValue /></span>
            </SelectTrigger>
          ) : (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <SelectTrigger aria-label="Company filter" className="size-8 justify-center rounded-md border-0 bg-transparent p-0 text-white/90 hover:bg-white/10 hover:text-white shadow-none focus-visible:ring-1 focus-visible:ring-white/30 focus:outline-none [&_svg.ml-auto]:hidden">
                  <Building2 size={15} className="shrink-0 text-white/80" aria-hidden />
                  <span className="sr-only" data-slot="select-label"><SelectValue /></span>
                </SelectTrigger>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={10} className="ui-popup z-60 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white shadow-md">
                  Company: {currentCompanyName}
                  <Tooltip.Arrow className="fill-foreground" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          )}
          <SelectContent className="max-w-xs">
            <SelectItem value={ALL_COMPANIES}>All companies</SelectItem>
            {companies.map((company) => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2.5 py-3 [scrollbar-width:thin]">
        {navGroups.map((group) => <div key={group.label} role="group" aria-label={group.label} className="space-y-1">
          <div className="relative mx-2 flex h-5 items-center">
            <span aria-hidden className={cn("w-full overflow-hidden text-[10px] font-semibold whitespace-nowrap tracking-[0.09em] text-white/82 uppercase motion-safe:transition-opacity", expanded ? "opacity-100" : "opacity-0")}>{group.label}</span>
            {!expanded && <span aria-hidden className="absolute inset-x-1 h-px bg-white/18" />}
          </div>
          {group.links.map(({ href, label, icon: Icon, filtered }) => {
            const active = isActiveRoute(pathname, href);
            const item = <Link href={filtered ? scopedPath(href, companyId) : href} aria-label={label} aria-current={active ? "page" : undefined} onClick={onNavigate}
              className={cn("flex h-10 w-full items-center gap-2.5 overflow-hidden rounded-lg px-3 text-sm font-medium whitespace-nowrap focus-visible:-outline-offset-2 focus-visible:outline-white motion-safe:transition-colors",
                active ? "bg-white/18 text-white shadow-sm" : "text-[#e5f6ff] hover:bg-white/12 hover:text-white")}>
              <Icon size={17} strokeWidth={1.8} className="shrink-0" aria-hidden />
              <span aria-hidden className={cn("truncate motion-safe:transition-opacity motion-safe:duration-150", expanded ? "opacity-100" : "opacity-0")}>{label}</span>
            </Link>;
            return expanded ? <div key={href}>{item}</div> : <Tooltip.Root key={href}>
              <Tooltip.Trigger asChild>{item}</Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={10} className="ui-popup z-60 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-white shadow-md">
                  {label}<Tooltip.Arrow className="fill-foreground" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>;
          })}
        </div>)}
      </nav>
    </Tooltip.Provider>
  </div>;
}

export function Sidebar({ expanded, companies }: { expanded: boolean; companies: Company[] }) {
  return <aside id="desktop-sidebar" className="sticky top-0 hidden h-dvh w-[var(--workspace-sidebar-width)] shrink-0 overflow-hidden border-r border-[#064e67] motion-safe:transition-[width] motion-safe:duration-220 motion-safe:ease-out lg:block">
    <SidebarContents expanded={expanded} companies={companies} />
  </aside>;
}
