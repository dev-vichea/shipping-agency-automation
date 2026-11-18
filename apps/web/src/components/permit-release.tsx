"use client";

import { useState, type FormEvent } from "react";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { write } from "@/lib/client-api";
import { toast } from "@/components/ui/toast";

export function PermitRelease({ importId, draftId, recipient }: {
  importId: string;
  draftId: string;
  recipient?: string;
}) {
  const [authorized, setAuthorized] = useState(recipient);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const result = await write<{ recipient: string }>(`/imports/${importId}/permit-drafts/${draftId}/release`, {
        recipient: data.get("recipient"), notes: data.get("notes"),
      });
      setAuthorized(result.recipient);
      toast.saved("Release authorized!");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not authorize release.");
    } finally {
      setBusy(false);
    }
  }

  if (authorized) return <p className="flex items-start gap-2 break-all rounded-control border border-success-border bg-success-fill p-2 text-body-sm text-success"><ShieldCheck size={14} aria-hidden className="shrink-0" />Release authorized for {authorized} · delivery pending</p>;
  return <details className="group overflow-hidden rounded-control border">
    <summary className="panel-trigger flex list-none items-center justify-between"><span className="flex items-center gap-2"><ShieldCheck size={14} aria-hidden className="text-ghost" />Authorize broker release</span><ChevronRight size={14} aria-hidden className="group-open:rotate-90" /></summary>
    <form method="post" className="grid gap-3 border-t p-3 sm:grid-cols-2" onSubmit={submit}>
      <p className="text-body-sm text-muted-foreground sm:col-span-2">Records authorization for this exact workbook and broker address. Delivery is a separate step.</p>
      <label className="grid gap-1.5 text-label-md">Broker email<Input name="recipient" type="email" required maxLength={254} /></label>
      <label className="grid gap-1.5 text-label-md">Release note<Input name="notes" required maxLength={1000} /></label>
      <div className="sm:col-span-2"><Button size="sm" variant="outline" disabled={busy}>Record release authorization</Button></div>
      {error && <p role="alert" className="field-error sm:col-span-2">{error}</p>}
    </form>
  </details>;
}
