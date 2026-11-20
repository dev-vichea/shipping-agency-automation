"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { reviewDraft, reviewKey, type ReviewDraft } from "@/components/staff-review";
import type { Evidence, FieldSuggestion, Finding, FindingDecision, ReviewAnalysis, ReviewWorkflow, StaffReview } from "@/lib/contracts";
import { documentFieldLabel, location, sourceValue, timestamp } from "@/lib/format";

function DecisionControls({ current, busy, canApprove, onDecide }: {
  current?: FindingDecision; busy: boolean; canApprove: boolean;
  onDecide: (action: FindingDecision["action"], note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  async function decide(action: FindingDecision["action"]) {
    setError("");
    try { await onDecide(action, note.trim()); setNote(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this decision."); }
  }
  return <div className="space-y-2">
    {current && <p role="status" className="text-xs font-medium">{current.action} · {current.note}</p>}
    <label className="grid gap-1 text-xs">Decision reason
      <Input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="What did you verify against the source?" />
    </label>
    <div className="flex flex-wrap gap-2">
      <Button size="xs" disabled={busy || !note.trim() || !canApprove} onClick={() => void decide("approved")}>Approve selection</Button>
      <Button size="xs" variant="outline" disabled={busy || !note.trim()} onClick={() => void decide("rejected")}>Reject suggestion</Button>
      <Button size="xs" variant="outline" disabled={busy || !note.trim()} onClick={() => void decide("unresolved")}>Flag unresolved</Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}

function DocumentFinding({ finding, offer, current, busy, enabled, onSave, onInspect, onEdit }: {
  finding: Finding; offer?: FieldSuggestion; current?: FindingDecision; busy: boolean; enabled: boolean;
  onSave: (decision: FindingDecision) => Promise<void>; onInspect: (cite: Evidence) => void;
  onEdit: (value: string, note: string) => Promise<void>;
}) {
  const [choice, setChoice] = useState("");
  const [manual, setManual] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const option = choice === "" ? undefined : offer?.options[Number(choice)];
  return <article className="space-y-3 rounded-lg border p-3" aria-label={`${documentFieldLabel(finding.field)} finding`}>
    <div className="flex justify-between gap-2 text-sm font-semibold"><span>{documentFieldLabel(finding.field)}</span><span className="text-warning">{finding.outcome.replaceAll("_", " ")}</span></div>
    <p className="text-xs text-muted-foreground">{finding.explanation}</p>
    <p className="text-xs">{finding.left ?? "Missing"} ↔ {finding.right ?? "Missing"}</p>
    <div className="flex flex-wrap gap-2">{finding.evidence.map((cite, index) => <button key={index} type="button" className="data-link text-xs" onClick={() => onInspect(cite)}>{location(cite)}</button>)}</div>
    {enabled && !!offer?.options.length && <label className="grid gap-1 text-xs">Source value to use for {offer.target?.role.replaceAll("_", " ")}
      <NativeSelect value={choice} onChange={(event) => setChoice(event.target.value)}>
        <option value="">Choose after checking evidence</option>
        {offer.options.map((entry, index) => <option key={index} value={index} disabled={entry.field.status !== "present"}>
          {sourceValue(entry.field)} · {entry.source.role} · {entry.field.evidence.map(location).join(", ")}{entry.field.status !== "present" ? " · uncertain" : ""}
        </option>)}
      </NativeSelect>
      <span className="text-muted-foreground">Source agreement does not prove which document is correct.</span>
    </label>}
    <DecisionControls current={current} busy={busy} canApprove={!!option && enabled} onDecide={(action, note) => onSave({ key: finding.key, action, note, source: action === "approved" ? option?.source : null })} />
    {offer?.target && <details className="text-xs"><summary className="cursor-pointer text-primary">Edit field with reason</summary>
      <div className="grid gap-2 pt-2">
        <label>Reviewed value<Input value={manual} maxLength={350} onChange={(event) => setManual(event.target.value)} /></label>
        <label>Correction reason<Input value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} /></label>
        <Button size="xs" disabled={busy || !manual.trim() || !reason.trim()} onClick={async () => {
          setError("");
          try { await onEdit(manual.trim(), reason.trim()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save correction."); }
        }}>Save correction</Button>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
    </details>}
  </article>;
}

function CdcLine({ row, description, quantity, price, candidates, findings, current, busy, onSave, onInspect }: {
  row: number; description: string; quantity: string; price: string; candidates: ReviewAnalysis["candidates"]; findings: Finding[];
  current?: FindingDecision; busy: boolean; onSave: (decision: FindingDecision) => Promise<void>; onInspect: (cite: Evidence) => void;
}) {
  const [choice, setChoice] = useState(current?.master_row ? String(current.master_row) : "");
  const candidate = candidates.find((entry) => String(entry.master_row) === choice);
  return <article className="space-y-3 rounded-lg border p-3" aria-label={`CDC invoice row ${row}`}>
    <h3 className="text-sm font-semibold">Invoice row {row} · {description}</h3>
    <p className="text-xs">Invoice quantity: {quantity} · Unit price: {price}</p>
    <label className="grid gap-1 text-xs">CDC material candidate
      <NativeSelect value={choice} onChange={(event) => setChoice(event.target.value)}>
        <option value="">{candidates.length ? "Choose a candidate after reviewing evidence" : "No candidate found"}</option>
        {candidates.map((entry) => <option key={entry.master_row} value={entry.master_row}>{entry.serial ?? `Row ${entry.master_row}`} · {entry.description} · {entry.score.toFixed(0)}% similarity</option>)}
      </NativeSelect>
    </label>
    {candidate && <div className="space-y-1 text-xs">
      <p>{candidate.reasons?.join("; ")}</p>
      <p>Unit: {candidate.unit ?? "Unknown"} · Remaining quantity: {candidate.remaining_quantity ?? "Unknown"} · Unit price: {candidate.unit_price ?? "Unknown"} {candidate.currency ?? ""}</p>
      <button className="data-link" type="button" onClick={() => onInspect(candidate.evidence)}>CDC evidence · {location(candidate.evidence)}</button>
      {candidate.checks?.map((check) => <p key={check.key} className={check.outcome === "PASS" ? "text-success" : "text-warning"}>{documentFieldLabel(check.field)}: {check.outcome.replaceAll("_", " ")} · {check.left ?? "Missing"} ↔ {check.right ?? "Missing"}</p>)}
    </div>}
    {!candidates.length && <p className="text-xs text-warning">No material has been selected. Verify the company and CDC version or flag this line for follow-up.</p>}
    <DecisionControls current={current} busy={busy} canApprove={!!candidate} onDecide={(action, note) => onSave({ key: `cdc.row.${row}.mapping`, action, note, master_row: action === "approved" ? candidate?.master_row : null })} />
    <div className="space-y-1 text-xs">{findings.map((finding) => <p key={finding.key} className={finding.outcome === "PASS" ? "text-success" : "text-warning"}>{documentFieldLabel(finding.field)} · {finding.outcome.replaceAll("_", " ")} · {finding.explanation}{finding.left && ` (${finding.left} / ${finding.right ?? "unknown"})`}</p>)}</div>
  </article>;
}

export function AutoSuggestionReview({ analysis, workflow, saved, busy, enabled, onSave, onInspect }: {
  analysis: ReviewAnalysis; workflow: ReviewWorkflow; saved: StaffReview | null; busy: boolean; enabled: boolean;
  onSave: (draft: ReviewDraft) => Promise<StaffReview>; onInspect: (cite: Evidence) => void;
}) {
  const [tab, setTab] = useState<"fields" | "cdc">("fields");
  const [error, setError] = useState("");
  const decisions = saved?.finding_decisions ?? [];
  const findings = saved?.findings ?? analysis.findings.filter((entry) => entry.group !== "cdc");
  const documents = findings.filter((entry) => entry.group !== "cdc" && entry.outcome !== "PASS");
  const invoice = analysis.extractions.find((entry) => entry.role === "invoice");
  const cdcFindings = saved?.cdc_findings ?? analysis.findings.filter((entry) => entry.group === "cdc");
  const candidates = saved?.candidates ?? analysis.candidates;
  const stale = analysis.state !== "available" || analysis.analysis_revision !== analysis.revision;
  const disabled = busy || stale;
  async function decide(decision: FindingDecision) {
    const draft = reviewDraft(saved);
    await onSave({ ...draft,
      corrections: draft.corrections.filter((entry) => !entry.suggestion_source),
      finding_decisions: [...decisions.filter((entry) => entry.key !== decision.key), decision],
    });
  }
  const passed = analysis.findings.filter((entry) => entry.group !== "cdc" && entry.outcome === "PASS");
  return <div className="space-y-3">
    {stale && <p role="alert" className="text-xs text-warning">Documents changed. Wait for the current analysis before reviewing.</p>}
    {!!workflow.finding_audit?.some((entry) => entry.stale) && <p className="text-xs text-warning">Previous decisions belong to older evidence. Review this revision again.</p>}
    <div role="tablist" aria-label="Review sections" className="flex gap-2 border-b pb-2">
      <Button role="tab" aria-selected={tab === "fields"} variant={tab === "fields" ? "default" : "outline"} size="sm" onClick={() => setTab("fields")}>Document Fields ({documents.length})</Button>
      <Button role="tab" aria-selected={tab === "cdc"} variant={tab === "cdc" ? "default" : "outline"} size="sm" onClick={() => setTab("cdc")}>CDC Items ({invoice?.items.length ?? 0})</Button>
    </div>
    {tab === "fields" ? <div role="tabpanel" aria-label="Document Fields" className="space-y-3">
      {!documents.length && <p className="text-sm">Document comparisons pass. Staff confirmation is still required.</p>}
      {documents.map((finding) => {
        const offer = workflow.field_suggestions?.find((entry) => entry.key === finding.key);
        return <DocumentFinding key={`${finding.key}:${saved?.id ?? "new"}`} finding={finding} offer={offer} current={decisions.find((entry) => entry.key === finding.key)} busy={disabled} enabled={enabled} onSave={decide} onInspect={onInspect}
          onEdit={async (value, note) => {
            if (!offer?.target) return;
            const target = offer.target;
            const original = offer.options.find((entry) => reviewKey(entry.source) === reviewKey(target))?.field;
            const draft = reviewDraft(saved);
            await onSave({ ...draft,
              finding_decisions: decisions.filter((entry) => entry.key !== finding.key),
              corrections: [...draft.corrections.filter((entry) => !entry.suggestion_source && reviewKey(entry) !== reviewKey(target)), { ...target, value, note, unit: original?.unit ?? null, currency: original?.currency ?? null }],
            });
          }} />;
      })}
      <Button variant="outline" size="sm" disabled={disabled || documents.length > 0 || !passed.length} onClick={async () => {
        setError("");
        try { await onSave({ ...reviewDraft(saved), finding_decisions: [...decisions.filter((entry) => !passed.some((check) => check.key === entry.key)), ...passed.map((entry): FindingDecision => ({ key: entry.key, action: "approved", note: "Confirmed passing comparisons against the cited documents." }))] }); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Could not confirm passing checks."); }
      }}>Confirm all passing document checks</Button>
      {documents.length > 0 && <p className="text-xs text-muted-foreground">Resolve conflicting or uncertain fields individually before confirming all.</p>}
    </div> : <div role="tabpanel" aria-label="CDC Items" className="space-y-3">
      <p className="text-xs">{analysis.analyzed_master ? `${analysis.analyzed_master.company} · ${analysis.analyzed_master.approval_ref} (${analysis.analyzed_master.year})` : "Select the applicable company Master List in the CDC section."}</p>
      <p className="text-xs text-muted-foreground">Material identity approval does not clear shortages, unknown balances, or price differences. Suggestions do not deduct stock.</p>
      {saved && <p role="status" className={saved.cdc_ready ? "text-success text-xs" : "text-warning text-xs"}>{saved.cdc_ready ? "CDC checks complete" : "CDC checks remain unresolved"}</p>}
      {invoice?.items.map((item) => <CdcLine key={`${invoice.document_id}:${item.row}:${saved?.id ?? "new"}`} row={item.row} description={sourceValue(item.fields.description)}
        quantity={sourceValue(item.fields.quantity)} price={sourceValue(item.fields.unit_price)}
        candidates={enabled ? candidates.filter((entry) => entry.invoice_document_id === invoice.document_id && entry.invoice_row === item.row) : []}
        findings={cdcFindings.filter((entry) => entry.key.startsWith(`cdc.row.${item.row}.`) || entry.key === `cdc.unit.${item.row}` || entry.key === `cdc.unit_price.${item.row}`)}
        current={decisions.find((entry) => entry.key === `cdc.row.${item.row}.mapping`)} busy={disabled} onSave={decide} onInspect={onInspect} />)}
      {cdcFindings.filter((entry) => entry.key.startsWith("cdc.quota.") || ["company", "version", "year"].includes(entry.field)).map((finding) => <p key={finding.key} className="text-xs text-warning">{documentFieldLabel(finding.field)} · {finding.outcome.replaceAll("_", " ")} · {finding.explanation}{finding.left && ` (${finding.left} / ${finding.right ?? "unknown"})`}</p>)}
    </div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {!!workflow.finding_audit?.length && <details className="text-xs"><summary>Finding decision history</summary><ul className="space-y-1 pt-2">{workflow.finding_audit.map((entry) => <li key={entry.id}>{entry.key.startsWith("cdc.row.") ? `CDC invoice row ${entry.key.split(".")[2]}` : documentFieldLabel(entry.key.split(".")[1] ?? "field")} · {entry.action} · {entry.note} · {timestamp(entry.created_at)} · {entry.actor_email ?? "Staff member"}{entry.stale ? " · superseded" : ""}</li>)}</ul></details>}
  </div>;
}
