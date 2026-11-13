import Link from "next/link";
import { Empty, Originals, PageHeading, Section, Status } from "@/components/workspace";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportDetail } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";
import { api } from "@/lib/server-api";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await api<ImportDetail>(`/imports/${encodeURIComponent(id)}`);
  const fields = [
    ["Company", record.company], ["Supplier", record.supplier || "—"],
    ["Consignee", record.consignee || "—"], ["Created", timestamp(record.created_at)],
    ["ETD", record.etd || label(record.etd_status)], ["ETA", record.eta || label(record.eta_status)],
  ];
  return <>
    <Link className="text-sm font-medium text-primary hover:underline" href="/imports">← Imports</Link>
    <PageHeading title={record.invoice_no} description="Import draft · pending approval" action={<Status value={record.state} />} />
    <Section title="Overview">
      <dl className="grid gap-5 px-5 py-5 text-sm sm:grid-cols-2 md:grid-cols-3">
        {fields.map(([field, value]) => <div key={field}><dt className="text-muted-foreground">{field}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
        <div><dt className="text-muted-foreground">Provenance</dt><dd className="mt-1"><Link className="font-medium text-primary hover:underline" href={`/review/${record.intake_case_id}`}>Open source intake</Link></dd></div>
      </dl>
    </Section>
    <Section title="Original attachments"><Originals documents={record.documents} /></Section>
    <Section title="Items">
      {record.items.length ? <Table>
        <TableHeader><TableRow><TableHead>Line</TableHead><TableHead>Description</TableHead><TableHead>Quantity</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>{record.items.map((item) => <TableRow key={item.id}>
          <TableCell>{item.line_no}</TableCell><TableCell>{item.normalized_description ?? item.raw_description}</TableCell>
          <TableCell>{item.quantity ? `${item.quantity} ${item.unit ?? ""}` : "—"}</TableCell>
          <TableCell>{item.amount ? `${item.amount} ${item.currency ?? ""}` : "—"}</TableCell>
          <TableCell><Status value={item.verification_state} /></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <Empty>No item lines yet. Item extraction and review are not available in this phase.</Empty>}
    </Section>
  </>;
}
