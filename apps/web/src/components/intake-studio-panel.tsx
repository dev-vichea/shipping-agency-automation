"use client";

import { useId, useState } from "react";
import { Anchor, Box, Check, DollarSign, FileText, Minus, Package, RotateCcw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sourceKey } from "@/components/review-evidence";
import type { FieldEditor } from "@/components/evidence-field-card";
import type { CaseDetail, CdcItemName, Evidence, ExtractedField, Extraction, ReviewAnalysis, ReviewField } from "@/lib/contracts";
import { documentFieldLabel, intakeField, invoiceReference, location } from "@/lib/format";
import { lastPageOffset, pageSize } from "@/lib/pagination";
import { cn } from "@/lib/utils";

export type InspectedField = {
  name: string;
  value: string;
  id?: string;
  uncertain?: boolean;
  target?: ReviewField;
};

export type TabDocumentItem = {
  id: string;
  name: string;
  classification?: string;
  version_number?: number;
  is_superseded?: boolean;
  reference?: string | null;
};

const groups = [
  { title: "Document Details", icon: FileText, keys: ["bl_no", "booking_no", "invoice_no", "invoice_date", "issue_date", "shipper", "supplier", "consignee", "notify_party", "carrier", "origin", "port", "destination", "shipping_mode", "vessel", "voyage", "etd", "eta", "payment_terms", "incoterms"] },
  { title: "Container & Cargo", icon: Package, keys: ["container", "seal", "packages", "gross_weight", "net_weight", "measurement"] },
  { title: "Amounts", icon: DollarSign, keys: ["amount", "currency", "subtotal", "total"] },
  { title: "Goods", icon: Box, keys: ["cargo_summary"] },
];

const knownFields = new Set(groups.flatMap(({ keys }) => keys));

const roleDetails = {
  draft_bl: { name: "Draft Bill of Lading", icon: Anchor },
  final_bl: { name: "Final Bill of Lading", icon: Anchor },
  invoice: { name: "Commercial Invoice", icon: FileText },
  packing_list: { name: "Packing List", icon: Package },
};

