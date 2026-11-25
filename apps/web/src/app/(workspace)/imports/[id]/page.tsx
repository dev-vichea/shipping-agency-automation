import type { Metadata } from "next";
import { ImportDetailView } from "@/features/imports/import-detail-view";
import type { CaseDetail, ImportDetail, MasterVersion, PermitDraft, ReviewAnalysis, ReviewWorkflow } from "@/lib/contracts";
import { lastPageOffset, pageSize, parseOffset } from "@/lib/pagination";
import { companyParam, scopedPath } from "@/lib/scope";
import { api } from "@/lib/server-api";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Import ${id.slice(0, 8)}` };
}

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ offset?: string; company_id?: string; tab?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const record = await api<ImportDetail>(`/imports/${encodeURIComponent(id)}`);
  const offset = Math.min(parseOffset(query.offset), lastPageOffset(record.items.length));
  const items = record.items.slice(offset, offset + pageSize);

  const [drafts, workflow, caseDetail, analysis, versions] = await Promise.all([
    record.state === "approved"
      ? api<PermitDraft[]>(`/imports/${encodeURIComponent(id)}/permit-drafts`).catch(() => [])
      : Promise.resolve([]),
    record.intake_case_id
      ? api<ReviewWorkflow>(`/intakes/${record.intake_case_id}/review`).catch(() => null)
      : Promise.resolve(null),
    record.intake_case_id
      ? api<CaseDetail>(`/intakes/${record.intake_case_id}`).catch(() => null)
      : Promise.resolve(null),
    record.intake_case_id
      ? api<ReviewAnalysis>(`/intakes/${record.intake_case_id}/analysis`).catch(() => null)
      : Promise.resolve(null),
    api<MasterVersion[]>("/cdc/versions?limit=100").catch(() => []),
  ]);

  const permitPending = workflow?.decisions.find(
    (event) => event.scope === "intake" && event.decision === "approved"
  )?.permit_pending;

  return (
    <ImportDetailView
      record={record}
      items={items}
      offset={offset}
      companyIdParam={query.company_id}
      initialTab={query.tab === "documents" ? "documents" : "overview"}
      drafts={drafts}
      workflow={workflow}
      permitPending={permitPending}
      caseDetail={caseDetail}
      analysis={analysis}
      versions={versions}
      paginationPath={scopedPath(`/imports/${record.id}`, companyParam(query.company_id))}
    />
  );
}
