"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Anchor, Building2, ChevronRight, ChevronsUpDown, Plus, Settings } from "lucide-react";
import { Tooltip } from "radix-ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SignOut } from "@/components/navigation";
import type { Company, Overview, Profile } from "@/lib/contracts";
import { companyParam, scopedPath } from "@/lib/scope";
import { cn } from "@/lib/utils";
import {
  isActiveRoute,
  navLinks,
  navSections,
  type NavEntry,
  type NavGroupItem,
  type NavLink,
} from "@/lib/workspace-navigation";

const ALL_COMPANIES = "all";

export function SidebarContents({
  expanded,
  companies,
  profile,
  counts,
  onNavigate,
  close,
}: {
  expanded: boolean;
  companies: Company[];
  profile?: Profile;
  counts?: Overview;
  onNavigate?: () => void;
  close?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const companyId = companyParam(params.get("company_id") ?? undefined);
  const selectedCompany = companies.find((c) => c.id === companyId);
  const currentCompanyName = selectedCompany ? selectedCompany.name : "All companies";

  // State to track explicit user toggles for accordion groups
  const [userToggledGroups, setUserToggledGroups] = useState<Record<string, boolean>>({});

  function toggleGroup(label: string, currentlyOpen: boolean) {
    setUserToggledGroups((prev) => ({ ...prev, [label]: !currentlyOpen }));
  }

  const switchCompany = useCallback((value: string) => {
    const next = new URLSearchParams(params.toString());
    next.delete("offset");
    next.delete("version");
    if (value === ALL_COMPANIES) next.delete("company_id");
    else next.set("company_id", value);
    const page = navLinks.find(({ href }) => isActiveRoute(pathname, href));
    const targetPath = page?.filtered ? page.href : pathname;
    router.push(next.size ? `${targetPath}?${next.toString()}` : targetPath);
    onNavigate?.();
  }, [params, pathname, router, onNavigate]);

  // Optional keyboard shortcuts: ⌘0 for All companies, ⌘1..⌘9 for first 9 companies
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        if (event.key === "0") {
          event.preventDefault();
          switchCompany(ALL_COMPANIES);
        } else if (/^[1-9]$/.test(event.key)) {
          const index = parseInt(event.key, 10) - 1;
          if (companies[index]) {
            event.preventDefault();
            switchCompany(companies[index].id);
          }
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [companies, switchCompany]);

  function getBadgeCount(badge?: NavLink["badge"]) {
    if (!badge || !counts) return 0;
    if (badge === "needs_review") return counts.cases?.needs_review ?? 0;
    if (badge === "ready_for_approval") return counts.cases?.ready_for_approval ?? 0;
    if (badge === "failed_runs") return counts.runs?.failed ?? 0;
    return 0;
  }

  const avatarInitials = profile?.email
    ? profile.email.split("@")[0].slice(0, 2).toUpperCase()
    : "OP";
  const displayName = profile?.email ? profile.email.split("@")[0] : "Staff Member";
  const roleLabel = "Customs Specialist";

  function renderSingleLink(item: NavLink, isChild = false) {
    const active = isActiveRoute(pathname, item.href);
    const count = getBadgeCount(item.badge);
    const accessibleName = item.ariaLabel ?? item.label;

    const linkContent = (
      <Link
        href={item.filtered ? scopedPath(item.href, companyId) : item.href}
        aria-label={accessibleName}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "group flex w-full items-center gap-2.5 overflow-hidden rounded-md text-xs font-medium whitespace-nowrap transition-colors focus-visible:-outline-offset-2 focus-visible:outline-white",
          isChild ? "h-8 px-2.5" : "h-9 px-2.5",
          active
            ? "bg-white/18 text-white font-semibold shadow-xs"
            : "text-white/90 hover:bg-white/12 hover:text-white"
        )}
      >
        <item.icon
          size={isChild ? 15 : 16}
          strokeWidth={active ? 2.1 : 1.8}
          className="shrink-0 text-white"
          aria-hidden
        />
        <span
          aria-hidden
          className={cn(
            "truncate transition-opacity duration-150",
            expanded ? "opacity-100" : "opacity-0"
          )}
        >
          {item.label}
        </span>
        {expanded && count > 0 && (
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-mono font-medium leading-none",
              item.badge === "failed_runs"
                ? "bg-rose-500/30 text-rose-100 border border-rose-400/40"
                : item.badge === "ready_for_approval"
                ? "bg-amber-400/25 text-amber-200 border border-amber-300/40"
                : "bg-white/20 text-white border border-white/30"
            )}
          >
            {count}
          </span>
        )}
      </Link>
    );

    if (expanded) {
      return <div key={item.href}>{linkContent}</div>;
    }

    return (
      <Tooltip.Root key={item.href}>
        <Tooltip.Trigger asChild>{linkContent}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="right"
            sideOffset={10}
            className="ui-popup z-60 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-background shadow-md"
          >
            {accessibleName}
            <Tooltip.Arrow className="fill-foreground" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }

  function renderGroup(group: NavGroupItem) {
    const isChildActive = group.items.some((item) => isActiveRoute(pathname, item.href));
    const isGroupOpen = userToggledGroups[group.label] !== undefined
      ? userToggledGroups[group.label]
      : true;

    if (!expanded) {
      // In collapsed mode, render child links directly as compact icon rail items with tooltips
      return (
        <div key={group.label} className="space-y-1">
          {group.items.map((item) => renderSingleLink(item, false))}
        </div>
      );
    }

    return (
      <div key={group.label} className="space-y-0.5">
        <button
          type="button"
          onClick={() => toggleGroup(group.label, isGroupOpen)}
          className={cn(
            "group flex h-9 w-full items-center justify-between rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-white/10",
            isChildActive ? "text-white font-semibold" : "text-white/90 hover:text-white"
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <group.icon
              size={16}
              strokeWidth={isChildActive ? 2.1 : 1.8}
              className="shrink-0 text-white"
              aria-hidden
            />
            <span className="truncate">{group.label}</span>
          </div>
          <ChevronRight
            size={14}
            className={cn(
              "shrink-0 text-white transition-transform duration-200",
              isGroupOpen && "rotate-90"
            )}
            aria-hidden
          />
        </button>
        {isGroupOpen && (
          <div className="ml-3.5 space-y-0.5 border-l border-white/20 pl-2.5 my-0.5">
            {group.items.map((item) => renderSingleLink(item, true))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#075e7b] text-white">
      <Tooltip.Provider delayDuration={150}>
        {/* Top Organization / Company Switcher Header (No card background, seamless trigger) */}
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-white/15 px-3">
          <div className="min-w-0 flex-1">
            <Select value={companyId || ALL_COMPANIES} onValueChange={switchCompany}>
              {expanded ? (
                <div className="group flex h-12 w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-white/10 focus-within:ring-1 focus-within:ring-white/40">
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-black/35 text-white font-semibold shadow-xs border border-white/15">
                    {companyId ? <Building2 size={16} aria-hidden /> : <Anchor size={16} aria-hidden />}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                    <SelectTrigger
                      aria-label="Company filter"
                      className="h-auto p-0 border-0 bg-transparent font-semibold text-xs text-white shadow-none focus-visible:ring-0 focus:outline-none [&_svg]:hidden w-full text-left justify-start cursor-pointer hover:bg-transparent"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <span className="truncate text-[10px] text-white/70 pointer-events-none">
                      {selectedCompany?.identifier ? `QIP · ${selectedCompany.identifier}` : "Customs Scope"}
                    </span>
                  </div>
                  <ChevronsUpDown size={14} className="shrink-0 text-white ml-auto pointer-events-none" aria-hidden />
                </div>
              ) : (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <SelectTrigger
                      aria-label="Company filter"
                      className="size-9 justify-center rounded-lg border-0 bg-transparent p-0 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 shadow-none [&_svg.ml-auto]:hidden"
                    >
                      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-black/35 text-white font-semibold border border-white/15">
                        {companyId ? <Building2 size={15} aria-hidden /> : <Anchor size={15} aria-hidden />}
                      </div>
                      <span className="sr-only" data-slot="select-label">
                        <SelectValue />
                      </span>
                    </SelectTrigger>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      sideOffset={10}
                      className="ui-popup z-60 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-background shadow-md"
                    >
                      Company: {currentCompanyName}
                      <Tooltip.Arrow className="fill-foreground" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              )}

              {/* Rich Dropdown Popover matching the user's screenshot */}
              <SelectContent className="w-68 p-1.5 rounded-xl border bg-popover text-popover-foreground shadow-2xl">
                <div className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Companies
                </div>
                <SelectItem
                  value={ALL_COMPANIES}
                  hasCustomText
                  aria-label="All companies"
                  className="rounded-lg py-2 cursor-pointer focus:bg-accent focus:text-accent-foreground"
                >
                  <div className="flex w-full items-center gap-2.5">
                    <div className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-muted/60 text-foreground">
                      <Anchor size={14} aria-hidden />
                    </div>
                    <SelectItemText className="truncate font-medium text-xs flex-1">
                      All companies
                    </SelectItemText>
                    <span className="text-[10px] font-mono text-muted-foreground ml-auto">⌘0</span>
                  </div>
                </SelectItem>
                {companies.map((company, index) => (
                  <SelectItem
                    key={company.id}
                    value={company.id}
                    hasCustomText
                    aria-label={company.name}
                    className="rounded-lg py-2 cursor-pointer focus:bg-accent focus:text-accent-foreground"
                  >
                    <div className="flex w-full items-center gap-2.5">
                      <div className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-muted/60 text-foreground font-semibold text-[11px]">
                        {company.name.slice(0, 2).toUpperCase()}
                      </div>
                      <SelectItemText className="truncate font-medium text-xs flex-1">
                        {company.name}
                      </SelectItemText>
                      <span className="text-[10px] font-mono text-muted-foreground ml-auto">
                        {index < 9 ? `⌘${index + 1}` : company.identifier ?? ""}
                      </span>
                    </div>
                  </SelectItem>
                ))}
                <div className="h-px bg-border my-1" />
                <div className="p-0.5">
                  <Link
                    href="/companies"
                    onClick={() => {
                      onNavigate?.();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <div className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-background">
                      <Plus size={13} aria-hidden />
                    </div>
                    <span>Add company</span>
                  </Link>
                </div>
              </SelectContent>
            </Select>
          </div>
          {close}
        </div>

        {/* Navigation Modules */}
        <nav
          aria-label="Workspace"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-2.5 py-3 [scrollbar-width:thin]"
        >
          {navSections.map((section) => (
            <div key={section.label} role="group" aria-label={section.label} className="space-y-1">
              <div className="relative mx-2 flex h-5 items-center">
                <span
                  aria-hidden
                  className={cn(
                    "w-full overflow-hidden text-[10px] font-semibold uppercase tracking-wider text-white/75 transition-opacity",
                    expanded ? "opacity-100" : "opacity-0"
                  )}
                >
                  {section.label}
                </span>
                {!expanded && <span aria-hidden className="absolute inset-x-1 h-px bg-white/18" />}
              </div>
              {section.entries.map((entry: NavEntry) =>
                entry.type === "link" ? renderSingleLink(entry.item) : renderGroup(entry.group)
              )}
            </div>
          ))}
        </nav>

        {/* Bottom Staff Profile Card (No card background, seamless trigger) */}
        <div className={cn("shrink-0 border-t border-white/15 p-2", expanded ? "px-2.5" : "flex justify-center")}>
          <DropdownMenu>
            {expanded ? (
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Staff profile menu"
                  className="group flex h-12 w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                >
                  <div className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-white font-semibold text-xs border border-white/25">
                    {avatarInitials}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-xs font-semibold text-white">
                      {displayName}
                    </span>
                    <span className="truncate text-[10px] text-white/70">
                      {roleLabel}
                    </span>
                  </div>
                  <ChevronsUpDown size={14} className="shrink-0 text-white ml-auto" aria-hidden />
                </button>
              </DropdownMenuTrigger>
            ) : (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Staff profile menu"
                      className="grid size-8 place-items-center rounded-full bg-white/15 text-white font-semibold text-xs border border-white/25 hover:bg-white/25 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                    >
                      {avatarInitials}
                    </button>
                  </DropdownMenuTrigger>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="right"
                    sideOffset={10}
                    className="ui-popup z-60 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-background shadow-md"
                  >
                    {profile?.email ?? "Staff Profile"}
                    <Tooltip.Arrow className="fill-foreground" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            )}
            <DropdownMenuContent side={expanded ? "top" : "right"} align={expanded ? "start" : "end"} className="w-56 mb-1 rounded-xl shadow-2xl">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-xs font-semibold leading-none">{displayName}</p>
                  <p className="text-[11px] leading-none text-muted-foreground truncate">{profile?.email}</p>
                  <p className="text-[10px] font-mono uppercase text-primary font-medium pt-0.5">{roleLabel}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings" aria-label="Settings">
                  <Settings size={14} className="mr-2" aria-hidden /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <SignOut />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Tooltip.Provider>
    </div>
  );
}

export function Sidebar({
  expanded,
  companies,
  profile,
  counts,
}: {
  expanded: boolean;
  companies: Company[];
  profile?: Profile;
  counts?: Overview;
}) {
  return (
    <aside
      id="desktop-sidebar"
      className="sticky top-0 hidden h-dvh w-[var(--workspace-sidebar-width)] shrink-0 overflow-hidden border-r border-[#064e67] bg-[#075e7b] motion-safe:transition-[width] motion-safe:duration-220 motion-safe:ease-out lg:block"
    >
      <SidebarContents
        expanded={expanded}
        companies={companies}
        profile={profile}
        counts={counts}
      />
    </aside>
  );
}
