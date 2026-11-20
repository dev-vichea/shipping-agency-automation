"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ReviewAnalysis, ReviewField, ReviewWorkflow, StaffReview } from "@/lib/contracts";
import { documentFieldLabel, timestamp } from "@/lib/format";

export type ReviewDraft = Pick<StaffReview, "corrections" | "resolutions" | "mappings" | "verify_cdc_mappings" | "request_correction">
  & { issue_actions: NonNullable<StaffReview["issue_actions"]>; finding_decisions?: StaffReview["finding_decisions"] };

export function reviewKey({ document_id, role, row, name }: ReviewField) {
  return `field:${document_id}:${role}:${row ?? 0}:${name}`;
}

export function reviewDraft(saved: StaffReview | null): ReviewDraft {
  return {
    corrections: saved?.corrections ?? [],
    resolutions: saved?.resolutions ?? [],
    mappings: saved?.mappings ?? [],
    verify_cdc_mappings: saved?.verify_cdc_mappings ?? false,
    issue_actions: saved?.issue_actions ?? [],
    request_correction: saved?.request_correction ?? null,
    finding_decisions: saved?.finding_decisions ?? [],
  };
}

export function ReviewCdcMappings({ candidates, saved, busy, onSave, openInitially = false }: {
  candidates: ReviewAnalysis["candidates"]; saved: StaffReview | null; busy: boolean;
  onSave: (mappings: StaffReview["mappings"]) => Promise<void>;
  openInitially?: boolean;
}) {
  const [mappings, setMappings] = useState(saved?.mappings ?? []);
  const [verified, setVerified] = useState(saved?.verify_cdc_mappings ?? false);
  const [error, setError] = useState("");
  const rows = [...new Set(candidates.map((candidate) => candidate.invoice_row))];
  if (!rows.length) return null;
  return <details className="text-xs" open={openInitially || undefined}>
    <summary className="cursor-pointer text-primary font-semibold">Verify CDC candidates</summary>
    <form className="space-y-2 py-2" onSubmit={(event) => {
      event.preventDefault();
      setError("");
      void onSave(mappings).catch((cause) => setError(cause.message));
    }}>
      {rows.map((row) => <label key={row} className="grid gap-1">CDC match for invoice row {row}
        <NativeSelect value={mappings.find((entry) => entry.invoice_row === row)?.master_row ?? ""}
          onChange={(event) => {
            const master_row = Number(event.target.value);
            setVerified(false);
            setMappings((previous) => [...previous.filter((entry) => entry.invoice_row !== row),
              ...(master_row ? [{ invoice_row: row, master_row }] : [])]);
          }}>
          <option value="">Pending verification</option>
          {candidates.filter((entry) => entry.invoice_row === row).map((entry) =>
            <option key={entry.master_row} value={entry.master_row}>Row {entry.master_row} · {entry.description}</option>)}
        </NativeSelect>
      </label>)}
      {mappings.length > 0 && <label className="flex gap-2">
        <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
        I verified the selected CDC items.
      </label>}
      <Button size="xs" type="submit" variant="outline" disabled={busy || (mappings.length > 0 && !verified)}>Save CDC matches</Button>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </form>
  </details>;
}

export function ReviewAuditControls({ caseId, workflow, saved, busy, editable, onResolve, onRequestCorrection, onReject }: {
  caseId: string; workflow: ReviewWorkflow; saved: StaffReview | null; busy: boolean; editable: boolean;
  onResolve: (key: string, note: string) => Promise<void>; onRequestCorrection: (note: string | null) => Promise<void>; onReject: (note: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const resolutions = workflow.issues?.filter((issue) => issue.can_resolve &&
    (!saved?.open_issues || issue.key in saved.open_issues)) ?? [];

  function submit(event: FormEvent<HTMLFormElement>, save: (note: string) => Promise<void>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    if (!note) return;
    setError("");
    void save(note).catch((cause) => setError(cause.message));
  }

  return <>
    {saved?.blockers.length ? <details className="text-xs">
      <summary className="cursor-pointer">{saved.blockers.length} approval blockers</summary>
      <ul className="list-disc space-y-1 py-1 pl-4">{saved.blockers.map((message, index) => <li key={index}>{message}</li>)}</ul>
    </details> : null}
    {editable && resolutions.length > 0 && <details className="text-xs">
      <summary className="cursor-pointer">Resolve with note</summary>
      <div className="space-y-2 py-2">
        {resolutions.map((issue) => <form key={issue.key} className="space-y-1" onSubmit={(event) => submit(event, (note) => onResolve(issue.key, note))}>
          <label className="grid gap-0.5">{documentFieldLabel(issue.name)} · {issue.message}<Input name="note" required maxLength={1000} /></label>
          <Button type="submit" size="xs" variant="outline" disabled={busy}>Save resolution</Button>
        </form>)}
      </div>
    </details>}
    {!!workflow.history?.length && <details className="text-xs">
      <summary className="cursor-pointer">Review history</summary>
      <ul className="space-y-1 py-1">{workflow.history.map((entry) => <li key={entry.id}>
        <a className="data-link" target="_blank" rel="noreferrer" href={`/api/v1/intakes/${caseId}/review/${entry.id}`}>
          {timestamp(entry.created_at)} · {entry.actor_email ?? entry.actor_id}
        </a>
      </li>)}</ul>
    </details>}
    {editable && <details className="text-xs">
      <summary className="cursor-pointer">Request correction</summary>
      <form className="space-y-1 py-2" onSubmit={(event) => submit(event, onRequestCorrection)}>
        <label className="grid gap-1">Note<Input name="note" required maxLength={1000} defaultValue={saved?.request_correction ?? ""} /></label>
        <Button type="submit" variant="outline" size="xs" disabled={busy}>Save request</Button>
        {saved?.request_correction && <Button type="button" variant="ghost" size="xs" disabled={busy}
          onClick={() => void onRequestCorrection(null).catch((cause) => setError(cause.message))}>Clear request</Button>}
      </form>
    </details>}
    {editable && <details className="text-xs">
      <summary className="cursor-pointer">Reject intake</summary>
      <form className="space-y-1 py-2" onSubmit={(event) => submit(event, onReject)}>
        <label className="grid gap-1">Reason<Input name="note" required maxLength={1000} /></label>
        <Button type="submit" variant="destructive" size="xs" disabled={busy}>Reject intake</Button>
      </form>
    </details>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </>;
}
