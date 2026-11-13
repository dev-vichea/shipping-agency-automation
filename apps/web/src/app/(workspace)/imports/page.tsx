import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeading, Pagination, Section, Status } from "@/components/workspace";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportSummary } from "@/lib/contracts";
import { pageSize, parseOffset, timestamp } from "@/lib/format";
import { api } from "@/lib/server-api";

export const metadata: Metadata = { title: "Imports" };

export default async function ImportsPage({ searchParams }: {
  searchParams: Promise<{ offset?: string | string[] }>;
}) {
  const offset = parseOffset((await searchParams).offset);
  const records = await api<ImportSummary[]>(`/imports?limit=${pageSize}&offset=${offset}`);
  return <>
    <PageHeading title="Imports" description="Track manually entered import drafts and the originals attached to each intake." />
    <Section title="Import drafts">
      {records.length ? <Table>
        <TableHeader><TableRow><TableHead>Invoice no.</TableHead><TableHead>Company</TableHead><TableHead>Supplier</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
        <TableBody>{records.map((record) => <TableRow key={record.id}>
          <TableCell><Link className="font-medium text-primary hover:underline" href={`/imports/${record.id}`}>{record.invoice_no}</Link></TableCell>
          <TableCell>{record.company}</TableCell><TableCell>{record.supplier || "—"}</TableCell>
          <TableCell><Status value={record.state} /></TableCell><TableCell>{timestamp(record.created_at)}</TableCell>
        </TableRow>)}</TableBody>
      </Table> : <Empty>{offset ? "No more drafts." : <>No import drafts yet. <Link href="/inbox" className="font-medium text-primary underline">Open an intake to create a draft.</Link></>}</Empty>}
    </Section>
    <Pagination path="/imports" offset={offset} count={records.length} />
  </>;
}
