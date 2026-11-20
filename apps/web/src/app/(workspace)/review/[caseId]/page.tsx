import type { Metadata } from "next";
import { DocumentReviewWorkspace } from "@/components/document-review-workspace";
import { RecordDialog } from "@/components/record-dialog";
import { TelegramSendForm } from "@/components/integration-forms";
import { Send } from "lucide-react";
import { LiveRefresh } from "@/components/live-refresh";
import type { CaseActivity, CaseDetail, Company, MasterVersion, ReviewAnalysis, ReviewWorkflow, TelegramPreview } from "@/lib/contracts";
import { api, workspaceList } from "@/lib/server-api";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const { caseId } = await params;
  const sp = searchParams ? await searchParams : {};
  const isVerif = sp.tab === "verification";
  return { title: `Review ${caseId.slice(0, 8)}${isVerif ? " · Verification" : ""}` };
}

export default async function ReviewDetail({
  params,
  searchParams,
  defaultTab,
}: {
  params: Promise<{ caseId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
  defaultTab?: "documents" | "verification";
}) {
  const { caseId } = await params;
  const sp = searchParams ? await searchParams : {};
  const tabParam = typeof sp.tab === "string" ? sp.tab : undefined;
  const initialTab: "documents" | "verification" =
    defaultTab ?? (tabParam === "verification" ? "verification" : "documents");
  const path = `/intakes/${encodeURIComponent(caseId)}`;

  const [item, analysis, workflow, activity, workspace] = await Promise.all([
    api<CaseDetail>(path),
    api<ReviewAnalysis>(`${path}/analysis`),
    api<ReviewWorkflow>(`${path}/review`),
    api<CaseActivity[]>(`${path}/activity`),
    workspaceList(),
  ]);

  const admin = workspace.workspaces.some(({ id, role }) => id === workspace.active_id && role === "admin");
  const [versions, companies, telegram] = await Promise.all([
    api<MasterVersion[]>(`/cdc/versions?limit=100${item.company_id ? `&company_id=${item.company_id}` : ""}`),
    admin && !item.company_id ? api<Company[]>("/companies?limit=100") : Promise.resolve([]),
    admin && analysis.state === "available" && ["needs_review", "ready_for_approval", "approved"].includes(item.state)
      ? api<TelegramPreview>(`${path}/telegram`) : Promise.resolve(null),
  ]);

  return <>
    <LiveRefresh active={item.state === "queued" || item.state === "processing" || analysis.ai_state === "pending"} />
    <DocumentReviewWorkspace item={item} analysis={analysis} versions={versions} workflow={workflow}
      companies={companies} activity={activity} admin={admin} initialTab={initialTab}
      share={telegram && (
        <RecordDialog
          key="telegram-share"
          title="Telegram draft notification"
          trigger={<Send aria-hidden className="size-4" />}
          outline
          size="icon-sm"
          buttonTitle="Share draft"
        >
          <TelegramSendForm caseId={item.id} preview={telegram} />
        </RecordDialog>
      )} />
  </>;
}
