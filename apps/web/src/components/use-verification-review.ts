"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { reviewDraft, type ReviewDraft } from "@/components/staff-review";
import { write } from "@/lib/client-api";
import { toast } from "@/lib/toast";
import type { StaffReview } from "@/lib/contracts";

export function useVerificationReview({ caseId, revision, saved, onSaved, onPending }: {
  caseId: string; revision: number; saved: StaffReview | null; onSaved: (review: StaffReview) => void; onPending: (pending: boolean) => void;
}) {
  const router = useRouter();
  const [review, setReview] = useState(saved);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const latest = useRef(saved);
  const superseded = useRef(new Set<string | null>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const count = useRef(0);
  const mounted = useRef(true);
  const refresh = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remote = useRef(saved?.id);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(refresh.current); }; }, []);
  useEffect(() => {
    if (remote.current === saved?.id) return;
    remote.current = saved?.id;
    // A server refresh started before a completed cell save may arrive afterward.
    // Keep that older review from replacing the newer local save.
    if (count.current === 0 && !superseded.current.has(saved?.id ?? null)) { latest.current = saved; setReview(saved); }
  }, [saved]);

  function save(mutate: (draft: ReviewDraft) => ReviewDraft): Promise<StaffReview> {
    clearTimeout(refresh.current);
    count.current += 1;
    onPending(true);
    setPending(count.current);
    const toastId = "verification-save-status";
    toast.updated({ id: toastId, title: "Updating...", duration: 2500 });
    const job = queue.current.then(async () => {
      // Build from the last completed save, never from a stale render of another cell.
      const draft = mutate(reviewDraft(latest.current));
      const result = await write<StaffReview>(`/intakes/${caseId}/review`, {
        expected_revision: revision, expected_review_id: latest.current?.id ?? null, ...draft,
      });
      superseded.current.add(latest.current?.id ?? null);
      latest.current = result;
      onSaved(result);
      if (mounted.current) { setReview(result); setError(""); }
      toast.saved({ id: toastId, title: "Saved!", duration: 2500 });
      return result;
    });
    const handled = job.catch((cause) => {
      const msg = cause instanceof Error ? cause.message : "Could not save this edit.";
      if (mounted.current) setError(msg);
      toast.error({ id: toastId, title: "Save failed", description: msg, duration: 4000 });
      throw cause;
    }).finally(() => {
      count.current -= 1;
      onPending(count.current > 0);
      if (mounted.current) {
        setPending(count.current);
        if (!count.current) refresh.current = setTimeout(() => router.refresh(), 400);
      }
    });
    queue.current = handled.catch(() => undefined);
    return handled;
  }
  return { review, pending, error, clearError: () => setError(""), save };
}
