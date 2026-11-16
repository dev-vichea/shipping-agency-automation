import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Download, FileCheck2, Filter, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, PageHeading, Section } from "@/components/workspace";
import type { ImportReport } from "@/lib/contracts";
import { timestamp } from "@/lib/format";
import { pageSize, parseOffset } from "@/lib/pagination";
import { companyParam, scopedPath } from "@/lib/scope";
import { api } from "@/lib/server-api";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<{ start?: string; end?: string; company_id?: string; offset?: string }> ;
}) {
  const { start, end, company_id, offset: rawOffset } = await searchParams;
  const offset = parseOffset(rawOffset);
  const company = companyParam(company_id);
  const dates = new URLSearchParams();
  if (company) dates.set("company_id", company);
  if (start) dates.set("start", start);
  if (end) dates.set("end", end);
  const invalidRange = Boolean(start && end && start >= end);
  const path = dates.size ? `/reports?${dates}` : "/reports";
  const reportQuery = new URLSearchParams(dates);
  reportQuery.set("offset", String(offset));
  reportQuery.set("limit", String(pageSize));
  const report = invalidRange ? null : await api<ImportReport>(`/reports/imports?${reportQuery}`);
  const exportQuery = new URLSearchParams(dates);
  exportQuery.set("excel", "true");
  return <div className="space-y-gutter">
    <PageHeading title="Reports" action={report && <Button asChild size="sm"><a href={`/api/v1/reports/imports?${exportQuery}`}><Download aria-hidden />Download Excel report</a></Button>} />
    <Section title="Approval period" action={<CalendarDays size={14} aria-hidden className="text-ghost" />}>
      <form action="/reports" className="flex flex-wrap items-end gap-3 p-3">
        {company && <input type="hidden" name="company_id" value={company} />}
        <label className="grid gap-1.5 text-label-md">Approved from<Input name="start" type="date" defaultValue={start} /></label>
        <label className="grid gap-1.5 text-label-md">Approved before<Input name="end" type="date" defaultValue={end} /></label>
        <Button size="sm" variant="outline"><Filter aria-hidden />Apply dates</Button>
        {(start || end) && <Button asChild size="sm" variant="ghost"><Link href={scopedPath("/reports", company)}>Clear dates</Link></Button>}
        {invalidRange && <p role="alert" className="field-error basis-full">Choose an end date after the start date.</p>}
      </form>
    </Section>
    {report && <div className="grid gap-gutter sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <Card className="border-l-2 border-l-primary"><CardHeader><CardTitle className="flex items-center gap-2"><FileCheck2 size={15} aria-hidden className="text-primary" />Approved imports</CardTitle></CardHeader>
        <CardContent className="font-mono text-headline-xl">{report.imports}</CardContent>
      </Card>
      {Object.entries(report.totals).map(([code, value]) => <Card className="border-l-2 border-l-success" key={code}>
        <CardHeader><CardTitle className="flex items-center gap-2"><Wallet size={15} aria-hidden className="text-success" />Approved amount · {code}</CardTitle></CardHeader>
        <CardContent className="break-all font-mono text-headline-xl">{value}</CardContent>
      </Card>)}
    </div>}
    <Section title="Approved import register">
      {report?.rows.length ?
        <Table>
          <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Company</TableHead><TableHead>Supplier</TableHead><TableHead>Approved (Cambodia)</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
          <TableBody>{report.rows.map((row) => <TableRow key={`${row.id}:${row.currency}`}>
            <TableCell><Link href={`/imports/${row.id}`} className="data-link">{row.invoice_no}</Link></TableCell>
            <TableCell>{row.company}</TableCell><TableCell>{row.supplier}</TableCell><TableCell>{timestamp(row.approved_at)}</TableCell>
            <TableCell className="text-right font-mono text-code-tabular">{row.amount} {row.currency}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
        : report && <Empty>{offset && report.total_rows ? "No approved imports on this page." : "No approved imports in this period."}</Empty>}
      {report && <ListPagination path={path} offset={offset} count={report.rows.length} total={report.total_rows} />}
    </Section>
  </div>;
}
