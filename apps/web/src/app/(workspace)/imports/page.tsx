import { NativeSelect } from "@/components/ui/native-select";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { companyParam, scopedPath } from "@/lib/scope";
import { Button } from "@/components/ui/button";
import { Empty, PageHeading, Section, Status } from "@/components/workspace";
import { ListPagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportSummary } from "@/lib/contracts";
import { timestamp } from "@/lib/format";
import { pageSize, pageWindow, parseOffset } from "@/lib/pagination";
import { api } from "@/lib/server-api";

export const metadata: Metadata = { title: "Imports" };

export default async function ImportsPage({ searchParams }: {
  searchParams: Promise<{ offset?: string | string[]; company_id?: string; q?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const offset = parseOffset(params.offset);
  const company = companyParam(params.company_id);
  const q = typeof params.q === "string" ? params.q.slice(0, 160) : "";
  const oldest = params.sort === "oldest";
  const query = new URLSearchParams({ q, limit: String(pageSize + 1), offset: String(offset), oldest_first: String(oldest) });
  const { items: records, hasNext } = pageWindow(await api<ImportSummary[]>(scopedPath(`/imports?${query}`, company)));
  const filter = new URLSearchParams({ q, sort: oldest ? "oldest" : "" });
  return <div className="space-y-gutter lg:space-y-gutter-desktop">
    <PageHeading title="Import records" />
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" size="sm"><Link href={scopedPath("/imports/drafts", company)}>Drafts</Link></Button>
      <Button asChild variant="secondary" size="sm"><Link href={scopedPath("/imports", company)}>Import register</Link></Button>
    </div>
    <Section title="Import records">
      <form action="/imports" className="flex flex-wrap items-center gap-2 border-b p-3" role="search">
        {company && <input type="hidden" name="company_id" value={company} />}
        <SearchInput name="q" aria-label="Search imports" defaultValue={q} maxLength={160} placeholder="Invoice or company…" containerClassName="w-full max-w-72" />
        <NativeSelect name="sort" aria-label="Sort order" defaultValue={oldest ? "oldest" : ""}><option value="">Newest first</option><option value="oldest">Oldest first</option></NativeSelect>
        <Button size="sm" variant="outline">Apply</Button>
      </form>
      {records.length ? <Table className="min-w-[700px]">
        <TableHeader><TableRow>
          <TableHead>Invoice no.</TableHead><TableHead>Company</TableHead><TableHead>Supplier</TableHead>
          <TableHead>Status</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Action</TableHead>
        </TableRow></TableHeader>
        <TableBody>{records.map((record) => <TableRow key={record.id}>
          <TableCell className="h-10 font-mono text-code-tabular"><Link className="data-link" href={`/imports/${record.id}`}>{record.invoice_no}</Link></TableCell>
          <TableCell className="max-w-52 truncate" title={record.company}>{record.company}</TableCell>
          <TableCell className="max-w-48 truncate text-muted-foreground" title={record.supplier ?? undefined}>{record.supplier || "—"}</TableCell>
          <TableCell><Status value={record.state} /></TableCell>
          <TableCell className="font-mono text-code-tabular text-muted-foreground">{timestamp(record.created_at)}</TableCell>
          <TableCell className="text-right"><Button asChild variant="ghost" size="xs"><Link href={`/imports/${record.id}`}>Open <ArrowUpRight aria-hidden /></Link></Button></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <Empty>{offset ? "No import records on this page." : <>No import records in this view. <Link href={scopedPath("/imports/drafts", company)} className="data-link">Open drafts.</Link></>}</Empty>}
      <ListPagination path={scopedPath(`/imports?${filter}`, company)} offset={offset} count={records.length} hasNext={hasNext} />
    </Section>
  </div>;
}
