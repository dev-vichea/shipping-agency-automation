import { NativeSelect } from "@/components/ui/native-select";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AutomationAction } from "@/features/automation/automation-action";
import { LiveRefresh } from "@/lib/live-refresh";
import { Button } from "@/components/ui/button";
import { Empty, PageHeading, Section, Status } from "@/components/ui/page-layout";
import { ListPagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Run } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";
import { pageSize, pageWindow, parseOffset } from "@/lib/pagination";
import { api, workspaceList } from "@/lib/server-api";
import { companyParam, scopedPath } from "@/lib/scope";

export const metadata: Metadata = { title: "Automation runs" };

export default async function AutomationPage({ searchParams }: {
  searchParams: Promise<{ offset?: string | string[]; company_id?: string; state?: string }>;
}) {
  const params = await searchParams;
  const offset = parseOffset(params.offset);
  const companyId = companyParam(params.company_id);
  const states = ["queued", "running", "succeeded", "failed"];
  const filter = params.state && states.includes(params.state) ? params.state : "";
  const query = filter ? `&state=${filter}` : "";
  const [results, workspace] = await Promise.all([
    api<Run[]>(scopedPath(`/automation/runs?limit=${pageSize + 1}&offset=${offset}${query}`, companyId)),
    workspaceList(),
  ]);
  const { items: runs, hasNext } = pageWindow(results);
  const admin = workspace.workspaces.some(({ id, role }) => id === workspace.active_id && role === "admin");
  return <div className="space-y-4">
    <LiveRefresh active={!!workspace.active_id} interval={5000} />
    <PageHeading title="Automation runs" action={admin && !companyId && <AutomationAction path="/automation/health-check">Run worker check</AutomationAction>} />
    <Section title="Run history">
      <form action="/automation" className="flex items-center gap-2 border-b p-3">
        {companyId && <input type="hidden" name="company_id" value={companyId} />}
        <NativeSelect name="state" aria-label="Run status" defaultValue={filter}>
          <option value="">All statuses</option>{states.map((state) => <option key={state} value={state}>{label(state)}</option>)}
        </NativeSelect>
        <Button size="sm" variant="outline">Apply</Button>
      </form>
      {runs.length ? <Table className="min-w-[660px]">
        <TableHeader><TableRow><TableHead>Step</TableHead><TableHead>Status</TableHead><TableHead>Retries</TableHead>
          <TableHead>Started</TableHead><TableHead>Finished</TableHead><TableHead>Error</TableHead><TableHead><span className="sr-only">Details</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{runs.map((run) => <TableRow key={run.id}>
          <TableCell><Link className="data-link" href={scopedPath(`/automation/${run.id}`, companyId)}>{label(run.stage)}</Link></TableCell>
          <TableCell><Status value={run.state} /></TableCell><TableCell>{run.retry_count}</TableCell>
          <TableCell className="text-muted-foreground">{timestamp(run.started_at)}</TableCell><TableCell className="text-muted-foreground">{timestamp(run.ended_at)}</TableCell>
          <TableCell className={run.error_code ? "text-danger" : "text-muted-foreground"}>{run.error_code ? label(run.error_code) : "—"}</TableCell>
          <TableCell className="text-right"><Link aria-label="Open run" className="inline-flex text-primary" href={`/automation/${run.id}`}><ArrowRight size={15} aria-hidden /></Link></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <Empty>{offset ? "No runs on this page." : "No runs in this view."}</Empty>}
      <ListPagination path={scopedPath(filter ? `/automation?state=${filter}` : "/automation", companyId)}
        offset={offset} count={runs.length} hasNext={hasNext} />
    </Section>
  </div>;
}
