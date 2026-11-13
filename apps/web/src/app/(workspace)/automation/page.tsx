import type { Metadata } from "next";
import Link from "next/link";
import { AutomationAction, RefreshButton } from "@/components/forms";
import { Empty, PageHeading, Pagination, Section, Status } from "@/components/workspace";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Provider, Run } from "@/lib/contracts";
import { label, pageSize, parseOffset, timestamp } from "@/lib/format";
import { api } from "@/lib/server-api";

export const metadata: Metadata = { title: "Automation" };

export default async function AutomationPage({ searchParams }: {
  searchParams: Promise<{ offset?: string | string[] }>;
}) {
  const offset = parseOffset((await searchParams).offset);
  const [runs, provider] = await Promise.all([
    api<Run[]>(`/automation/runs?limit=${pageSize}&offset=${offset}`),
    api<Provider>("/automation/provider"),
  ]);
  return <>
    <PageHeading title="Automation" description="Check the background worker, inspect archived arrivals, and retry failed runs."
      action={<div className="flex flex-wrap gap-2"><RefreshButton /><AutomationAction path="/automation/health-check">Run worker check</AutomationAction></div>} />
    <Section title="Background runs">
      {runs.length ? <Table>
        <TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Status</TableHead><TableHead>Retries</TableHead><TableHead>Started</TableHead><TableHead>Finished</TableHead><TableHead>Result</TableHead></TableRow></TableHeader>
        <TableBody>{runs.map((run) => <TableRow key={run.id}>
          <TableCell className="whitespace-normal">
            <div className="font-medium">{run.intake_case_id ? <Link className="text-primary hover:underline" href={`/review/${run.intake_case_id}`}>{label(run.stage)}</Link> : label(run.stage)}</div>
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Trace</summary><code className="break-all">{run.trace_id}</code></details>
          </TableCell>
          <TableCell><Status value={run.state} /></TableCell><TableCell>{run.retry_count}</TableCell>
          <TableCell>{timestamp(run.started_at)}</TableCell><TableCell>{timestamp(run.ended_at)}</TableCell>
          <TableCell className="space-y-1 whitespace-normal">
            {run.error_code ? <p className="text-sm">{label(run.error_code)}</p> : "—"}
            {run.state === "queued" && run.retry_count > 0 && <p className="text-xs text-muted-foreground">Retry after {timestamp(run.available_at)}</p>}
            {run.state === "failed" && <AutomationAction path={`/automation/runs/${run.id}/retry`}>Retry</AutomationAction>}
          </TableCell>
        </TableRow>)}</TableBody>
      </Table> : <Empty>{offset ? "No more runs." : "No runs yet. Archive an arrival or run a worker check."}</Empty>}
    </Section>
    <Pagination path="/automation" offset={offset} count={runs.length} />
    <Section title="Local AI provider">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-sm">
        <div><p className="font-medium">Ollama · {provider.model}</p><p className="mt-1 text-muted-foreground">Availability check only · {provider.context.toLocaleString("en-GB")} context · {provider.max_concurrency} concurrent request</p></div>
        <Status value={provider.state} />
      </div>
    </Section>
  </>;
}
