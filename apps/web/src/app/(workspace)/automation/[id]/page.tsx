import Link from "next/link";
import { AutomationAction } from "@/components/forms";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeading, Section, Status } from "@/components/workspace";
import type { CaseDetail, InvestigationRun, Run } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";
import { api } from "@/lib/server-api";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = `/automation/runs/${encodeURIComponent(id)}`;
  const run = await api<Run>(path);
  const [investigation, intake] = await Promise.all([
    run.stage === "investigation" ? api<InvestigationRun>(`${path}/investigation`) : Promise.resolve(null),
    run.intake_case_id ? api<CaseDetail>(`/intakes/${run.intake_case_id}`) : Promise.resolve(null),
  ]);
  return <div className="space-y-4">
    <LiveRefresh active={run.state === "queued" || run.state === "running"} />
    <Link href="/automation" className="data-link text-xs">Automation runs</Link>
    <PageHeading title={label(run.stage)} action={run.state === "failed" && <AutomationAction path={`${path}/retry`}>Retry failed run</AutomationAction>} />
    <Section title="Run details" action={<Status value={run.state} />}>
      <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Company</dt><dd>{intake?.company ?? "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Intake case</dt><dd>{intake ? <Link className="data-link" href={`/review/${intake.id}`}>{intake.detected_reference ?? intake.subject ?? intake.id.slice(0, 8)}</Link> : "—"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Attempt / retries</dt><dd>{run.attempt} / {run.retry_count}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Started</dt><dd>{timestamp(run.started_at)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Finished</dt><dd>{timestamp(run.ended_at)}</dd></div>
        {run.state === "queued" && <div><dt className="text-xs text-muted-foreground">Available at</dt><dd>{timestamp(run.available_at)}</dd></div>}
        {run.error_code && <div><dt className="text-xs text-muted-foreground">Error</dt><dd className="text-danger">{label(run.error_code)}</dd></div>}
        <div><dt className="text-xs text-muted-foreground">Trace ID</dt><dd className="font-mono text-xs break-all">{run.trace_id}</dd></div>
      </dl>
    </Section>
    {investigation && <Section title="AI investigation" action={<Status value={investigation.investigation.status} />}>
      <pre className="max-h-[32rem] overflow-auto p-4 text-xs whitespace-pre-wrap">{JSON.stringify(investigation.investigation, null, 2)}</pre>
    </Section>}
  </div>;
}
