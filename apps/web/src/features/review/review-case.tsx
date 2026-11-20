import { DocumentReviewWorkspace } from "@/features/review/document-review-workspace";
import { FormSheet } from "@/components/ui/form-sheet";
import { TelegramSendForm } from "@/features/integrations/connector-forms";
import { Send } from "lucide-react";
import { LiveRefresh } from "@/lib/live-refresh";
import type { CaseActivity, CaseDetail, Company, MasterVersion, ReviewAnalysis, ReviewWorkflow, TelegramPreview } from "@/lib/contracts";
import { api, workspaceList } from "@/lib/server-api";

export async function ReviewCase({ caseId, initialTab }: { caseId: string; initialTab: "documents" | "verification" }) {
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
        <FormSheet
          key="telegram-share"
          title="Telegram draft notification"
          trigger={<Send aria-hidden className="size-4" />}
          outline
          size="icon-sm"
          buttonTitle="Share draft"
        >
          <TelegramSendForm caseId={item.id} preview={telegram} />
        </FormSheet>
      )} />
  </>;
}
