import type { Metadata } from "next";
import { PageHeading } from "@/components/ui/page-layout";
import { ImportRecordsView } from "@/features/imports/import-records-view";
import type { ImportSummary } from "@/lib/contracts";
import { LiveRefresh } from "@/lib/live-refresh";
import { pageSize, pageWindow, parseOffset } from "@/lib/pagination";
import { companyParam, scopedPath } from "@/lib/scope";
import { api, workspaceList } from "@/lib/server-api";

export const metadata: Metadata = { title: "Import records" };

type ImportsSearchParams = {
  offset?: string | string[];
  filter?: string;
  q?: string;
  company_id?: string;
  sort?: string;
};

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<ImportsSearchParams>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 160) : "";
  const stateFilter = params.filter === "approved" || params.filter === "draft" ? params.filter : "";
  const companyId = companyParam(params.company_id);
  const oldest = params.sort === "oldest";
  const offset = parseOffset(params.offset);

  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (companyId) query.set("company_id", companyId);
  if (stateFilter) query.set("state", stateFilter);
  if (oldest) query.set("oldest_first", "true");
  query.set("limit", String(pageSize + 1));
  query.set("offset", String(offset));

  const [results, workspace] = await Promise.all([
    api<ImportSummary[]>(`/imports?${query}`),
    workspaceList(),
  ]);
  const { items, hasNext } = pageWindow(results);

  const paginationQuery = new URLSearchParams();
  if (q) paginationQuery.set("q", q);
  if (stateFilter) paginationQuery.set("filter", stateFilter);
  if (oldest) paginationQuery.set("sort", "oldest");
  const paginationPath = scopedPath(
    paginationQuery.toString() ? `/imports?${paginationQuery.toString()}` : "/imports",
    companyId
  );

  return (
    <div className="space-y-3">
      <LiveRefresh active={!!workspace.active_id} interval={15000} />
      <PageHeading title="Import records" />
      <ImportRecordsView
        records={items}
        q={q}
        stateFilter={stateFilter}
        companyId={companyId}
        oldest={oldest}
        offset={offset}
        hasNext={hasNext}
        paginationPath={paginationPath}
      />
    </div>
  );
}
