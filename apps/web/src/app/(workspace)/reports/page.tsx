import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileCheck2, Filter, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, PageHeading } from "@/components/ui/page-layout";
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
  return (
    <div className="space-y-3">
      <PageHeading
        title="Reports"
        action={
          report && (
            <Button asChild size="sm">
              <a href={`/api/v1/reports/imports?${exportQuery}`}>
                <Download aria-hidden />
                Download Excel report
              </a>
            </Button>
          )
        }
      />

      {/* Filter OUTSIDE table container, NO background */}
      <form action="/reports" className="flex flex-wrap items-center gap-2.5 py-1 bg-transparent" role="search">
        {company && <input type="hidden" name="company_id" value={company} />}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">From</span>
          <Input
            name="start"
            type="date"
            defaultValue={start}
            className="h-8 w-36 text-xs bg-white dark:bg-card border-input hover:border-border focus:bg-white dark:focus:bg-card shadow-xs"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Before</span>
          <Input
            name="end"
            type="date"
            defaultValue={end}
            className="h-8 w-36 text-xs bg-white dark:bg-card border-input hover:border-border focus:bg-white dark:focus:bg-card shadow-xs"
          />
        </div>
        <Button
          size="sm"
          type="submit"
          variant="ghost"
          className="h-8 text-xs font-medium text-muted-foreground hover:text-foreground border-0 shadow-none bg-transparent hover:bg-muted/60"
        >
          <Filter size={13} className="mr-1" aria-hidden />
          Apply
        </Button>
        {(start || end) && (
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-muted-foreground hover:text-foreground border-0 shadow-none bg-transparent hover:bg-muted/60"
          >
            <Link href={scopedPath("/reports", company)}>
              Clear dates
            </Link>
          </Button>
        )}
        {invalidRange && <p role="alert" className="field-error basis-full text-xs">Choose an end date after the start date.</p>}
      </form>

      {/* Connected Grid Cards with NO gap and NO border accent */}
      {report && (
        <div className="grid grid-cols-2 divide-y divide-border rounded-lg border bg-card shadow-xs lg:grid-cols-4 lg:divide-y-0 lg:divide-x divide-border gap-0 overflow-hidden">
          <div className="p-4 transition-colors hover:bg-muted/40 sm:p-5">
            <span className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
              <FileCheck2 size={15} aria-hidden className="text-primary" /> Approved imports
            </span>
            <div className="mt-1.5 font-mono text-[28px] leading-none font-semibold tracking-tight">
              {report.imports}
            </div>
          </div>
          {Object.entries(report.totals).map(([code, value]) => (
            <div key={code} className="p-4 transition-colors hover:bg-muted/40 sm:p-5">
              <span className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                <Wallet size={15} aria-hidden className="text-emerald-600 dark:text-emerald-400" /> Approved amount · {code}
              </span>
              <div className="mt-1.5 break-all font-mono text-[28px] leading-none font-semibold tracking-tight">
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table container */}
      <div className="panel overflow-hidden">
        {report?.rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Approved (Cambodia)</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={`${row.id}:${row.currency}`}>
                  <TableCell><Link href={`/imports/${row.id}`} className="data-link">{row.invoice_no}</Link></TableCell>
                  <TableCell>{row.company}</TableCell>
                  <TableCell>{row.supplier}</TableCell>
                  <TableCell className="text-muted-foreground">{timestamp(row.approved_at)}</TableCell>
                  <TableCell className="text-right font-mono text-code-tabular">{row.amount} {row.currency}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          report && <Empty>{offset && report.total_rows ? "No approved imports on this page." : "No approved imports in this period."}</Empty>
        )}
        {report && <ListPagination path={path} offset={offset} count={report.rows.length} total={report.total_rows} />}
      </div>
    </div>
  );
}
