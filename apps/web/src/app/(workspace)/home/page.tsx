import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, CheckCheck, ClipboardCheck, Inbox, LoaderCircle, Plus, Upload, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, Section, Status } from "@/components/ui/page-layout";
import type { CaseSummary, Company, Overview, Run } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";
import { companyParam, scopedPath } from "@/lib/scope";
import { api, workspaceList } from "@/lib/server-api";
import { LiveRefresh } from "@/lib/live-refresh";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ company_id?: string }> }) {
  const companyId = companyParam((await searchParams).company_id);
  const [overview, companies, cases, runs, workspace] = await Promise.all([
    api<Overview>(scopedPath("/workspace/overview", companyId)),
    api<Company[]>(companyId ? "/companies?limit=100" : "/companies?limit=5"),
    api<CaseSummary[]>(scopedPath("/intakes?limit=5", companyId)),
    api<Run[]>(scopedPath("/automation/runs?limit=5", companyId)),
    workspaceList(),
  ]);
  const activeWorkspace = workspace.workspaces.find((entry) => entry.id === workspace.active_id);
  const companyRows = companyId ? companies.filter((company) => company.id === companyId) : companies;
  const number = (value: number) => value.toLocaleString("en-GB");
  const metrics = [
    { title: "Incoming cases", value: Object.values(overview.cases).reduce((sum, value) => sum + value, 0), icon: Inbox, href: "/inbox" },
    { title: "Processing", value: overview.processing, icon: LoaderCircle, href: "/automation?state=running" },
    { title: "Pending approvals", value: overview.cases.ready_for_approval ?? 0, icon: ClipboardCheck, href: "/approvals?filter=ready_for_approval" },
    { title: "Completed runs", value: overview.runs.succeeded ?? 0, icon: CheckCheck, href: "/automation?state=succeeded" },
  ];
  const failed = overview.runs.failed ?? 0;

  return <div className="space-y-5">
    <LiveRefresh active={!!activeWorkspace} interval={overview.processing || overview.cases.queued ? 5000 : 15000} />
    <header className="flex flex-wrap items-center justify-between gap-3 pb-1">
      <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.035em]">Operations overview</h1>
      {activeWorkspace
        ? <Button asChild><Link href={scopedPath("/inbox?new=1", companyId)}><Upload aria-hidden /> Upload documents</Link></Button>
        : <Button asChild><Link href="/settings"><Plus aria-hidden /> Create workspace</Link></Button>}
    </header>
    <div className="grid grid-cols-2 divide-y divide-border rounded-lg border bg-card shadow-xs xl:grid-cols-4 xl:divide-y-0 xl:divide-x divide-border gap-0 overflow-hidden">
      {metrics.map(({ title, value, href, icon: Icon }) => <Link key={title} href={scopedPath(href, companyId)}
        className="group flex min-h-24 items-start justify-between gap-2 p-4 transition-colors hover:bg-muted/40 sm:p-5">
        <div>
          <span className="text-[13px] font-medium text-muted-foreground">{title}</span>
          <div className="mt-1.5 text-[28px] leading-none font-semibold tracking-tight">{number(value)}</div>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted/60 text-muted-foreground group-hover:text-primary"><Icon size={17} strokeWidth={1.8} aria-hidden /></span>
      </Link>)}
    </div>
    {failed > 0 && <Link href={scopedPath("/automation?state=failed", companyId)}
      className="flex items-center justify-between rounded-lg border border-warning-border bg-warning-fill px-4 py-3 text-warning">
      <span className="font-medium">{number(failed)} failed {failed === 1 ? "run needs" : "runs need"} attention</span><ArrowRight size={15} aria-hidden />
    </Link>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <Section title="Recent intake" action={<ViewAll href={scopedPath("/inbox", companyId)} />}>
        {cases.length ? <Table className="min-w-[420px]">
          <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Company</TableHead><TableHead>Received</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>{cases.map((item) => <TableRow key={item.id}>
            <TableCell className="max-w-52 truncate"><Link className="data-link" href={`/review/${item.id}`}>{item.detected_reference ?? item.subject ?? item.id.slice(0, 8)}</Link></TableCell>
            <TableCell className="max-w-40 truncate">{item.company ?? "Unassigned"}</TableCell>
            <TableCell className="text-muted-foreground">{timestamp(item.received_at ?? item.created_at)}</TableCell>
            <TableCell><Status value={item.state} /></TableCell>
          </TableRow>)}</TableBody>
        </Table> : <Empty>No documents received yet.</Empty>}
      </Section>
      <Section title="Recent automation" action={<ViewAll href={scopedPath("/automation", companyId)} />}>
        {runs.length ? <ul className="divide-y">
          {runs.map((run) => <li key={run.id}>
            <Link href={`/automation/${run.id}`} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 hover:bg-muted">
              <span className="flex min-w-0 items-center gap-2.5"><Workflow size={15} className="shrink-0 text-primary" aria-hidden />{label(run.stage)}</span>
              <Status value={run.state} />
            </Link>
          </li>)}
        </ul> : <Empty>No automation runs yet.</Empty>}
      </Section>
    </div>
    <Section title="Companies" action={activeWorkspace?.role === "admin"
      ? <Button asChild size="sm" variant="outline"><Link href="/companies?new=1"><Plus aria-hidden /> Add company</Link></Button>
      : <ViewAll href="/companies" />}>
      {companyRows.length ? <Table className="min-w-[450px]">
        <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Identifier</TableHead><TableHead>Contact</TableHead><TableHead><span className="sr-only">Details</span></TableHead></TableRow></TableHeader>
        <TableBody>{companyRows.map((company) => <TableRow key={company.id}>
          <TableCell><Link href={`/companies/${company.id}`} className="inline-flex items-center gap-2.5 font-medium hover:text-primary"><Building2 className="text-primary" size={15} aria-hidden /> {company.name}</Link></TableCell>
          <TableCell className="text-muted-foreground">{company.identifier ?? "—"}</TableCell>
          <TableCell className="text-muted-foreground">{company.contact_name ?? company.contact_email ?? "—"}</TableCell>
          <TableCell className="text-right"><Link href={`/companies/${company.id}`} aria-label={`Open ${company.name}`} className="inline-flex text-primary"><ArrowRight size={15} aria-hidden /></Link></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <Empty>No companies in this view.</Empty>}
    </Section>
  </div>;
}

function ViewAll({ href }: { href: string }) {
  return <Link href={href} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">View all <ArrowRight size={13} aria-hidden /></Link>;
}
