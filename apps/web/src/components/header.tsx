"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, ClipboardCheck, Settings, UserRound, Workflow } from "lucide-react";
import { SignOut } from "@/components/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SearchInput } from "@/components/ui/search-input";
import type { Overview, Profile, WorkspaceList } from "@/lib/contracts";
import { companyParam, scopedPath } from "@/lib/scope";
import { isActiveRoute, navLinks } from "@/lib/workspace-navigation";

export function Header({ profile, workspace, counts, sidebarControl }: {
  profile: Profile; workspace: WorkspaceList; counts: Overview; sidebarControl: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const companyId = companyParam(params.get("company_id") ?? undefined);
  const page = navLinks.find(({ href }) => isActiveRoute(pathname, href));
  const hasWorkspace = workspace.workspaces.length > 0;
  const pending = profile.approval_alerts ? (counts.cases.ready_for_approval ?? 0) + (counts.cases.needs_review ?? 0) : 0;
  const failed = profile.automation_alerts ? counts.runs.failed ?? 0 : 0;

  return <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b bg-card px-page lg:px-page-desktop">
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {sidebarControl}
      <nav aria-label="Breadcrumb" className="min-w-0 truncate text-sm font-semibold">
        <Link href={page?.filtered ? scopedPath(page.href, companyId) : page?.href ?? "/home"}>{page?.label ?? "Workspace"}</Link>
      </nav>
    </div>
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <form role="search" aria-label="Workspace search" action="/review" className="w-24 sm:w-48 md:w-60">
        {companyId && <input type="hidden" name="company_id" value={companyId} />}
        <SearchInput name="q" maxLength={160} aria-label="Search shipments" placeholder="Search…" submitLabel="Submit shipment search" className="h-8 border-0 bg-transparent text-xs shadow-none hover:bg-muted/40 focus:bg-muted/40 sm:text-sm" />
      </form>
      <ThemeToggle />
      {hasWorkspace && <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="outline" aria-label={`Notifications, ${pending + failed} items`} className="relative text-muted-foreground">
            <Bell aria-hidden />
            {pending + failed > 0 && <span aria-hidden className="absolute top-[5px] right-[6px] size-1.5 rounded-full bg-primary ring-2 ring-card" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Needs attention</DropdownMenuLabel>
          {profile.approval_alerts && <DropdownMenuItem asChild><Link href="/approvals"><ClipboardCheck aria-hidden /> {pending} cases to review</Link></DropdownMenuItem>}
          {profile.automation_alerts && <DropdownMenuItem asChild><Link href="/automation?state=failed"><Workflow aria-hidden /> {failed} failed runs</Link></DropdownMenuItem>}
          {!profile.approval_alerts && !profile.automation_alerts && <DropdownMenuItem asChild><Link href="/settings">Alerts are paused</Link></DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="icon-sm" variant="outline" aria-label="Account menu" className="rounded-full border-primary/15 bg-accent text-primary hover:bg-primary/12"><UserRound aria-hidden /></Button></DropdownMenuTrigger>
        <DropdownMenuContent className="w-57">
          <DropdownMenuLabel className="truncate px-2 py-1.5 text-xs font-medium" title={profile.email}>{profile.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><Link href="/settings"><Settings aria-hidden /> Settings</Link></DropdownMenuItem>
          <SignOut />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </header>;
}
