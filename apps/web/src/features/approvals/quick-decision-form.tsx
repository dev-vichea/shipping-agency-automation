"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTelegramWebApp } from "@/features/integrations/use-telegram-web-app";
import { write } from "@/lib/client-api";
import { toast } from "@/lib/toast";
import { useFormSubmission } from "@/lib/use-form-submission";

export function QuickDecisionForm({ caseId, revision, reviewId, reject }: {
  caseId: string; revision: number; reviewId: string; reject: boolean;
}) {
  const router = useRouter();
  const { error, busy, submit } = useFormSubmission();
  const { isTelegram, hapticSuccess, hapticError, close } = useTelegramWebApp();
  const [completed, setCompleted] = useState<string | null>(null);

  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const notes = reject ? String(form.get("notes") ?? "").trim() : "Confirmed through the draft quick approval link.";
    const payload = { expected_revision: revision, review_id: reviewId, notes };
    void submit(async () => {
      try {
        if (reject) {
          await write(`/intakes/${caseId}/quick-rejection`, payload);
          hapticSuccess();
          toast.updated("Draft rejected");
          if (isTelegram) {
            setCompleted("Draft rejected. Returning to Telegram...");
            setTimeout(() => close(), 1200);
          } else {
            router.push(`/review/${caseId}`);
          }
        } else {
          const { import_id: id } = await write<{ import_id: string }>(`/intakes/${caseId}/quick-approval`, payload);
          hapticSuccess();
          toast.saved("Import approved!");
          if (isTelegram) {
            setCompleted("Import approved. Returning to Telegram...");
            setTimeout(() => close(), 1200);
          } else {
            router.push(`/imports/${id}`);
          }
        }
      } catch (err) {
        hapticError();
        throw err;
      }
    });
  }}>
    {completed ? (
      <div className="rounded-lg bg-emerald-100/80 p-3 text-sm text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" role="status">
        {completed}
      </div>
    ) : (
      <>
        {reject && <label className="grid gap-1.5 text-label-md">Rejection reason
          <Textarea name="notes" required maxLength={1000} />
        </label>}
        <label className="flex items-start gap-2"><input type="checkbox" required className="mt-1" />
          {reject ? "Confirm rejection of this draft revision." : "Confirm this exact revision for the approved import register."}
        </label>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={reject ? "destructive" : "default"} disabled={busy}>
            {reject ? "Reject draft" : "Approve import"}
          </Button>
          {isTelegram && (
            <Button size="sm" variant="outline" type="button" onClick={close} disabled={busy}>
              Close
            </Button>
          )}
        </div>
      </>
    )}
    {error && <p role="alert" className="field-error">{error}</p>}
  </form>;
}
