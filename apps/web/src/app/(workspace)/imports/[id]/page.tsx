import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermitRelease } from "@/components/permit-release";
import { ListPagination } from "@/components/ui/pagination";
import { Empty, Originals, PageHeading, Section, Status } from "@/components/workspace";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportDetail, PermitDraft, ReviewWorkflow } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";
import { lastPageOffset, pageSize, parseOffset } from "@/lib/pagination";
import { companyParam, scopedPath } from "@/lib/scope";
import { api } from "@/lib/server-api";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Import ${id.slice(0, 8)}` };
}

export default async function ImportPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ offset?: string; company_id?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const record = await api<ImportDetail>(`/imports/${encodeURIComponent(id)}`);
  const offset = Math.min(parseOffset(query.offset), lastPageOffset(record.items.length));
  const items = record.items.slice(offset, offset + pageSize);
  const [drafts, workflow] = record.state === "approved" ? await Promise.all([
    api<PermitDraft[]>(`/imports/${encodeURIComponent(id)}/permit-drafts`),
    api<ReviewWorkflow>(`/intakes/${record.intake_case_id}/review`),
  ]) : [[], null];
  const permitPending = workflow?.decisions.find((event) => event.scope === "intake" && event.decision === "approved")?.permit_pending;
  const fields = [
    ["Company", record.company], ["Supplier", record.supplier || "—"], ["Consignee", record.consignee || "—"],
    ["Created", timestamp(record.created_at)], ["ETD", record.etd || label(record.etd_status)], ["ETA", record.eta || label(record.eta_status)],
  ];
  return <div className="space-y-gutter lg:space-y-gutter-desktop">
    <PageHeading title={record.invoice_no} description={record.approved_at ? `Approved ${timestamp(record.approved_at)}` : "Import draft · pending approval"} code action={<Status value={record.state} />} />
    <Section title="Overview" action={<Button asChild size="xs" variant="outline"><Link href={`/review/${record.intake_case_id}`}>Open source intake <ArrowUpRight aria-hidden /></Link></Button>}>
      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
        {fields.map(([field, value], index) => <div key={field} className="min-w-0 bg-card px-3 py-2.5">
          <dt className="panel-label">{field}</dt>
          <dd className={`mt-1 break-words ${index >= 3 ? "font-mono text-code-tabular" : "text-body-md"}`}>{value}</dd>
        </div>)}
      </dl>
    </Section>
    <Section title="Original attachments"><Originals documents={record.documents} /></Section>
    {record.state === "approved" && <Section title="Permit drafts">
      {permitPending && <div className="flex flex-wrap items-center gap-2 border-b border-warning-border bg-warning-fill p-3 text-body-sm text-warning">
        <Status value="pending" /><p>{permitPending}</p>
      </div>}
      {drafts.map((draft) => <div className="space-y-3 border-b p-3 last:border-b-0" key={draft.id}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-control border border-primary/20 bg-accent text-primary"><FileSpreadsheet aria-hidden size={16} /></span>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-headline-sm">Permit INV / PL</h3><Status value="unsubmitted" /></div>
              <p className="font-mono text-code-tabular text-muted-foreground">Revision {draft.revision} · {timestamp(draft.created_at)}{!draft.current && " · Prior revision"}</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm"><a href={`/api/v1/imports/${record.id}/permit-drafts/${draft.id}/download`}><Download aria-hidden />Download permit draft</a></Button>
        </div>
        {draft.current && <PermitRelease importId={record.id} draftId={draft.id} recipient={draft.recipient ?? undefined} />}
      </div>)}
      {drafts.length === 0 && !permitPending && <Empty>No permit draft has been generated.</Empty>}
    </Section>}
    <Section title="Items">
      {items.length ? <Table className="min-w-[480px]">
        <TableHeader><TableRow>
          <TableHead>Line</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Quantity</TableHead>
          <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Status</TableHead>
        </TableRow></TableHeader>
        <TableBody>{items.map((item) => <TableRow key={item.id}>
          <TableCell className="font-mono text-code-tabular text-muted-foreground">{item.line_no}</TableCell>
          <TableCell className="max-w-80 whitespace-normal">{item.normalized_description ?? item.raw_description}</TableCell>
          <TableCell className="text-right font-mono text-code-tabular">{item.quantity ? [item.quantity, item.unit].filter(Boolean).join(" ") : "—"}</TableCell>
          <TableCell className="text-right font-mono text-code-tabular">{item.amount ? [item.amount, item.currency].filter(Boolean).join(" ") : "—"}</TableCell>
          <TableCell className="text-right"><Status value={item.verification_state} /></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <Empty>No line items are saved in this draft. Review extracted lines in the source intake.</Empty>}
      <ListPagination path={scopedPath(`/imports/${record.id}`, companyParam(query.company_id))} label="Import items" offset={offset}
        count={items.length} total={record.items.length} />
    </Section>
  </div>;
}
