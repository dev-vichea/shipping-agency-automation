import { NativeSelect } from "@/components/ui/native-select";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, Plus } from "lucide-react";
import { CompanyForm } from "@/features/companies/company-forms";
import { FormSheet } from "@/components/ui/form-sheet";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, PageHeading, Section } from "@/components/ui/page-layout";
import { ListPagination } from "@/components/ui/pagination";
import type { Company } from "@/lib/contracts";
import { timestamp } from "@/lib/format";
import { pageSize, pageWindow, parseOffset } from "@/lib/pagination";
import { api, workspaceList } from "@/lib/server-api";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; new?: string; sort?: string; offset?: string }> }) {
  const { q, new: create, sort, offset: rawOffset } = await searchParams;
  const offset = parseOffset(rawOffset);
  const query = typeof q === "string" ? q.slice(0, 160) : "";
  const order = sort === "recent" ? "recent" : "name";
  const filters = new URLSearchParams({ q: query, sort: order });
  const [results, workspace] = await Promise.all([
    api<Company[]>(`/companies?${filters}&limit=${pageSize + 1}&offset=${offset}`), workspaceList(),
  ]);
  const { items: companies, hasNext } = pageWindow(results);
  const admin = workspace.workspaces.some(({id, role}) => id === workspace.active_id && role === "admin");
  return <div className="space-y-4">
    <PageHeading title="Companies" action={admin && <FormSheet title="Add company" trigger={<><Plus aria-hidden /> Add company</>} openInitially={create === "1"}><CompanyForm /></FormSheet>} />
    <Section title="Client companies">
      <form action="/companies" className="flex flex-wrap items-center gap-2 border-b p-3" role="search">
        <SearchInput name="q" aria-label="Search companies" placeholder="Name or identifier…" defaultValue={query} maxLength={160} containerClassName="w-full max-w-72" />
        <NativeSelect name="sort" aria-label="Sort order" defaultValue={order}><option value="name">Company name</option><option value="recent">Recently added</option></NativeSelect>
        <Button variant="outline" size="sm">Apply</Button>
      </form>
      {companies.length ? <Table className="min-w-[540px]">
        <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Identifier</TableHead><TableHead>Contact</TableHead><TableHead>Added</TableHead><TableHead><span className="sr-only">Details</span></TableHead></TableRow></TableHeader>
        <TableBody>{companies.map((company) => <TableRow key={company.id}>
          <TableCell><Link className="inline-flex items-center gap-2 font-medium hover:text-primary" href={`/companies/${company.id}`}><Building2 size={16} className="text-primary" aria-hidden />{company.name}</Link></TableCell>
          <TableCell>{company.identifier ?? "—"}</TableCell>
          <TableCell>{company.contact_name ?? company.contact_email ?? "—"}</TableCell>
          <TableCell className="text-muted-foreground">{timestamp(company.created_at)}</TableCell>
          <TableCell className="text-right"><Link className="inline-flex text-primary" aria-label={`Open ${company.name}`} href={`/companies/${company.id}`}><ArrowRight size={15} aria-hidden /></Link></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <Empty>{offset ? "No companies on this page." : query ? "No companies match your search." : "No companies in this workspace yet."}</Empty>}
      <ListPagination path={`/companies?${filters}`} offset={offset} count={companies.length} hasNext={hasNext} />
    </Section>
  </div>;
}
