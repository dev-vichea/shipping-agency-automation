import Link from "next/link";
import { QuickApproveForm } from "@/components/integration-forms";
import { Button } from "@/components/ui/button";
import { PageHeading, Section } from "@/components/workspace";
import type { QuickApproval } from "@/lib/contracts";
import { api } from "@/lib/server-api";

export default async function QuickApprovePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ revision?: string; review?: string }>;
}) {
  const { id } = await params;
  const { revision, review } = await searchParams;
  const draft = await api<QuickApproval>(`/intakes/${encodeURIComponent(id)}/quick-approval`);
  const current = draft.review_id && review === draft.review_id && revision === String(draft.revision);
  return <div className="max-w-2xl space-y-4">
    <PageHeading title="Confirm import approval" action={<Button asChild size="sm" variant="outline"><Link href={`/review/${id}`}>Open full review</Link></Button>} />
    <Section title="Draft summary"><div className="space-y-4 p-4">
      <pre className="rounded-lg bg-muted p-3 text-xs leading-5 break-words whitespace-pre-wrap">{draft.message}</pre>
      {draft.eligible && current && draft.review_id
        ? <QuickApproveForm caseId={id} revision={draft.revision} reviewId={draft.review_id} />
        : <p role="status" className="text-muted-foreground">Open the full review for the current draft and approval options.</p>}
    </div></Section>
  </div>;
}
