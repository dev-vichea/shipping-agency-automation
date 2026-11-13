import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHeading, Pagination, Section, Status } from "@/components/workspace";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CaseSummary } from "@/lib/contracts";
import { pageSize, parseOffset, timestamp } from "@/lib/format";
import { api } from "@/lib/server-api";

export const metadata: Metadata = { title: "Review Center" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ offset?: string | string[] }> }) {
  const offset = parseOffset((await searchParams).offset);
  const cases = await api<CaseSummary[]>(`/intakes?limit=${pageSize}&offset=${offset}`);
  return <>
    <PageHeading title="Review Center" description="Inspect source documents, check discrepancies, and compare CDC candidates." />
    <Section title="Intakes">
      {cases.length ? <Table>
        <TableHeader><TableRow><TableHead>Intake</TableHead><TableHead>Invoice reference</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader>
        <TableBody>{cases.map((item) => <TableRow key={item.id}>
          <TableCell><Link href={`/review/${item.id}`} className="font-medium text-primary hover:underline">{item.subject || "Untitled arrival"}</Link></TableCell>
          <TableCell>{item.detected_reference ?? "Pending"}</TableCell>
          <TableCell><Status value={item.state} /></TableCell>
          <TableCell>{timestamp(item.updated_at)}</TableCell>
        </TableRow>)}</TableBody>
      </Table> : <Empty>{offset ? "No more intakes." : "No intakes to review yet."}</Empty>}
    </Section>
    <Pagination path="/review" offset={offset} count={cases.length} />
  </>;
}
