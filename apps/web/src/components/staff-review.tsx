"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, ChevronRight, ClipboardCheck, History, PencilLine, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Section, Status } from "@/components/workspace";
import { write } from "@/lib/client-api";
import type { CaseDetail, Evidence, ExtractedField, ReviewAnalysis, ReviewCorrection, ReviewWorkflow, StaffReview } from "@/lib/contracts";
import { label, location, timestamp } from "@/lib/format";

type Target = Pick<ReviewCorrection, "document_id" | "role" | "row" | "name"> & { source: ExtractedField };
const fieldKey = ({ document_id, role, row, name }: Omit<Target, "source">) => [document_id, role, row, name].join(":");
const fieldName = (name: string) => label(name).replace(/^./, (letter) => letter.toUpperCase());

export function StaffReviewForm({ item, analysis, workflow, onInspect }: {
  item: CaseDetail;
  analysis: ReviewAnalysis;
  workflow: ReviewWorkflow;
  onInspect: (evidence: Evidence) => void;
}) {
  const router = useRouter();
  const saved = workflow.review;
  const [corrections, setCorrections] = useState(saved?.corrections ?? []);
  const [mappings, setMappings] = useState(saved?.mappings ?? []);
  const [verified, setVerified] = useState(saved?.verify_cdc_mappings ?? false);
  const [resolutions, setResolutions] = useState(saved?.resolutions ?? []);
  const [targetKey, setTargetKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, refresh] = useTransition();
  const busy = saving || refreshing;
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const base = `/intakes/${item.id}`;
  const editable = analysis.state === "available" && ["needs_review", "ready_for_approval"].includes(item.state);
  const targets: Target[] = analysis.extractions.flatMap((doc) => {
    const role = doc.role;
    if (role !== "invoice" && role !== "packing_list" && role !== "draft_bl") return [];
    return [[null, doc.fields] as const, ...doc.items.map((item) => [item.row, item.fields] as const)]
      .flatMap(([row, fields]) => Object.entries(fields).map(([name, source]) => ({
        document_id: doc.document_id, role, row, name, source,
      })));
  });
  const target = targets.find((entry) => fieldKey(entry) === targetKey);
  const existing = corrections.find((entry) => fieldKey(entry) === targetKey);
  const candidates = saved?.candidates ?? analysis.candidates;
  const candidateRows = [...new Set(candidates.map((candidate) => candidate.invoice_row))];
  const reviewable = (saved?.findings ?? analysis.findings).filter((finding) =>
    finding.outcome === "NEEDS_REVIEW" && (finding.group === "transport" ||
      (finding.group === "invoice_packing" && finding.field === "description" && !finding.key.includes(".unpaired."))));

  function addCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    const form = new FormData(event.currentTarget);
    const { document_id, role, row, name } = target;
    const value = String(form.get("value") ?? "").trim();
    const note = String(form.get("note") ?? "").trim();
    if (!value || !note) return;
    setCorrections([...corrections.filter((entry) => fieldKey(entry) !== targetKey), {
      document_id, role, row, name, value, note,
      unit: String(form.get("unit") ?? "").trim() || null,
      currency: String(form.get("currency") ?? "").trim() || null,
    }]);
    setVerified(false);
    setDirty(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>, action: "review" | "approve" | "reject" | "review-and-approve") {
    event.preventDefault();
    setSaving(true);
    setError("");
    const notes = String(new FormData(event.currentTarget).get("notes") ?? "").trim();
    try {
      const reviewData = {
        expected_revision: analysis.revision, expected_review_id: saved?.id ?? null,
        corrections, mappings, resolutions: resolutions.filter((entry) => entry.note.trim()),
        verify_cdc_mappings: verified,
      };
      if (action === "review") {
        await write<StaffReview>(`${base}/review`, { ...reviewData, request_correction: notes || null });
        refresh(() => router.refresh());
      } else {
        const payload = action === "review-and-approve" ? { ...reviewData, notes }
          : { expected_revision: analysis.revision, review_id: saved?.id ?? null, notes };
        const result = await write<{ import_id: string | null }>(`${base}/${action}`, payload);
        if (result.import_id) router.push(`/imports/${result.import_id}`);
        router.refresh();
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "The request could not be completed.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="space-y-3 p-3">
    {editable && <>
      <Section title="Field corrections" action={<PencilLine size={14} aria-hidden className="text-ghost" />}>
      <div className="space-y-3 p-3">
        <Label htmlFor="review-field">Field to correct</Label>
        <NativeSelect id="review-field" className="w-full" value={targetKey} onChange={(event) => setTargetKey(event.target.value)}>
          <option value="">Choose a field</option>
          {targets.map((entry) => <option key={fieldKey(entry)} value={fieldKey(entry)}>
            {label(entry.role)} · {entry.row ? `Row ${entry.row}` : "Header"} · {fieldName(entry.name)}
          </option>)}
        </NativeSelect>
        {target && <form method="post" key={targetKey} className="grid gap-3 rounded-control border p-3 sm:grid-cols-2" onSubmit={addCorrection}>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border-l-2 border-tertiary bg-intelligence-fill px-3 py-2 sm:col-span-2">
            <div className="min-w-0"><p className="panel-label text-intelligence">Extracted value</p><p className="break-words text-body-md">{target.source.value ?? "Missing"}</p></div>
            {target.source.evidence[0] && <Button type="button" size="xs" variant="outline" onClick={() => onInspect(target.source.evidence[0])}>
              {location(target.source.evidence[0])}<ArrowUpRight aria-hidden />
            </Button>}
          </div>
          <label className="grid gap-1.5 text-label-md">Reviewed value<Input name="value" required maxLength={350} defaultValue={existing?.value ?? target.source.value ?? ""} /></label>
          <label className="grid gap-1.5 text-label-md">Correction reason<Input name="note" required maxLength={1000} defaultValue={existing?.note} /></label>
          {["packages", "gross_weight", "net_weight"].includes(target.name) &&
            <label className="grid gap-1.5 text-label-md">Unit<Input name="unit" maxLength={24} defaultValue={existing?.unit ?? target.source.unit ?? ""} /></label>}
          {["unit_price", "amount"].includes(target.name) &&
            <label className="grid gap-1.5 text-label-md">Currency<Input name="currency" maxLength={3} defaultValue={existing?.currency ?? target.source.currency ?? ""} /></label>}
          <div className="sm:col-span-2"><Button type="submit" variant="outline" size="sm">Apply field correction</Button></div>
        </form>}
        {corrections.map((entry) => <div key={fieldKey(entry)} className="flex items-start justify-between gap-2 rounded-control bg-muted p-2 text-body-sm">
          <span className="break-all">{label(entry.role)} {entry.row ?? "header"} · {fieldName(entry.name)} · {entry.value}<br />{entry.note}</span>
          <Button type="button" variant="ghost" size="xs" aria-label={`Remove ${fieldName(entry.name)} correction`} onClick={() => {
            setCorrections(corrections.filter((value) => fieldKey(value) !== fieldKey(entry)));
            setVerified(false);
            setDirty(true);
          }}>Remove</Button>
        </div>)}
      </div>
      </Section>
      {candidateRows.length > 0 && <Section title="Verify CDC candidates"><div className="space-y-3 p-3">
        {candidateRows.map((row) => <label key={row} className="grid gap-1.5 text-label-md">CDC match for invoice row {row}
          <NativeSelect className="block w-full" value={mappings.find((entry) => entry.invoice_row === row)?.master_row ?? ""} onChange={(event) => {
            const master_row = Number(event.target.value);
            setMappings([...mappings.filter((entry) => entry.invoice_row !== row), ...(master_row ? [{ invoice_row: row, master_row }] : [])]);
            setVerified(false);
            setDirty(true);
          }}>
            <option value="">Pending verification</option>
            {candidates.filter((candidate) => candidate.invoice_row === row).map((candidate) =>
              <option key={candidate.master_row} value={candidate.master_row}>Row {candidate.master_row} · {candidate.description}</option>)}
          </NativeSelect>
        </label>)}
        {mappings.length > 0 && <label className="flex items-start gap-2 rounded-control border bg-background p-2 text-body-sm">
          <input type="checkbox" checked={verified} onChange={(event) => {
            setVerified(event.target.checked);
            setDirty(true);
          }} />
          I verified the selected CDC items against the workbook and the shipment specifications.
        </label>}
      </div></Section>}
      {reviewable.length > 0 && <Section title="Resolve wording or uncertain transport fields"><div className="space-y-3 p-3">
        {reviewable.map((finding) => <label key={finding.key} className="grid gap-1.5 text-label-md">
          {fieldName(finding.field)} · {[finding.left, finding.right].filter(Boolean).join(" / ") || finding.explanation}
          <Input maxLength={1000} value={resolutions.find((entry) => entry.key === finding.key)?.note ?? ""} onChange={(event) => {
            setResolutions([...resolutions.filter((entry) => entry.key !== finding.key), { key: finding.key, note: event.target.value }]);
            setDirty(true);
          }} />
        </label>)}
      </div></Section>}
      <form className="flex items-center justify-end gap-3 rounded-control border bg-background px-3 py-2" method="post" onSubmit={(event) => submit(event, "review")}>
        {dirty && <span className="text-body-sm text-muted-foreground">Unsaved changes</span>}
        <Button size="sm" disabled={busy || (mappings.length > 0 && !verified)}><Save aria-hidden />Save review</Button>
      </form>
      <details className="group panel overflow-hidden">
        <summary className="panel-trigger flex list-none items-center justify-between">Request correction<ChevronRight size={14} aria-hidden className="group-open:rotate-90" /></summary>
        <form method="post" className="space-y-2 border-t p-3" onSubmit={(event) => submit(event, "review")}>
          <label className="grid gap-1.5 text-label-md">Correction request<Textarea name="notes" required maxLength={1000} /></label>
          <Button size="sm" variant="outline" disabled={busy || (mappings.length > 0 && !verified)}>Record correction request</Button>
        </form>
      </details>
    </>}
    {saved && <Section title="Saved review" action={<Status value={editable ? saved.ready ? "ready_for_approval" : "needs_review" : item.state} />}>
      <p className="border-b px-3 py-2 text-body-sm text-muted-foreground">Reviewed {timestamp(saved.created_at)}</p>
      {saved.changes?.length > 0 && <Table>
        <TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Extracted</TableHead><TableHead>Reviewed</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
        <TableBody>{saved.changes.map(({ edit, before, after }) => <TableRow key={fieldKey(edit)}>
          <TableCell className="text-label-md">{fieldName(edit.name)}</TableCell>
          <TableCell className="whitespace-normal break-words text-muted-foreground">{[before.value, before.currency, before.unit].filter(Boolean).join(" ") || "Missing"}</TableCell>
          <TableCell className="whitespace-normal break-words font-medium text-primary">{[after.value, after.currency, after.unit].filter(Boolean).join(" ")}</TableCell>
          <TableCell className="max-w-56 whitespace-normal break-words">{edit.note}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      {saved.blockers.length > 0 && <ul className="list-disc space-y-1 border-t border-warning-border bg-warning-fill px-3 py-2 pl-7 text-body-sm text-warning">{saved.blockers.map((message, index) => <li key={index}>{message}</li>)}</ul>}
    </Section>}
    {(editable || item.state === "failed") && <div className="grid gap-2 sm:grid-cols-2">
      {(saved?.ready || (!saved && item.state === "ready_for_approval") || dirty) && <Section title="Intake approval" action={<ClipboardCheck size={14} aria-hidden className="text-success" />}><form method="post" className="space-y-2 p-3" onSubmit={(event) => submit(event, saved?.ready && !dirty ? "approve" : "review-and-approve")}>
        <p className="text-body-sm">Creates or updates one approved import and its report entry.</p>
        <p className="text-body-sm">{saved?.permit_pending
          ? `Permit pending · ${saved.permit_pending}`
          : "Generates an unsubmitted permit INV/PL draft if its checks still pass."}</p>
        <label className="grid gap-1.5 text-label-md">Approval note<Textarea name="notes" required maxLength={1000} disabled={busy} /></label>
        {(!saved?.ready || dirty) && <label className="flex items-start gap-2 text-label-md"><input type="checkbox" required className="mt-0.5" /> Confirm the reviewed values for this import.</label>}
        <Button size="sm" disabled={busy || (mappings.length > 0 && !verified)}><Check aria-hidden />{saved?.ready && !dirty ? "Approve intake" : "Save and approve"}</Button>
      </form></Section>}
      <Section title="Intake rejection"><form method="post" className="space-y-2 p-3" onSubmit={(event) => submit(event, "reject")}>
        <label className="grid gap-1.5 text-label-md">Rejection reason<Textarea name="notes" required maxLength={1000} /></label>
        <Button size="sm" variant="destructive" disabled={busy}><X aria-hidden />Reject intake</Button>
      </form></Section>
    </div>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {workflow.decisions.length > 0 && <details className="group panel overflow-hidden text-body-sm">
      <summary className="panel-trigger flex list-none items-center justify-between">
        <span className="inline-flex items-center gap-2"><History size={14} aria-hidden className="text-ghost" />Decision history</span>
        <ChevronRight size={14} aria-hidden className="group-open:rotate-90" />
      </summary>
      {workflow.decisions.map((decision) => <div key={decision.id} className="space-y-2 break-words border-t p-3">
        <div className="flex flex-wrap items-center gap-2"><Status value={decision.decision} /><span className="text-label-md">{fieldName(decision.scope)} · Revision {decision.revision}</span><time className="font-mono text-code-tabular text-muted-foreground">{timestamp(decision.created_at)}</time></div>
        <p>{decision.notes} {decision.recipient}</p>
        {decision.permit_pending && <p>{decision.permit_pending}</p>}
        <dl className="grid gap-1.5 rounded-control border bg-background p-2">
          <div><dt className="panel-label">Actor ID</dt><dd className="break-all font-mono text-code-tabular">{decision.actor_id}</dd></div>
          <div><dt className="panel-label">Snapshot SHA-256</dt><dd className="break-all font-mono text-code-tabular">{decision.snapshot_hash}</dd></div>
        </dl>
        {decision.review_id && <Button asChild size="xs" variant="outline"><a href={`/api/v1/intakes/${item.id}/review/${decision.review_id}`}>Open review record<ArrowUpRight aria-hidden /></a></Button>}
      </div>)}
    </details>}
  </div>;
}
