import { NativeSelect } from "@/components/ui/native-select";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, Search, Upload } from "lucide-react";
import { ExcelFileIcon } from "@/components/ui/file-icon";
import { RegisterMasterDialog } from "@/features/cdc/register-master-dialog";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Empty, Section } from "@/components/ui/page-layout";
import { ListPagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Company, MasterItems, MasterVersion } from "@/lib/contracts";
import { label, location } from "@/lib/format";
import { pageSize, parseOffset } from "@/lib/pagination";
import { companyParam, scopedPath } from "@/lib/scope";
import { api, workspaceList } from "@/lib/server-api";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "CDC Master Lists" };

function formatNumber(val: string | null | undefined): string {
  if (!val) return "—";
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatMoney(val: string | null | undefined, curr = "USD"): string {
  if (!val) return "—";
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  const formatted = num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return curr === "USD" ? `$${formatted}` : `${formatted} ${curr}`;
}

export default async function CDCMasterPage({ searchParams }: {
  searchParams: Promise<{ version?: string; q?: string; category?: string; offset?: string | string[]; row?: string; company_id?: string }>;
}) {
  const params = await searchParams;
  const offset = parseOffset(params.offset);
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 160) : "";
  const category = typeof params.category === "string" ? params.category.trim() : "";
  const company = companyParam(params.company_id);
  const [versions, workspace, companies] = await Promise.all([
    api<MasterVersion[]>(scopedPath("/cdc/versions?limit=100", company)),
    workspaceList(),
    api<Company[]>("/companies?limit=100"),
  ]);
  const admin = workspace.workspaces.some(({ id, role }) => id === workspace.active_id && role === "admin");
  const version = versions.find((entry) => entry.id === params.version) ?? versions[0];
  const query = new URLSearchParams({
    q,
    offset: String(offset),
    limit: String(pageSize),
    ...(category ? { category } : {}),
  });
  const result = version ? await api<MasterItems>(`/cdc/versions/${version.id}/items?${query}`) : null;
  const selected = result?.items.find(({ row }) => String(row) === params.row) ?? result?.items[0];

  const workbookUrl = version ? `/api/v1/cdc/versions/${version.id}/download` : "";
  const urlParams = new URLSearchParams();
  if (version) urlParams.set("version", version.id);
  if (q) urlParams.set("q", q);
  if (category) urlParams.set("category", category);
  const path = scopedPath(`/cdc?${urlParams.toString()}`, company);

  const categories = result?.categories ?? [];
  const categoryCounts = result?.category_counts ?? {};

  return <div className="space-y-gutter">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-headline-xl">CDC Master Lists</h1>
        <p className="mt-0.5 text-body-sm text-muted-foreground">{version ? `${version.company} · ${version.approval_ref} · ${version.year}` : "Browse registered workbooks and recorded limits."}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {admin && companies.length > 0 && <RegisterMasterDialog companyId={company || undefined} companies={companies} openVersion trigger={<><Upload aria-hidden /> Register workbook</>} />}
        {version && <Button asChild size="sm"><a href={workbookUrl}><ArrowDownToLine aria-hidden /> Download workbook</a></Button>}
      </div>
    </header>
    {version && result ? <>
      <form action="/cdc" className="panel flex flex-wrap items-end gap-2 p-2.5">
        {company && <input type="hidden" name="company_id" value={company} />}
        {category && <input type="hidden" name="category" value={category} />}
        <label className="grid min-w-0 gap-1 text-label-md">Workbook
          <NativeSelect name="version" defaultValue={version.id} className="control w-full max-w-80">
            {versions.map((entry) => <option key={entry.id} value={entry.id}>{entry.company} · {entry.year} · {entry.approval_ref} · {entry.original_filename}</option>)}
          </NativeSelect>
        </label>
        <label className="grid min-w-0 gap-1 text-label-md">Find workbook rows
          <SearchInput name="q" defaultValue={q} placeholder="Description or row number" maxLength={160} containerClassName="sm:w-48" />
        </label>
        <Button type="submit" size="sm" variant="outline"><Search aria-hidden /> Apply</Button>
      </form>
      <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(290px,32%)]">
        <div className="min-w-0 space-y-3">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Selected Master List">
            {[
              ["Approval reference", version.approval_ref],
              ["Balance date", version.balance_as_of ?? "Unknown"],
              [category ? `${category} rows` : q ? "Matching rows" : "Workbook rows", result.total],
            ].map(([title, value]) =>
              <div className="panel border-l-2 border-l-primary p-2.5" key={title}><dt className="panel-label">{title}</dt><dd className="mt-1 break-words font-mono text-code-tabular">{value}</dd></div>)}
          </dl>

          <Section title="Master List rows">
            {/* Simple Flat Category Tabs */}
            {categories.length > 0 && (
              <nav className="flex border-b bg-background px-2" aria-label="CDC category tabs">
                {[
                  { name: "All", label: "All Items", count: categoryCounts.All ?? result.total },
                  ...categories.map((cat) => ({
                    name: cat,
                    label: cat,
                    count: categoryCounts[cat] ?? 0,
                  })),
                ].map((tab) => {
                  const active = (!category && tab.name === "All") || (category.toLowerCase() === tab.name.toLowerCase());
                  const tabParams = new URLSearchParams();
                  if (version) tabParams.set("version", version.id);
                  if (q) tabParams.set("q", q);
                  if (tab.name !== "All") tabParams.set("category", tab.name);
                  tabParams.set("offset", "0");
                  const tabHref = scopedPath(`/cdc?${tabParams.toString()}`, company);

                  return (
                    <Link
                      key={tab.name}
                      href={tabHref}
                      className={cn(
                        "cursor-pointer border-b-2 px-4 py-2 text-xs font-semibold transition-all focus-visible:outline-offset-[-2px] flex items-center gap-1.5",
                        active
                          ? "border-primary text-primary font-bold"
                          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                      )}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={cn(
                          "rounded-control px-1.5 py-0.2 text-[10px] font-mono",
                          active
                            ? "bg-primary/10 text-primary font-bold"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {tab.count}
                      </span>
                    </Link>
                  );
                })}
              </nav>
            )}

            {/* Option B Table: Single-line rows with explicit columns */}
            {result.items.length ? (
              <div className="overflow-x-auto">
                <Table className="min-w-[780px] text-body-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12 text-center font-mono">#</TableHead>
                      <TableHead className="min-w-44 text-left">Description</TableHead>
                      <TableHead className="w-16 text-center">Unit</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Approved Qty</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Ref Price</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Approved Value</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Balance Qty</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Balance Value</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Reserved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.items.map((item, idx) => (
                      <TableRow key={item.row} data-state={item.row === selected?.row ? "selected" : undefined} className="h-9">
                        <TableCell className="w-12 text-center font-mono text-code-badge text-muted-foreground whitespace-nowrap py-1.5">
                          {item.serial || idx + 1 + offset}
                        </TableCell>
                        <TableCell className="min-w-44 max-w-xs truncate whitespace-nowrap py-1.5">
                          <Link
                            href={`${path}&offset=${offset}&row=${item.row}`}
                            className="data-link font-medium block truncate"
                            aria-current={selected?.row === item.row ? "true" : undefined}
                            title={item.description.value ?? ""}
                          >
                            {item.description.value ?? "Unknown item"}
                          </Link>
                        </TableCell>
                        <TableCell className="w-16 text-center font-mono text-code-tabular uppercase whitespace-nowrap py-1.5">
                          {item.unit.value ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-code-tabular whitespace-nowrap py-1.5">
                          {formatNumber(item.approved_quantity.value)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-code-tabular whitespace-nowrap py-1.5">
                          {formatMoney(item.unit_price.value, item.unit_price.currency ?? "USD")}
                        </TableCell>
                        <TableCell className="text-right font-mono text-code-tabular whitespace-nowrap py-1.5">
                          {formatMoney(item.approved_value.value, item.approved_value.currency ?? "USD")}
                        </TableCell>
                        <TableCell className="text-right font-mono text-code-tabular whitespace-nowrap py-1.5">
                          {formatNumber(item.remaining_quantity.value)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-code-tabular whitespace-nowrap py-1.5">
                          {formatMoney(item.remaining_value.value, item.remaining_value.currency ?? "USD")}
                        </TableCell>
                        <TableCell className="text-right font-mono text-code-tabular whitespace-nowrap py-1.5">
                          {result.internally_reserved[item.row] ?? "0"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <Empty>{offset ? "No workbook rows on this page." : "No workbook rows match."}</Empty>
            )}
            <ListPagination path={path} offset={offset} count={result.items.length} total={result.total} />
          </Section>
        </div>

        <Section title="Workbook details" action={<ExcelFileIcon size="sm" />}>
          <div className="divide-y">
            <div className="p-3">
              <p className="panel-label">Workbook</p>
              <div className="mt-1 flex items-center gap-2">
                <ExcelFileIcon size="sm" />
                <p className="break-all text-label-lg font-medium">{version.original_filename}</p>
              </div>
              <p className="mt-0.5 text-body-sm text-muted-foreground">{label(version.layout)}</p>
            </div>
            {selected && <div className="space-y-3 p-3">
              <div>
                <p className="panel-label">Selected row</p>
                <h3 className="break-words text-headline-md mt-0.5">{selected.description.value ?? "Unknown item"}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="font-mono text-code-tabular text-primary">
                    {selected.description.evidence[0] ? location(selected.description.evidence[0]) : `Row ${selected.row}`}
                  </p>
                  {selected.category && (
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      {selected.category}
                    </span>
                  )}
                </div>
              </div>
              <dl className="divide-y border-y text-body-sm">
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted-foreground">Unit</dt>
                  <dd className="font-mono text-code-tabular font-medium">{selected.unit.value?.toUpperCase() ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted-foreground">Approved Quantity</dt>
                  <dd className="font-mono text-code-tabular">{formatNumber(selected.approved_quantity.value)} {selected.unit.value?.toUpperCase() ?? ""}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted-foreground">Reference Unit Price</dt>
                  <dd className="font-mono text-code-tabular">{formatMoney(selected.unit_price.value, selected.unit_price.currency ?? "USD")}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted-foreground">Approved Total Value</dt>
                  <dd className="font-mono text-code-tabular">{formatMoney(selected.approved_value.value, selected.approved_value.currency ?? "USD")}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted-foreground">Workbook Balance Qty</dt>
                  <dd className="font-mono text-code-tabular">{formatNumber(selected.remaining_quantity.value)} {selected.unit.value?.toUpperCase() ?? ""}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted-foreground">Workbook Balance Value</dt>
                  <dd className="font-mono text-code-tabular">{formatMoney(selected.remaining_value.value, selected.remaining_value.currency ?? "USD")}</dd>
                </div>
                <div className="flex justify-between gap-2 py-1.5">
                  <dt className="text-muted-foreground">Internal Reservations</dt>
                  <dd className="font-mono text-code-tabular">{result.internally_reserved[selected.row] ?? "0"}</dd>
                </div>
              </dl>
            </div>}
            <p className="bg-background p-3 text-body-sm text-muted-foreground">Open the CDC tab on an intake to inspect candidates against this workbook.</p>
          </div>
        </Section>
      </div>
    </> : <Section title="Master List rows"><Empty>No registered Master Lists in this view.</Empty></Section>}
  </div>;
}
