"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { FilterDropdown, type FilterDropdownOption } from "@/components/ui/filter-dropdown";
import { Empty } from "@/components/ui/page-layout";
import { ListPagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportSummary } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";
import { scopedPath } from "@/lib/scope";
import { cn } from "@/lib/utils";

const statusTabs = [
  { id: "", name: "All" },
  { id: "approved", name: "Approved" },
  { id: "draft", name: "Drafts" },
] as const;

export function ImportRecordsView({
  records,
  q: initialQ,
  stateFilter,
  companyId,
  oldest,
  offset,
  hasNext,
  paginationPath,
}: {
  records: ImportSummary[];
  q: string;
  stateFilter: string;
  companyId?: string;
  oldest: boolean;
  offset: number;
  hasNext: boolean;
  paginationPath: string;
}) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState(initialQ);

  const navigateWith = (updates: { q?: string; filter?: string; sort?: string }) => {
    const params = new URLSearchParams();
    if (companyId) params.set("company_id", companyId);

    const nextQ = updates.q !== undefined ? updates.q : searchTerm;
    const nextFilter = updates.filter !== undefined ? updates.filter : stateFilter;
    const nextSort = updates.sort !== undefined ? updates.sort : oldest ? "oldest" : "";

    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextFilter) params.set("filter", nextFilter);
    if (nextSort === "oldest") params.set("sort", "oldest");

    const qs = params.toString();
    router.push(scopedPath(qs ? `/imports?${qs}` : "/imports", companyId));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigateWith({ q: searchTerm });
  };

  const handleReset = () => {
    setSearchTerm("");
    const params = new URLSearchParams();
    if (companyId) params.set("company_id", companyId);
    if (stateFilter) params.set("filter", stateFilter);
    const qs = params.toString();
    router.push(scopedPath(qs ? `/imports?${qs}` : "/imports", companyId));
  };

  const sortOptions: FilterDropdownOption[] = [
    { value: "", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
  ];

  const hasActiveFilters = Boolean(searchTerm || oldest);

  return (
    <div className="space-y-3">
      {/* Toolbar outside table, no card background, white search field */}
      <div className="flex flex-wrap items-center gap-2.5 py-1 bg-transparent" role="search">
        <form onSubmit={handleSearchSubmit} className="shrink-0 w-full sm:w-64 md:w-72">
          <SearchInput
            maxLength={160}
            aria-label="Search import records"
            placeholder="Invoice, supplier, consignee, company…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            containerClassName="w-full"
            className="h-8 text-xs bg-white dark:bg-card border-input hover:border-border focus:bg-white dark:focus:bg-card shadow-xs"
          />
        </form>

        <FilterDropdown
          value={oldest ? "oldest" : ""}
          options={sortOptions}
          onChange={(val) => navigateWith({ sort: val })}
        />

        {hasActiveFilters && (
          <Button
            type="button"
            onClick={handleReset}
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-muted-foreground hover:text-foreground border-0 shadow-none bg-transparent hover:bg-muted/60"
          >
            <X size={12} className="mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* Table container with flat underline tab bar */}
      <div className="panel overflow-hidden">
        <nav className="flex border-b bg-card/60 px-2 overflow-x-auto no-scrollbar" aria-label="Import status tabs">
          {statusTabs.map((tab) => {
            const active = stateFilter === tab.id;
            const tabParams = new URLSearchParams();
            if (companyId) tabParams.set("company_id", companyId);
            if (searchTerm.trim()) tabParams.set("q", searchTerm.trim());
            if (tab.id) tabParams.set("filter", tab.id);
            if (oldest) tabParams.set("sort", "oldest");
            const tabHref = scopedPath(
              tabParams.toString() ? `/imports?${tabParams.toString()}` : "/imports",
              companyId
            );
            return (
              <Link
                key={tab.id || "all"}
                href={tabHref}
                className={cn(
                  "cursor-pointer border-b-2 px-4 py-2 text-xs font-semibold transition-all focus-visible:outline-offset-[-2px] flex items-center gap-1.5 whitespace-nowrap",
                  active
                    ? "border-primary text-primary font-bold"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <span>{tab.name}</span>
              </Link>
            );
          })}
        </nav>

        {records.length ? (
          <Table className="min-w-[780px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">INV Number</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Consignee</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>ETD</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead className="w-24 pr-4 text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => {
                const href = scopedPath(`/imports/${record.id}`, companyId);
                return (
                  <TableRow
                    key={record.id}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest("button") || target.closest("a")) return;
                      router.push(href);
                    }}
                    className="group relative cursor-pointer border-b bg-white dark:bg-card transition-colors duration-100 hover:bg-muted/40"
                  >
                    <TableCell className="pl-4 font-mono text-code-tabular font-semibold">
                      <Link href={href} className="data-link">
                        {record.invoice_no}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-52 truncate text-xs font-medium text-foreground" title={record.supplier ?? undefined}>
                      {record.supplier || "—"}
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-xs text-muted-foreground" title={record.consignee ?? undefined}>
                      {record.consignee || "—"}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-xs text-muted-foreground" title={record.company}>
                      {record.company}
                    </TableCell>
                    <TableCell className="font-mono text-code-tabular text-xs text-muted-foreground whitespace-nowrap">
                      {record.etd || label(record.etd_status)}
                    </TableCell>
                    <TableCell className="font-mono text-code-tabular text-xs text-muted-foreground whitespace-nowrap">
                      {record.eta || label(record.eta_status)}
                    </TableCell>
                    <TableCell className="font-mono text-code-tabular text-xs text-muted-foreground whitespace-nowrap">
                      {record.approved_at ? timestamp(record.approved_at) : "Draft"}
                    </TableCell>
                    <TableCell className="pr-4 text-right whitespace-nowrap">
                      <Link
                        href={href}
                        className="hidden group-hover:inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-all"
                      >
                        <span>Open</span>
                        <ArrowRight size={12} aria-hidden />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <Empty>
            {offset
              ? "No import records on this page."
              : searchTerm || stateFilter
              ? "No import records match these filters."
              : "No approved import records yet."}
          </Empty>
        )}

        <ListPagination
          path={paginationPath}
          label="Import records"
          offset={offset}
          count={records.length}
          hasNext={hasNext}
        />
      </div>
    </div>
  );
}
