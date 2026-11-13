import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Empty, PageHeading, Pagination, Section, Status } from "@/components/workspace";
import { IntakeForm, RefreshButton } from "@/components/forms";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CaseSummary } from "@/lib/contracts";
import { label, pageSize, parseOffset, timestamp } from "@/lib/format";
import { api } from "@/lib/server-api";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: {
  searchParams: Promise<{ offset?: string | string[] }>;
}) {
  const offset = parseOffset((await searchParams).offset);
  const cases = await api<CaseSummary[]>(`/intakes?limit=${pageSize}&offset=${offset}`);
  return <>
    <PageHeading title="Inbox" description="Archive incoming documents and track each intake from receipt to review." action={<RefreshButton />} />
    <details className="rounded-xl border bg-card">
      <summary className="flex cursor-pointer items-center gap-2 rounded-xl px-5 py-4 text-sm font-semibold text-primary focus-visible:outline-ring">
        <Plus size={18} aria-hidden /> Simulate an arrival
      </summary>
      <div className="border-t px-5 py-5"><IntakeForm /></div>
    </details>
    <Section title="Recent intakes">
      {cases.length ? <Table>
        <TableHeader><TableRow><TableHead>Intake</TableHead><TableHead>Channel</TableHead><TableHead>Status</TableHead><TableHead>Files</TableHead><TableHead>Received</TableHead></TableRow></TableHeader>
        <TableBody>{cases.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="max-w-sm whitespace-normal">
              <Link className="break-words font-medium text-primary hover:underline" href={`/review/${item.id}`}>{item.subject || "Untitled arrival"}</Link>
              <p className="text-xs text-muted-foreground">{item.detected_reference ?? "Reference pending"}</p>
            </TableCell>
            <TableCell>{label(item.channel)}</TableCell><TableCell><Status value={item.state} /></TableCell>
            <TableCell>{item.attachment_count}</TableCell><TableCell>{timestamp(item.created_at)}</TableCell>
          </TableRow>
        ))}</TableBody>
      </Table> : <Empty>{offset ? "No more intakes." : "No arrivals yet. Simulate an arrival to archive your first intake."}</Empty>}
    </Section>
    <Pagination path="/inbox" offset={offset} count={cases.length} />
  </>;
}