const statuses = {
  present: { icon: Check, label: "Source available", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30" },
  problem: { icon: X, label: "Mismatch", color: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30" },
  review: { icon: Minus, label: "Needs review", color: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30" },
  missing: { icon: Minus, label: "Missing", color: "bg-muted text-muted-foreground border border-border" },
};

export function IntakeStatusDot({ status }: { status: keyof typeof statuses }) {
  const { icon: Icon, color } = statuses[status];
  return <span aria-hidden="true" data-field-status={status} className={cn("inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-[10px]", color)}>
    <Icon size={10} strokeWidth={2.4} />
  </span>;
}

export function intakeStatus(field?: ExtractedField, needsReview = false) {
  if (needsReview || field?.status === "uncertain" || (
    field?.english && ["proposed", "pending", "ambiguous", "unavailable", "unsupported", "limit_reached"].includes(field.english.status)
  )) return "review";
  return field?.value ? "present" : "missing";
}

function InlineReviewDrawer({
  editor,
  name,
  status,
  isUncertain,
  currentValue,
  onDismiss,
}: {
  editor: FieldEditor;
  name: string;
  status?: keyof typeof statuses;
  isUncertain?: boolean;
  currentValue?: string;
  onDismiss?: () => void;
}) {
  const [text, setText] = useState(editor.value ?? "");
  const [dimension, setDimension] = useState(
    editor.dimension ? (editor[editor.dimension] as string | undefined) ?? "" : ""
  );
  const [error, setError] = useState("");
  const ValueInput = editor.multiline ? "textarea" : "input";
  const dirty =
    text.trim() !== (editor.value ?? "").trim() ||
    (!!editor.dimension && dimension.trim() !== ((editor[editor.dimension] as string | undefined) ?? "").trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editor.busy || !text.trim() || (editor.reviewed && !dirty)) return;
    setError("");
    try {
      const unit =
        editor.dimension === "unit" ? dimension.trim() || null : editor.unit;
      const currency =
        editor.dimension === "currency" ? dimension.trim() || null : editor.currency;
      await editor.onSave({ value: text.trim(), unit, currency });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save field");
    }
  }

  return (
    <div
      className="border-t border-border/40 bg-muted/20 px-3 py-2 space-y-2 text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status === "problem" && (
            <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
              Source values conflict
            </span>
          )}
          {status === "review" && (
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
              Needs confirmation
            </span>
          )}
          {isUncertain && !editor.reviewed && currentValue && (
            <button
              type="button"
              disabled={editor.busy}
              onClick={() => void editor.onSave({
                value: editor.value || currentValue,
                unit: editor.unit,
                currency: editor.currency,
              })}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
            >
              <Check size={11} /> Confirm extracted
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground ml-auto">
          {editor.reviewed && (
            <button
              type="button"
              disabled={editor.busy}
              onClick={() => void editor.onUndo()}
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
              title="Reset to original value"
            >
              <RotateCcw size={10} /> Reset
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="hover:text-foreground transition-colors p-0.5 rounded-sm cursor-pointer"
              title="Close"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {editor.choices.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mr-0.5">
            Sources:
          </span>
          {editor.choices.map((choice) => {
            const isCurrent = choice.value.trim() === (editor.value ?? "").trim();
            const sourceRole = choice.label.split("·")[0].trim().replace(" / ", "/");
            return (
              <button
                key={choice.id}
                type="button"
                disabled={editor.busy}
                onClick={() => {
                  editor.onPreview(choice);
                  void editor.onSave({
                    value: choice.value,
                    unit: choice.unit ?? editor.unit,
                    currency: choice.currency ?? editor.currency,
                    choice,
                  });
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] transition-colors border cursor-pointer",
                  isCurrent
                    ? "border-primary/40 bg-primary/10 text-primary font-medium"
                    : "border-border/60 bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
                title={`Select ${choice.value} from ${sourceRole}`}
              >
                {isCurrent && <Check size={10} className="shrink-0 text-primary" />}
                <span className="text-[10px] uppercase font-semibold opacity-70">{sourceRole}:</span>
                <span className="truncate max-w-[200px]">{choice.value}</span>
              </button>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-1">
        <div className="flex items-center gap-1.5">
          <ValueInput
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={editor.busy}
            rows={editor.multiline ? 1 : undefined}
            className="flex-1 min-w-0 resize-none rounded border border-border/70 bg-background px-2 py-1 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            placeholder={`Enter ${name.toLowerCase()}…`}
          />
          {editor.dimension && (
            <input
              value={dimension}
              onChange={(e) => setDimension(e.target.value)}
              disabled={editor.busy}
              maxLength={editor.dimension === "unit" ? 24 : 3}
              placeholder={editor.dimension === "unit" ? "Unit" : "CCY"}
              className="w-16 rounded border border-border/70 bg-background px-2 py-1 text-xs font-mono uppercase focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            />
          )}
          {dirty && (
            <>
              <button
                type="button"
                onClick={() => {
                  setText(editor.value ?? "");
                  setDimension(editor.dimension ? (editor[editor.dimension] as string | undefined) ?? "" : "");
                }}
                className="px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
              >
                Cancel
              </button>
              <Button
                type="submit"
                size="xs"
                disabled={editor.busy || !text.trim()}
                className="h-6 text-[11px] font-semibold px-2 shrink-0 cursor-pointer"
              >
                Save
              </Button>
            </>
          )}
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </form>
    </div>
  );
}

function GoodsItems({ document, active, inspect, names, candidates, editable, viewedField, isReviewed, editor, activeField, onDismissField }: {
  names: CdcItemName[];
  candidates: ReviewAnalysis["candidates"];
  document: Extraction;
  active: (id: string, evidence?: Evidence) => boolean;
  inspect: (evidence: Evidence | undefined, meta: InspectedField) => void;
  editable: boolean;
  viewedField: (target: ReviewField, field: ExtractedField) => ExtractedField;
  isReviewed: (target: ReviewField) => boolean;
  editor?: FieldEditor;
  activeField?: InspectedField;
  onDismissField?: () => void;
}) {
  const [requestedOffset, setOffset] = useState(0);
  const descriptionId = useId();
  const { items } = document;
  const offset = Math.min(requestedOffset, lastPageOffset(items.length));
  const displayed = items.slice(offset, offset + pageSize);
  const optionalColumns = document.role === "invoice" ? ["hs_code", "unit_price", "amount"] : ["hs_code", "gross_weight", "net_weight", "unit_price", "amount"];
  const columns = ["description", "quantity", ...optionalColumns.filter((key) => items.some(({ fields }) => fields[key]?.value))];

  function itemCell(field: ExtractedField | undefined, key: string, row: number) {
    const id = `item:${row}:${key}`;
    const target: ReviewField = { document_id: document.document_id, role: document.role as ReviewField["role"], row, name: key };
    const reviewed = isReviewed(target);
    const visibleField = field && viewedField(target, field);
    const name = key === "description" ? names.find((entry) => document.role === "invoice"
      ? entry.invoice_document_id === document.document_id && entry.invoice_row === row
      : entry.packing_document_id === document.document_id && entry.packing_row === row) : undefined;
    const matches = key === "description" && !name && !reviewed && document.role === "invoice"
      ? candidates.filter((entry) => entry.invoice_document_id === document.document_id && entry.invoice_row === row)
      : [];
    const suggestion = matches[0] && matches[0].score >= 60 &&
      (!matches[1] || matches[0].score - matches[1].score >= 8) ? matches[0] : undefined;
    const text = intakeField(visibleField);
    const evidence = editable ? text.evidence : name?.evidence[0] ?? suggestion?.evidence ?? text.evidence;
    const value = name?.description ?? suggestion?.description ?? text.value;
    const selected = active(id, evidence);
    const status = name || reviewed ? "present" : intakeStatus(visibleField, !!suggestion);
    const label = name ? "Verified CDC description" : suggestion ? "Suggested CDC description"
      : text.label ?? documentFieldLabel(key);
    const detail = `${label} · ${reviewed ? "Reviewed" : statuses[status].label}`;
    const content = <>
      {(key === "description" || reviewed) && <IntakeStatusDot status={status} />}
      <span>{value}</span>
      <span hidden id={`${descriptionId}-${id}`}>{detail}</span>
    </>;
    return evidence || (editable && field) ? <button type="button"
      data-connector-source={selected ? "true" : undefined}
      aria-pressed={selected} aria-describedby={`${descriptionId}-${id}`} title={evidence ? `${detail} · ${location(evidence)}` : detail}
      onClick={() => inspect(evidence, { name: documentFieldLabel(key), value, id, target, uncertain: status === "review" })}
      className={cn("data-link flex items-start gap-2 rounded-sm text-left tabular-nums", selected && "bg-primary/10")}>{content}</button>
      : <span className="inline-flex items-start gap-2">{content}</span>;
  }

  return <section aria-label="Goods items" className="space-y-1">
    <div className="flex items-center justify-between gap-2 px-0.5 pt-1.5 pb-0.5">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Box size={12} className="text-primary" aria-hidden /> Goods items
      </h3>
      <span className="tabular-nums text-xs text-muted-foreground">{items.length} {items.length === 1 ? "item" : "items"}</span>
    </div>
    <Table className="border-y text-xs">
      <TableHeader><TableRow>
        {columns.map((key) => <TableHead key={key}>{key === "description" ? "Item" : documentFieldLabel(key)}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>{displayed.map(({ row, fields }) => <TableRow key={row}>
        {columns.map((key) => <TableCell key={key} className={cn("align-top", key === "description" && "min-w-40 max-w-72 whitespace-normal break-words")}>
          {itemCell(key === "description" && !fields.description?.english && fields.english_description?.status === "present" ? fields.english_description : fields[key], key, row)}
        </TableCell>)}
      </TableRow>)}</TableBody>
    </Table>
    <Pagination label="Goods items" offset={offset} count={displayed.length} total={items.length}
      previous={offset > 0 ? () => setOffset(offset - pageSize) : undefined}
      next={offset + pageSize < items.length ? () => setOffset(offset + pageSize) : undefined} />
    {activeField?.target?.row && editor && (
      <InlineReviewDrawer
        key={`${activeField.name}:${editor.value}`}
        editor={editor}
        name={`Row ${activeField.target.row}: ${activeField.name}`}
        isUncertain={activeField.uncertain}
        currentValue={activeField.value}
        onDismiss={onDismissField}
      />
    )}
  </section>;
}

export function IntakeStudioPanel({
  item, analysis, document, activeEvidence, activeField, activeRole, onInspect,
  cdcNames, cdcControls, intakeReference, editable, hasConsigneeOptions, viewedField, isReviewed,
  editor, onDismissField, tabDocuments, currentDocumentId, onSelectDocument,
}: {
  item: CaseDetail;
  intakeReference: string | null;
  cdcNames: CdcItemName[];
  cdcControls?: React.ReactNode;
  analysis: ReviewAnalysis;
  document?: Extraction;
  activeEvidence?: Evidence;
  activeField?: InspectedField;
  activeRole: keyof typeof roleDetails;
  hasConsigneeOptions: boolean;
  onInspect: (evidence?: Evidence, meta?: InspectedField) => void;
  editable: boolean;
  viewedField: (target: ReviewField, field: ExtractedField) => ExtractedField;
  isReviewed: (target: ReviewField) => boolean;
  editor?: FieldEditor;
  onDismissField?: () => void;
  tabDocuments?: TabDocumentItem[];
  currentDocumentId?: string;
  onSelectDocument?: (documentId: string) => void;
}) {
  const descriptionId = useId();
  const candidates = analysis.candidates.filter((candidate) => candidate.invoice_document_id === document?.document_id);
  const cdcIssue = analysis.findings.find((finding) =>
    ["cdc.company", "cdc.version"].includes(finding.key) && finding.outcome !== "PASS");
  const isTransport = activeRole === "draft_bl" || document?.role === "draft_bl" || document?.role === "final_bl";
  const details = (document?.role ? roleDetails[document.role as keyof typeof roleDetails] : undefined)
    ?? roleDetails[activeRole as keyof typeof roleDetails]
    ?? { name: "Bill of Lading", icon: Anchor };
  const DocumentIcon = details.icon;
  const fields = document?.fields ?? {};
  const extraKeys = Object.keys(fields).filter((key) => !knownFields.has(key)).sort();
  const required = activeRole === "invoice" ? ["invoice_no", "supplier", "consignee"]
    : activeRole === "packing_list" && hasConsigneeOptions ? ["consignee"] : [];
  const currentGroups = groups.map((group, index) => ({
    ...group, keys: (index === 0 ? [...group.keys, ...extraKeys] : group.keys).filter((key) => fields[key]?.value || (editable && fields[key] && required.includes(key))),
  })).filter(({ keys }) => keys.length);

  function active(id: string, evidence?: Evidence) {
    if (activeField?.id) return activeField.id === id;
    return !!activeEvidence && !!evidence && sourceKey(evidence) === sourceKey(activeEvidence);
  }

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b border-border/60">
        {tabDocuments && tabDocuments.length > 1 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {tabDocuments.map((doc) => {
              const isSelected = doc.id === (currentDocumentId ?? document?.document_id);
              const isFinal = doc.classification === "final_bl";
              const isSuperseded = doc.is_superseded;
              const ref = doc.reference;
              const Icon = isFinal || isTransport ? Anchor : FileText;
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onSelectDocument?.(doc.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-all font-medium border cursor-pointer select-none",
                    isSelected
                      ? isFinal
                        ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                        : "bg-primary text-primary-foreground border-primary shadow-xs"
                      : "bg-background text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground"
                  )}
                  title={doc.name}
                >
                  <Icon size={12} className={cn(isSelected ? "text-current" : "text-muted-foreground")} />
                  <span>
                    {isFinal ? "Final B/L" : `Draft B/L v${doc.version_number ?? 1}`}
                  </span>
                  {ref && (
                    <span className={cn("font-mono text-[11px]", isSelected ? "font-semibold opacity-95" : "text-muted-foreground")}>
                      · {ref}
                    </span>
                  )}
                  {isFinal && !isSelected && (
                    <span className="rounded bg-purple-100 px-1 py-0.2 text-[9px] font-bold text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                      FINAL
                    </span>
                  )}
                  {isSuperseded && !isSelected && (
                    <span className="text-[10px] text-muted-foreground opacity-80">
                      (v{doc.version_number ?? 1})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="min-w-0 flex items-center gap-2">
            <DocumentIcon size={15} className="text-primary shrink-0" aria-hidden />
            <span className="font-semibold text-xs truncate text-foreground">
              {details.name} · {invoiceReference(fields[isTransport ? "bl_no" : "invoice_no"]?.value) ?? intakeReference ?? "Reference pending"}
            </span>
          </div>
        )}
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {item.documents.length} source file{item.documents.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="px-3.5 py-2.5 space-y-4 flex-1">
        {!currentGroups.length && !document?.items.length &&
          <p className="py-2 text-xs text-muted-foreground">{document ? "No fields were extracted from this document." : "No extracted document for this tab."}</p>}
        {currentGroups.map(({ title, icon: Icon, keys }) => <section key={title} aria-label={title} className="space-y-1">
          <h3 className="flex items-center gap-1.5 px-0.5 pt-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Icon size={12} className="text-primary shrink-0" aria-hidden /> {title}
          </h3>
          <div className="divide-y divide-border/60 border-y border-border/60">
            {keys.map((key) => {
              const field = fields[key];
              const target: ReviewField = { document_id: document!.document_id, role: (document?.role === "final_bl" ? "final_bl" : activeRole) as any, row: null, name: key };
              const reviewed = isReviewed(target);
              const visibleField = viewedField(target, field);
              const text = intakeField(visibleField);
              const evidence = text.evidence;
              const id = `field:${key}`;
              const selected = active(id, evidence);
              const name = documentFieldLabel(key);
              const value = key === "invoice_no" && !invoiceReference(visibleField.value) ? "Needs verification" : text.value;
              const citations = [...field.evidence, ...(field.english?.evidence ?? [])];
              const findings = analysis.findings.filter((finding) => finding.field === key && finding.evidence.some((entry) =>
                citations.some((citation) => sourceKey(entry) === sourceKey(citation))));
              const mismatch = findings.find((finding) => finding.outcome === "MISMATCH");
              const warning = findings.find((finding) => finding.outcome === "WARNING" || finding.outcome === "NEEDS_REVIEW");
              const status = reviewed ? "present" : mismatch ? "problem" : intakeStatus(field, !!warning || (key === "invoice_no" && !invoiceReference(field.value)));
              const reason = reviewed ? "Reviewed" : mismatch?.explanation ?? warning?.explanation ?? field.english?.reason ?? statuses[status].label;
              const interactive = !!evidence || editable;
              const isFieldEditorOpen = selected && editor && activeField?.target?.name === key && !activeField?.target?.row;

              return (
                <div
                  key={key}
                  className={cn(
                    "transition-colors",
                    selected && "bg-primary/5 dark:bg-primary/10 border-l-2 border-primary"
                  )}
                >
                  <div
                    role={interactive ? "button" : undefined}
                    data-field-key={key}
                    data-connector-source={selected ? "true" : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    aria-pressed={interactive ? selected : undefined}
                    aria-describedby={`${descriptionId}-${id}`}
                    title={evidence ? `${reason} · ${location(evidence)}` : reason}
                    onClick={interactive ? () => onInspect(evidence, { id, name, value, target, uncertain: status === "review" || status === "problem" }) : undefined}
                    onKeyDown={interactive ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onInspect(evidence, { id, name, value, target, uncertain: status === "review" || status === "problem" });
                      }
                    } : undefined}
                    className={cn(
                      "grid w-full grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)] items-center gap-2 px-2 py-2 text-left text-xs transition-colors outline-none",
                      interactive && "cursor-pointer hover:bg-muted/40",
                      status === "problem" && !selected && "bg-danger-fill/40"
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <IntakeStatusDot status={status} />
                      <span>{name}</span>
                    </span>
                    <span className={cn("min-w-0 break-words whitespace-normal text-right font-mono text-[11px]", selected && "font-bold text-primary")}>
                      {value}
                    </span>
                    <span hidden id={`${descriptionId}-${id}`}>{reason}</span>
                  </div>

                  {isFieldEditorOpen && (
                    <InlineReviewDrawer
                      key={`${name}:${editor.value}`}
                      editor={editor}
                      name={name}
                      status={status}
                      isUncertain={field.status === "uncertain"}
                      currentValue={value}
                      onDismiss={onDismissField}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>)}
        {document && document.items.length > 0 && <GoodsItems key={`${document.document_id}:${document.role}:${document.sheet}`}
          document={document} active={active} inspect={onInspect} names={cdcNames} candidates={candidates}
          editable={editable} viewedField={viewedField} isReviewed={isReviewed}
          editor={editor} activeField={activeField} onDismissField={onDismissField} />}

        {/* CDC Quota Summary Section (on Invoice tab) */}
        {activeRole === "invoice" && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 px-0.5 pt-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <ShieldCheck size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>CDC Master List Quota</span>
            </div>

            <div className="space-y-1 border-y border-border/60 px-2 py-2 text-xs text-muted-foreground">
              {analysis.analyzed_master && <p>{analysis.analyzed_master.year} · {analysis.analyzed_master.approval_ref}</p>}
              {analysis.comparison_master && <p>Comparison only · {analysis.comparison_master.approval_ref}</p>}
              {!candidates.length && <p>{cdcIssue ? "CDC match pending" : "No CDC matches"}</p>}
              {cdcControls}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
