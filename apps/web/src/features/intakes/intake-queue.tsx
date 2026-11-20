import { NativeSelect } from "@/components/ui/native-select";
import Link from "next/link";
import { ArrowRight, Plug, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Empty, PageHeading, Section, Status } from "@/components/ui/page-layout";
import { ListPagination } from "@/components/ui/pagination";
import { IntakeForm } from "@/features/intakes/intake-form";
import { LiveRefresh } from "@/lib/live-refresh";
import { FormSheet } from "@/components/ui/form-sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, workspaceList } from "@/lib/server-api";
import type { CaseSummary, Company } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";
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

  return <div className="space-y-4">
    <LiveRefresh active={!!workspace.active_id} interval={items.some((item) => ["queued", "processing"].includes(item.state)) ? 4000 : 15000} />
    <PageHeading title={names[mode]} action={inbox && workspace.active_id && <div className="flex flex-wrap items-center gap-2">
      {admin && <Button asChild variant="outline"><Link href="/integrations"><Plug aria-hidden /> Manage intake sources</Link></Button>}
      <FormSheet title="Upload documents" trigger={<><Upload aria-hidden /> Upload documents</>} openInitially={params.new === "1"}>
        <IntakeForm companies={companies} defaultCompany={companyId} allowUnassigned={admin} />
      </FormSheet>
    </div>} />
    <Section title={inbox ? "Incoming documents" : mode === "approvals" ? "Approval queue" : isImports ? "Import records" : draftView ? "Prepared drafts" : "All cases"}>
      {/* Simple Flat Status Tabs */}
      <nav className="flex border-b bg-background px-2 overflow-x-auto no-scrollbar" aria-label="Queue status filter tabs">
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

      <form action={path} className="flex flex-wrap items-center gap-2 border-b p-3" role="search">
        {companyId && <input type="hidden" name="company_id" value={companyId} />}
        {filter && <input type="hidden" name="filter" value={filter} />}
        <SearchInput name="q" maxLength={160} aria-label="Search intakes" placeholder="Invoice, B/L, company, sender…" defaultValue={q} containerClassName="flex-1 sm:max-w-70" />
        {inbox && <NativeSelect aria-label="Intake source" name="source" defaultValue={source ?? ""}>
          <option value="">All sources</option>{sources.map((id) => <option key={id} value={id}>{label(id)}</option>)}
        </NativeSelect>}
        <NativeSelect aria-label="Sort order" name="sort" defaultValue={oldest ? "oldest" : ""}>
          <option value="">Newest first</option><option value="oldest">Oldest first</option>
        </NativeSelect>
        <Button size="sm" type="submit" variant="outline">Apply</Button>
      </form>
      {items.length ? <Table className="min-w-[960px]">
        <TableHeader><TableRow>
          <TableHead className="w-36">Reference</TableHead>
          <TableHead className="min-w-36 max-w-56">Subject</TableHead>
          <TableHead className="w-32 font-mono">B/L Number</TableHead>
          <TableHead className="w-36">Company</TableHead>
          <TableHead className="w-32">{inbox ? "Source" : "Verification"}</TableHead>
          <TableHead className="w-20 text-center">{inbox ? "Files" : "Findings"}</TableHead>
          <TableHead className="w-40">Received</TableHead>
          <TableHead className="w-24 text-center">Status</TableHead>
          <TableHead className="w-20 text-right"><span className="sr-only">Details</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{items.map((item) => {
          const href = scopedPath(`/review/${item.id}`, companyId);
          const refText = item.detected_reference ?? item.id.slice(0, 8);
          const subjectText = item.subject ?? item.sender ?? "—";
          return <TableRow key={item.id}>
            <TableCell className="max-w-36 truncate font-mono text-code-tabular font-medium">
              <Link href={href} className="data-link block truncate" title={refText}>
                {refText}
              </Link>
            </TableCell>
            <TableCell className="max-w-56 truncate text-muted-foreground" title={subjectText}>
              {subjectText}
            </TableCell>
            <TableCell className="max-w-32 truncate font-mono text-code-tabular">
              {item.bill_of_lading ?? "—"}
            </TableCell>
            <TableCell className="max-w-36 truncate" title={item.company ?? undefined}>
              {item.company ?? "Unassigned"}
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {inbox ? label(item.channel) : item.analysis_outcome ? <Status value={item.analysis_outcome} /> : "—"}
            </TableCell>
            <TableCell className="text-center tabular-nums whitespace-nowrap">
              {inbox ? item.attachment_count : typeof item.issue_count === "number" ? item.issue_count : "—"}
            </TableCell>
            <TableCell className="whitespace-nowrap font-mono text-code-tabular text-muted-foreground">
              {timestamp(item.received_at ?? item.created_at)}
            </TableCell>
            <TableCell className="text-center whitespace-nowrap">
              <Status value={item.state} />
            </TableCell>
            <TableCell className="text-right whitespace-nowrap">
              <Link href={href} aria-label={draftView ? "Review draft" : "Open case"} className="data-link inline-flex items-center gap-1 text-xs">
                <span>Open</span>
                <ArrowRight size={13} aria-hidden />
              </Link>
            </TableCell>
          </TableRow>;
        })}</TableBody>
      </Table> : <Empty>{offset ? "No cases on this page." : q || filter || source ? "No cases match these filters." : draftView ? "No cases waiting for review or approval." : "No documents in this view yet."}</Empty>}
      <ListPagination path={search.size ? `${path}?${search}` : path} offset={offset} count={items.length} hasNext={hasNext} />
    </Section>
  </div>;
}
