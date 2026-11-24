import Link from "next/link";
import { Plug, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, PageHeading } from "@/components/ui/page-layout";
import { ListPagination } from "@/components/ui/pagination";
import { IntakeForm } from "@/features/intakes/intake-form";
import { IntakeTableView } from "@/features/intakes/intake-table-view";
import { IntakeQueueToolbar } from "@/features/intakes/intake-queue-toolbar";
import { LiveRefresh } from "@/lib/live-refresh";
import { FormSheet } from "@/components/ui/form-sheet";
import { api, workspaceList } from "@/lib/server-api";
import type { CaseSummary, Company } from "@/lib/contracts";
import { pageSize, pageWindow, parseOffset } from "@/lib/pagination";
import { companyParam, scopedPath } from "@/lib/scope";
import { cn } from "@/lib/utils";

export type QueueParams = { offset?: string | string[]; filter?: string; q?: string; new?: string; company_id?: string; sort?: string; source?: string };
const reviewStatuses = [["needs_review", "Review"], ["ready_for_approval", "Ready"]] as const;
const importStatuses = [["needs_review", "Review"], ["ready_for_approval", "Verified"], ["approved", "Approved"]] as const;
const intakeStatuses = [["queued", "Queued"], ["processing", "Processing"], ...reviewStatuses, ["awaiting_updated_document", "Awaiting Doc"], ["manual_matching", "Manual Match"], ["failed", "Failed"], ["approved", "Approved"], ["rejected", "Rejected"]] as const;
const names = { inbox: "Inbox", review: "Intake cases", approvals: "Approvals", drafts: "Draft import records", imports: "Import records" };
const sources = ["folder", "gmail", "manual"] as const;

export async function IntakeQueue({ mode, params }: { mode: keyof typeof names; params: QueueParams }) {
  const inbox = mode === "inbox";
  const isImports = mode === "imports";
  const draftView = mode === "approvals" || mode === "drafts" || isImports;
  const path = mode === "drafts" ? "/imports/drafts" : mode === "imports" ? "/imports" : `/${mode}`;
  const choices = isImports ? importStatuses : draftView ? reviewStatuses : intakeStatuses;
  const defaultFilter = isImports ? "needs_review" : undefined;
  const filter = choices.find(([key]) => key === params.filter)?.[0] ?? defaultFilter;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 160) : "";
  const companyId = companyParam(params.company_id);
  const oldest = params.sort === "oldest";
  const offset = parseOffset(params.offset);
  const source = inbox ? sources.find((entry) => entry === params.source) : undefined;
  const search = new URLSearchParams();
  if (q) search.set("q", q);
  if (companyId) search.set("company_id", companyId);
  if (source) search.set("source", source);
  const query = new URLSearchParams(search);
  if (filter) query.set(filter === "processing" ? "run_state" : "state", filter === "processing" ? "running" : filter);
  if (draftView) query.set("queue", isImports ? "imports" : mode === "drafts" ? "draft" : "approval");
  query.set("limit", String(pageSize + 1));
  query.set("offset", String(offset));
  query.set("include_checks", "true");
  if (oldest) query.set("oldest_first", "true");
  if (filter) search.set("filter", filter);
  if (oldest) search.set("sort", "oldest");
  const [results, companies, workspace] = await Promise.all([
    api<CaseSummary[]>(`/intakes?${query}`),
    inbox ? api<Company[]>("/companies?limit=100") : Promise.resolve([]),
    workspaceList(),
  ]);
  const { items, hasNext } = pageWindow(results);
  const admin = workspace.workspaces.some(({ id, role }) => id === workspace.active_id && role === "admin");

  return (
    <div className="space-y-3">
      <LiveRefresh active={!!workspace.active_id} interval={items.some((item) => ["queued", "processing"].includes(item.state)) ? 4000 : 15000} />
      <PageHeading title={names[mode]} action={inbox && workspace.active_id && <div className="flex flex-wrap items-center gap-2">
        {admin && <Button asChild variant="outline"><Link href="/integrations"><Plug aria-hidden /> Manage intake sources</Link></Button>}
        <FormSheet title="Upload documents" trigger={<><Upload aria-hidden /> Upload documents</>} openInitially={params.new === "1"}>
          <IntakeForm companies={companies} defaultCompany={companyId} allowUnassigned={admin} />
        </FormSheet>
      </div>} />

      {/* Search and Action controls OUTSIDE the table container, NO background, modern dropdowns */}
      <IntakeQueueToolbar
        path={path}
        q={q}
        companyId={companyId}
        filter={filter}
        source={source}
        oldest={oldest}
        inbox={inbox}
        sources={sources}
      />

      {/* Table container: Tab Bar KEPT inside the table */}
      <div className="panel overflow-hidden">
        {/* Flat Status Tabs kept inside table panel */}
        <nav className="flex border-b bg-card/60 px-2 overflow-x-auto no-scrollbar" aria-label="Queue status filter tabs">
          {(isImports
            ? choices.map(([id, name]) => ({ id, name }))
            : [{ id: "", name: "All" }, ...choices.map(([id, name]) => ({ id, name }))]
          ).map((tab) => {
            const active = isImports ? filter === tab.id : (!filter && tab.id === "") || (filter === tab.id);
            const tabParams = new URLSearchParams(search);
            if (tab.id) tabParams.set("filter", tab.id);
            else tabParams.delete("filter");
            tabParams.set("offset", "0");
            const tabHref = scopedPath(`${path}?${tabParams.toString()}`, companyId);
            return (
              <Link
                key={tab.id}
                href={tabHref}
                className={cn(
                  "cursor-pointer border-b-2 px-4 py-2 text-xs font-semibold transition-all focus-visible:outline-offset-[-2px] flex items-center gap-1.5 whitespace-nowrap",
                  active
                    ? "border-primary text-primary font-bold"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <span>{tab.name}</span>
              </Link>
            );
          })}
        </nav>

        {items.length ? (
          <IntakeTableView
            items={items}
            companyId={companyId}
            inbox={inbox}
            draftView={draftView}
            mode={mode}
          />
        ) : (
          <Empty>{offset ? "No cases on this page." : q || filter || source ? "No cases match these filters." : draftView ? "No cases waiting for review or approval." : "No documents in this view yet."}</Empty>
        )}
        <ListPagination path={search.size ? `${path}?${search}` : path} offset={offset} count={items.length} hasNext={hasNext} />
      </div>
    </div>
  );
}
