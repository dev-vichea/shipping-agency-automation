import { NativeSelect } from "@/components/ui/native-select";
import Link from "next/link";
import { ArrowRight, Plug, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Empty, PageHeading, Section, Status } from "@/components/workspace";
import { ListPagination } from "@/components/ui/pagination";
import { IntakeForm } from "@/components/forms";
import { LiveRefresh } from "@/components/live-refresh";
import { RecordDialog } from "@/components/record-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, workspaceList } from "@/lib/server-api";
import type { CaseSummary, Company } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";
import { pageSize, pageWindow, parseOffset } from "@/lib/pagination";
import { companyParam, scopedPath } from "@/lib/scope";
import { cn } from "@/lib/utils";

export type QueueParams = { offset?: string | string[]; filter?: string; q?: string; new?: string; company_id?: string; sort?: string; source?: string };
const reviewStatuses = [["needs_review", "Review required"], ["ready_for_approval", "Ready for approval"]] as const;
const intakeStatuses = [["queued", "Queued"], ["processing", "Processing"], ...reviewStatuses, ["failed", "Failed"], ["approved", "Approved"], ["rejected", "Rejected"]] as const;
const names = { inbox: "Inbox", review: "Intake cases", approvals: "Approvals", drafts: "Draft import records" };
const sources = ["folder", "gmail", "manual"] as const;

export async function IntakeQueue({ mode, params }: { mode: keyof typeof names; params: QueueParams }) {
  const inbox = mode === "inbox";
  const draftView = mode === "approvals" || mode === "drafts";
  const path = mode === "drafts" ? "/imports/drafts" : `/${mode}`;
  const choices = draftView ? reviewStatuses : intakeStatuses;
  const filter = choices.find(([key]) => key === params.filter)?.[0];
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
  if (draftView) query.set("queue", mode === "drafts" ? "draft" : "approval");
  query.set("limit", String(pageSize + 1));
  query.set("offset", String(offset));
  query.set("include_checks", String(!inbox));
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
      <RecordDialog title="Upload documents" trigger={<><Upload aria-hidden /> Upload documents</>} openInitially={params.new === "1"}>
        <IntakeForm companies={companies} defaultCompany={companyId} allowUnassigned={admin} />
      </RecordDialog>
    </div>} />
    {mode === "drafts" && <div className="flex items-center gap-2">
      <Button asChild variant="secondary" size="sm"><Link href={scopedPath("/imports/drafts", companyId)}>Drafts</Link></Button>
      <Button asChild variant="ghost" size="sm"><Link href={scopedPath("/imports", companyId)}>Import register</Link></Button>
    </div>}
    <Section title={inbox ? "Incoming documents" : mode === "approvals" ? "Approval queue" : draftView ? "Prepared drafts" : "All cases"}>
      {/* Simple Flat Status Tabs */}
      <nav className="flex border-b bg-background px-2 overflow-x-auto no-scrollbar" aria-label="Queue status filter tabs">
        {[
          { id: "", name: "All" },
          ...choices.map(([id, name]) => ({ id, name })),
        ].map((tab) => {
          const active = (!filter && tab.id === "") || (filter === tab.id);
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
      {items.length ? <Table className="min-w-[650px]">
        <TableHeader><TableRow>
          <TableHead>{draftView ? "Invoice / reference" : "Reference"}</TableHead><TableHead>Company</TableHead>
          {draftView && <TableHead>B/L number</TableHead>}
          <TableHead>{inbox ? "Source" : "Verification"}</TableHead><TableHead>{inbox ? "Files" : "Findings"}</TableHead>
          <TableHead>Received</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Details</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{items.map((item) => {
          const href = scopedPath(`/review/${item.id}`, companyId);
          return <TableRow key={item.id}>
            <TableCell className="max-w-60"><Link href={href} className="data-link block truncate">{item.detected_reference ?? item.subject ?? item.id.slice(0, 8)}</Link>
              {(inbox ? item.sender ?? item.subject : item.subject) && <p className="truncate text-xs text-muted-foreground">{inbox ? item.sender ?? item.subject : item.subject}</p>}
            </TableCell>
            <TableCell className="max-w-38 truncate" title={item.company ?? undefined}>{item.company ?? "Unassigned"}</TableCell>
            {draftView && <TableCell>{item.bill_of_lading ?? "—"}</TableCell>}
            <TableCell>{inbox ? label(item.channel) : item.analysis_outcome ? <Status value={item.analysis_outcome} /> : "—"}</TableCell>
            <TableCell>{inbox ? item.attachment_count : typeof item.issue_count === "number" ? item.issue_count : "—"}</TableCell>
            <TableCell className="text-muted-foreground">{timestamp(item.received_at ?? item.created_at)}</TableCell>
            <TableCell><Status value={item.state} /></TableCell>
            <TableCell className="text-right"><Link href={href} aria-label={draftView ? "Review draft" : "Open case"} className="inline-flex p-1 text-primary"><ArrowRight size={16} aria-hidden /></Link></TableCell>
          </TableRow>;
        })}</TableBody>
      </Table> : <Empty>{offset ? "No cases on this page." : q || filter || source ? "No cases match these filters." : draftView ? "No cases waiting for review or approval." : "No documents in this view yet."}</Empty>}
      <ListPagination path={search.size ? `${path}?${search}` : path} offset={offset} count={items.length} hasNext={hasNext} />
    </Section>
  </div>;
}
