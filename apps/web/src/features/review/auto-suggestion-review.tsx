"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Check, CheckCircle2, FileText, RotateCcw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reviewDraft, reviewKey, type ReviewDraft } from "@/features/review/staff-review";
import type {
  Evidence,
  FieldSuggestion,
  Finding,
  FindingDecision,
  ReviewAnalysis,
  ReviewCorrection,
  ReviewField,
  ReviewWorkflow,
  StaffReview,
} from "@/lib/contracts";
import { documentFieldLabel, location, sourceValue, timestamp } from "@/lib/format";

type DocSection = {
  role: "invoice" | "packing_list" | "draft_bl";
  label: string;
};

const secLabels: Record<string, string> = {
  invoice: "Commercial Invoice",
  packing_list: "Packing List",
  draft_bl: "Draft B/L",
};

function getDocValue(
  role: "invoice" | "packing_list" | "draft_bl",
  finding: Finding,
  analysis: ReviewAnalysis,
  offer?: FieldSuggestion
): {
  value: string | null;
  locationText: string | null;
  cite: Evidence | null;
  sourceField: ReviewField | null;
} {
  // 1. Check if offer provides an option for this document role
  const option = offer?.options.find((opt) => opt.source.role === role);
  if (option && option.field?.value) {
    const cite = option.field.evidence?.[0] ?? null;
    return {
      value: sourceValue(option.field),
      locationText: cite ? location(cite) : null,
      cite,
      sourceField: option.source,
    };
  }

  // 2. Check the document extraction directly for this field
  const doc = analysis.extractions.find((e) => e.role === role);
  if (doc && doc.fields[finding.field]) {
    const field = doc.fields[finding.field];
    if (field && field.value) {
      const cite = field.evidence?.[0] ?? null;
      return {
        value: sourceValue(field),
        locationText: cite ? location(cite) : null,
        cite,
        sourceField: {
          document_id: doc.document_id,
          role,
          row: null,
          name: finding.field,
        },
      };
    }
  }

  // 3. Check finding left/right comparison based on group
  if (finding.group === "invoice_packing") {
    if (role === "invoice" && finding.left) {
      const cite = finding.evidence.find((e) => {
        const d = analysis.extractions.find((ext) => ext.document_id === e.document_id);
        return d?.role === "invoice";
      });
      const d = analysis.extractions.find((ext) => ext.role === "invoice");
      return {
        value: finding.left,
        locationText: cite ? location(cite) : null,
        cite: cite ?? null,
        sourceField: d ? { document_id: d.document_id, role: "invoice", row: null, name: finding.field } : null,
      };
    }
    if (role === "packing_list" && finding.right) {
      const cite = finding.evidence.find((e) => {
        const d = analysis.extractions.find((ext) => ext.document_id === e.document_id);
        return d?.role === "packing_list";
      });
      const d = analysis.extractions.find((ext) => ext.role === "packing_list");
      return {
        value: finding.right,
        locationText: cite ? location(cite) : null,
        cite: cite ?? null,
        sourceField: d ? { document_id: d.document_id, role: "packing_list", row: null, name: finding.field } : null,
      };
    }
  }

  if (finding.group === "transport") {
    const isPL = finding.key.endsWith(".packing_list");
    if (isPL && role === "packing_list" && finding.left) {
      const cite = finding.evidence.find((e) => {
        const d = analysis.extractions.find((ext) => ext.document_id === e.document_id);
        return d?.role === "packing_list";
      });
      const d = analysis.extractions.find((ext) => ext.role === "packing_list");
      return {
        value: finding.left,
        locationText: cite ? location(cite) : null,
        cite: cite ?? null,
        sourceField: d ? { document_id: d.document_id, role: "packing_list", row: null, name: finding.field } : null,
      };
    }
    if (!isPL && role === "invoice" && finding.left) {
      const cite = finding.evidence.find((e) => {
        const d = analysis.extractions.find((ext) => ext.document_id === e.document_id);
        return d?.role === "invoice";
      });
      const d = analysis.extractions.find((ext) => ext.role === "invoice");
      return {
        value: finding.left,
        locationText: cite ? location(cite) : null,
        cite: cite ?? null,
        sourceField: d ? { document_id: d.document_id, role: "invoice", row: null, name: finding.field } : null,
      };
    }
    if (role === "draft_bl" && finding.right) {
      const cite = finding.evidence.find((e) => {
        const d = analysis.extractions.find((ext) => ext.document_id === e.document_id);
        return d?.role === "draft_bl";
      });
      const d = analysis.extractions.find((ext) => ext.role === "draft_bl" || ext.role === "final_bl");
      return {
        value: finding.right,
        locationText: cite ? location(cite) : null,
        cite: cite ?? null,
        sourceField: d ? { document_id: d.document_id, role: "draft_bl", row: null, name: finding.field } : null,
      };
    }
  }

  // Fallback for draft scan checks on draft_bl
  if (role === "draft_bl" && finding.group === "validation" && finding.evidence.length > 0) {
    const cite = finding.evidence[0];
    const d = analysis.extractions.find((ext) => ext.role === "draft_bl" || ext.role === "final_bl");
    return {
      value: null,
      locationText: location(cite),
      cite,
      sourceField: d ? { document_id: d.document_id, role: "draft_bl", row: null, name: finding.field } : null,
    };
  }

  return { value: null, locationText: null, cite: null, sourceField: null };
}

function FindingTableRow({
  index,
  finding,
  offer,
  current,
  targetCorrection,
  docSections,
  analysis,
  busy,
  enabled,
  onSelectSource,
  onUndo,
  onInspect,
}: {
  index: number;
  finding: Finding;
  offer?: FieldSuggestion;
  current?: FindingDecision;
  targetCorrection?: ReviewCorrection;
  docSections: DocSection[];
  analysis: ReviewAnalysis;
  busy: boolean;
  enabled: boolean;
  onSelectSource: (role: "invoice" | "packing_list" | "draft_bl", value: string, source: ReviewField | null) => Promise<void>;
  onUndo: () => Promise<void>;
  onInspect: (cite: Evidence) => void;
}) {
  const [acting, setActing] = useState(false);

  const isResolved = Boolean(
    (current && current.action === "approved") ||
    targetCorrection
  );

  const resolvedSourceRole = current?.source?.role ?? targetCorrection?.suggestion_source?.role;

  const outcomeVariant = finding.outcome === "MISMATCH"
    ? "destructive"
    : "warning";

  return (
    <TableRow
      role="article"
      aria-label={`${documentFieldLabel(finding.field)} finding`}
      className={`text-xs transition-colors border-b border-border/50 ${
        isResolved ? "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.06]" : "hover:bg-muted/15"
      }`}
    >
      {/* Col 1: # Index */}
      <TableCell className="align-top font-mono text-[10px] text-muted-foreground text-center px-2 py-2.5">
        {index + 1}
      </TableCell>

      {/* Col 2: Field & Status */}
      <TableCell className="align-top font-medium max-w-[220px] px-3 py-2.5 border-r border-border/60">
        <div className="flex items-center justify-between gap-1">
          <span className="font-semibold text-foreground text-xs block truncate" title={documentFieldLabel(finding.field)}>
            {documentFieldLabel(finding.field)}
          </span>
          {isResolved && (
            <Badge variant="success" className="h-4 text-[9px] px-1 font-sans shrink-0 gap-0.5">
              <CheckCircle2 className="size-2.5" /> Resolved
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <Badge variant={outcomeVariant} className="text-[9px] font-mono h-4 px-1.5">
            {finding.outcome.replaceAll("_", " ")}
          </Badge>
          {resolvedSourceRole && (
            <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium font-sans">
              via {secLabels[resolvedSourceRole] ?? resolvedSourceRole}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1 leading-snug line-clamp-2" title={finding.explanation}>
          {finding.explanation}
        </p>
      </TableCell>

      {/* Columns 3+: Document Sections (Commercial Invoice, Packing List, Draft B/L) */}
      {docSections.map((sec, secIdx) => {
        const docData = getDocValue(sec.role, finding, analysis, offer);
        const isSelected = Boolean(
          (current?.action === "approved" && current?.source?.role === sec.role) ||
          (targetCorrection && docData.value && targetCorrection.value === docData.value)
        );

        return (
          <TableCell
            key={sec.role}
            className={`align-top min-w-[170px] max-w-[240px] px-3 py-2.5 ${
              secIdx < docSections.length - 1 ? "border-r border-border/60" : ""
            } ${isSelected ? "bg-emerald-500/[0.08]" : ""}`}
          >
            {docData.value ? (
              <div className="space-y-1 font-mono text-xs group">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-semibold text-foreground break-words" title={docData.value}>
                    {docData.value}
                  </span>
                  {isSelected ? (
                    <Badge variant="success" className="h-4 text-[9px] px-1.5 font-sans shrink-0 gap-0.5 font-medium">
                      <Check className="size-2.5" /> Selected
                    </Badge>
                  ) : enabled ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={busy || acting}
                      onClick={async () => {
                        setActing(true);
                        try {
                          await onSelectSource(sec.role, docData.value!, docData.sourceField);
                        } finally {
                          setActing(false);
                        }
                      }}
                      className="opacity-70 group-hover:opacity-100 focus:opacity-100 transition-opacity h-5 text-[10px] px-1.5 py-0 text-primary hover:text-primary hover:bg-primary/10 font-sans cursor-pointer"
                      title={`Use ${sec.label} value (${docData.value})`}
                      aria-label={`Use ${sec.label} value for ${documentFieldLabel(finding.field)}`}
                    >
                      <Check className="size-2.5 mr-0.5" /> Use this
                    </Button>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-1">
                  {docData.cite ? (
                    <button
                      type="button"
                      onClick={() => onInspect(docData.cite!)}
                      className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline cursor-pointer"
                      title={`Inspect on ${sec.label}: ${docData.locationText}`}
                    >
                      <FileText className="size-2.5 text-muted-foreground shrink-0" aria-hidden />
                      <span>{docData.locationText}</span>
                    </button>
                  ) : <span />}
                  {isSelected && (
                    <button
                      type="button"
                      disabled={busy || acting}
                      onClick={async () => {
                        setActing(true);
                        try {
                          await onUndo();
                        } finally {
                          setActing(false);
                        }
                      }}
                      className="text-[10px] text-muted-foreground hover:text-destructive transition-colors font-sans cursor-pointer inline-flex items-center gap-0.5"
                      title="Reset selection"
                    >
                      <RotateCcw className="size-2" /> Reset
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <span className="text-muted-foreground italic font-sans text-[11px]">
                  Missing
                </span>
                {docData.cite && (
                  <div>
                    <button
                      type="button"
                      onClick={() => onInspect(docData.cite!)}
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-primary hover:underline cursor-pointer"
                    >
                      <FileText className="size-2.5 text-muted-foreground shrink-0" aria-hidden />
                      <span>{docData.locationText}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

function CdcTableRow({
  index,
  row,
  description,
  quantity,
  price,
  candidates,
  findings,
  current,
  busy,
  onSelectCandidate,
  onInspect,
}: {
  index: number;
  row: number;
  description: string;
  quantity: string;
  price: string;
  candidates: ReviewAnalysis["candidates"];
  findings: Finding[];
  current?: FindingDecision;
  busy: boolean;
  onSelectCandidate: (row: number, masterRowStr: string) => Promise<void>;
  onInspect: (cite: Evidence) => void;
}) {
  const [choice, setChoice] = useState(current?.master_row ? String(current.master_row) : "");
  const [acting, setActing] = useState(false);

  const candidate = candidates.find((entry) => String(entry.master_row) === choice);
  const isMapped = current?.action === "approved" && current.master_row;

  async function handleCandidateChange(val: string) {
    setChoice(val);
    setActing(true);
    try {
      await onSelectCandidate(row, val);
    } finally {
      setActing(false);
    }
  }

  return (
    <TableRow
      role="article"
      aria-label={`CDC invoice row ${row}`}
      className={`text-xs transition-colors border-b border-border/50 ${
        isMapped ? "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.06]" : "hover:bg-muted/15"
      }`}
    >
      {/* Col 1: # Index */}
      <TableCell className="align-top font-mono text-[10px] text-muted-foreground text-center px-2 py-2.5">
        {index + 1}
      </TableCell>

      {/* Col 2: Invoice Row & Description */}
      <TableCell className="align-top font-medium max-w-[220px] px-3 py-2.5 border-r border-border/60">
        <div className="flex items-center justify-between gap-1">
          <span className="font-semibold text-foreground text-xs block">
            Row {row} · {description}
          </span>
          {isMapped && (
            <Badge variant="success" className="h-4 text-[9px] px-1 font-sans shrink-0 gap-0.5">
              <Check className="size-2.5" /> Mapped
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
          Qty: <strong className="text-foreground">{quantity}</strong> · Price: <strong className="text-foreground">{price}</strong>
        </p>
      </TableCell>

      {/* Col 3: CDC Candidate Selection */}
      <TableCell className="align-top min-w-[260px] px-3 py-2.5 border-r border-border/60">
        <label className="grid gap-1">
          <span className="text-[10px] font-semibold text-muted-foreground">CDC material candidate</span>
          <NativeSelect
            value={choice}
            disabled={busy || acting}
            onChange={(event) => void handleCandidateChange(event.target.value)}
            className="h-7 text-xs bg-background w-full"
          >
            <option value="">{candidates.length ? "Choose candidate to map..." : "No candidate found"}</option>
            {candidates.map((entry) => (
              <option key={entry.master_row} value={entry.master_row}>
                {entry.serial ?? `Row ${entry.master_row}`} · {entry.description} ({entry.score.toFixed(0)}%)
              </option>
            ))}
          </NativeSelect>
        </label>

        {candidate && (
          <div className="mt-1.5 space-y-0.5 text-[10px] text-muted-foreground bg-muted/40 p-1.5 rounded">
            <div>Unit: <strong className="text-foreground font-mono">{candidate.unit ?? "—"}</strong> · Bal: <strong className="text-foreground font-mono">{candidate.remaining_quantity ?? "—"}</strong></div>
            <div>Price: <strong className="text-foreground font-mono">{candidate.unit_price ?? "—"} {candidate.currency ?? ""}</strong></div>
          </div>
        )}
      </TableCell>

      {/* Col 4: Evidence & Checks */}
      <TableCell className="align-top min-w-[200px] px-3 py-2.5">
        {candidate ? (
          <div>
            <button
              className="inline-flex items-center gap-1 text-[11px] font-mono text-primary hover:underline cursor-pointer"
              type="button"
              onClick={() => onInspect(candidate.evidence)}
            >
              <FileText className="size-3 text-muted-foreground shrink-0" aria-hidden />
              <span>CDC evidence · {location(candidate.evidence)}</span>
            </button>
            {candidate.checks?.map((check) => (
              <div
                key={check.key}
                className={check.outcome === "PASS" ? "text-emerald-700 dark:text-emerald-400 text-[10px]" : "text-amber-700 dark:text-amber-400 text-[10px] font-medium"}
              >
                {documentFieldLabel(check.field)}: {check.outcome}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground italic">No candidate selected</span>
        )}

        {findings.length > 0 && (
          <div className="mt-1 space-y-0.5 text-[10px]">
            {findings.map((f) => (
              <div key={f.key} className={f.outcome === "PASS" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                {documentFieldLabel(f.field)}: {f.outcome.replaceAll("_", " ")}
              </div>
            ))}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

export function AutoSuggestionReview({
  analysis,
  workflow,
  saved,
  busy,
  enabled,
  onSave,
  onInspect,
}: {
  analysis: ReviewAnalysis;
  workflow: ReviewWorkflow;
  saved: StaffReview | null;
  busy: boolean;
  enabled: boolean;
  onSave: (draft: ReviewDraft) => Promise<StaffReview>;
  onInspect: (cite: Evidence) => void;
}) {
  const [tab, setTab] = useState<"fields" | "cdc">("fields");
  const [filter, setFilter] = useState<"all" | "pending" | "resolved">("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const decisions = useMemo(() => saved?.finding_decisions ?? [], [saved?.finding_decisions]);
  const findings = saved?.findings ?? analysis.findings.filter((entry) => entry.group !== "cdc");
  const documents = findings.filter((entry) => entry.group !== "cdc" && entry.outcome !== "PASS");
  const invoice = analysis.extractions.find((entry) => entry.role === "invoice");
  const cdcFindings = saved?.cdc_findings ?? analysis.findings.filter((entry) => entry.group === "cdc");
  const candidates = saved?.candidates ?? analysis.candidates;
  const stale = analysis.state !== "available" || analysis.analysis_revision !== analysis.revision;
  const disabled = busy || stale;

  // Determine active document sections (e.g. Invoice, Packing List, Draft B/L)
  const docSections = useMemo((): DocSection[] => {
    const list: DocSection[] = [];
    if (analysis.extractions.some((e) => e.role === "invoice")) {
      list.push({ role: "invoice", label: "Commercial Invoice" });
    }
    if (analysis.extractions.some((e) => e.role === "packing_list")) {
      list.push({ role: "packing_list", label: "Packing List" });
    }
    if (analysis.extractions.some((e) => e.role === "draft_bl" || e.role === "final_bl")) {
      list.push({ role: "draft_bl", label: "Draft B/L" });
    }
    return list;
  }, [analysis.extractions]);

  // Check if a finding is resolved
  const isFindingResolved = (f: Finding) => {
    const dec = decisions.find((d) => d.key === f.key);
    if (dec && dec.action === "approved") return true;
    const offer = workflow.field_suggestions?.find((entry) => entry.key === f.key);
    if (offer?.target) {
      const hasCorrection = saved?.corrections.some((c) => reviewKey(c) === reviewKey(offer.target!));
      if (hasCorrection) return true;
    }
    return false;
  };

  const resolvedCount = useMemo(() => {
    return documents.filter((f) => isFindingResolved(f)).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, decisions, saved?.corrections]);

  const mappedCdcCount = useMemo(() => {
    return (invoice?.items ?? []).filter((item) =>
      decisions.some((d) => d.key === `cdc.row.${item.row}.mapping` && d.action === "approved" && d.master_row)
    ).length;
  }, [invoice?.items, decisions]);

  const filteredDocuments = useMemo(() => {
    return documents.filter((item) => {
      const isResolved = isFindingResolved(item);
      if (filter === "pending" && isResolved) return false;
      if (filter === "resolved" && !isResolved) return false;
      if (search.trim()) {
        const query = search.toLowerCase();
        const name = documentFieldLabel(item.field).toLowerCase();
        const expl = item.explanation.toLowerCase();
        return name.includes(query) || expl.includes(query);
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, decisions, saved?.corrections, filter, search]);

  const passed = analysis.findings.filter((entry) => entry.group !== "cdc" && entry.outcome === "PASS");

  // Workflow Action: Select source value directly
  async function selectSource(finding: Finding, role: "invoice" | "packing_list" | "draft_bl", value: string, source: ReviewField | null) {
    setError("");
    try {
      const offer = workflow.field_suggestions?.find((entry) => entry.key === finding.key);
      const opt = offer?.options.find((o) => o.source.role === role);
      const target = offer?.target;
      const optField = opt?.field;

      const draft = reviewDraft(saved);
      const decision: FindingDecision = {
        key: finding.key,
        action: "approved",
        note: `Selected ${secLabels[role] ?? role} value (${value})`,
        source: source ?? opt?.source ?? null,
      };

      const nextDecisions = [
        ...decisions.filter((entry) => entry.key !== finding.key),
        decision,
      ];

      let nextCorrections = draft.corrections;
      if (target) {
        const correction: ReviewCorrection = {
          ...target,
          value,
          unit: optField?.unit ?? null,
          currency: optField?.currency ?? null,
          note: `Selected from ${secLabels[role] ?? role} evidence`,
          confirmed: true,
        };
        nextCorrections = [
          ...draft.corrections.filter((c) => reviewKey(c) !== reviewKey(target)),
          correction,
        ];
      }

      await onSave({
        ...draft,
        finding_decisions: nextDecisions,
        corrections: nextCorrections,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save selection.");
    }
  }

  // Workflow Action: Undo/Reset decision for finding
  async function undoFinding(finding: Finding) {
    setError("");
    try {
      const offer = workflow.field_suggestions?.find((entry) => entry.key === finding.key);
      const target = offer?.target;
      const draft = reviewDraft(saved);
      await onSave({
        ...draft,
        finding_decisions: decisions.filter((entry) => entry.key !== finding.key),
        corrections: target
          ? draft.corrections.filter((c) => reviewKey(c) !== reviewKey(target))
          : draft.corrections,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to reset finding.");
    }
  }

  // Workflow Action: Map CDC Candidate
  async function selectCdcCandidate(row: number, masterRowStr: string) {
    setError("");
    try {
      const draft = reviewDraft(saved);
      if (!masterRowStr) {
        await onSave({
          ...draft,
          mappings: draft.mappings.filter((m) => m.invoice_row !== row),
          verify_cdc_mappings: draft.mappings.filter((m) => m.invoice_row !== row).length > 0,
          finding_decisions: [
            ...decisions.filter((entry) => entry.key !== `cdc.row.${row}.mapping`),
            {
              key: `cdc.row.${row}.mapping`,
              action: "unresolved",
              note: "Unmapped CDC item",
              master_row: null,
            },
          ],
        });
        return;
      }

      const masterRow = Number(masterRowStr);
      const candidate = candidates.find((entry) => entry.master_row === masterRow);
      await onSave({
        ...draft,
        mappings: [
          ...draft.mappings.filter((m) => m.invoice_row !== row),
          { invoice_row: row, master_row: masterRow },
        ],
        verify_cdc_mappings: true,
        finding_decisions: [
          ...decisions.filter((entry) => entry.key !== `cdc.row.${row}.mapping`),
          {
            key: `cdc.row.${row}.mapping`,
            action: "approved",
            note: `Mapped to CDC row ${masterRow}${candidate?.description ? ` (${candidate.description})` : ""}`,
            master_row: masterRow,
          },
        ],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to map CDC item.");
    }
  }

  return (
    <div className="space-y-3">
      {stale && (
        <div role="alert" className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span>Documents changed. Wait for current analysis before reviewing.</span>
        </div>
      )}

      {/* Top Header: Tabs & Instant Filter */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <div role="tablist" aria-label="Review sections" className="flex items-center gap-2">
          <Button
            role="tab"
            aria-selected={tab === "fields"}
            variant={tab === "fields" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("fields")}
            className="h-8 text-xs font-semibold gap-1.5 cursor-pointer"
          >
            Document Fields ({documents.length})
            {resolvedCount > 0 && (
              <Badge variant={tab === "fields" ? "secondary" : "default"} className="h-4 text-[9px] px-1 font-mono">
                {resolvedCount}/{documents.length}
              </Badge>
            )}
          </Button>
          <Button
            role="tab"
            aria-selected={tab === "cdc"}
            variant={tab === "cdc" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("cdc")}
            className="h-8 text-xs font-semibold gap-1.5 cursor-pointer"
          >
            CDC Items ({invoice?.items.length ?? 0})
            {mappedCdcCount > 0 && (
              <Badge variant={tab === "cdc" ? "secondary" : "default"} className="h-4 text-[9px] px-1 font-mono">
                {mappedCdcCount}/{invoice?.items.length ?? 0}
              </Badge>
            )}
          </Button>
        </div>

        {tab === "fields" && documents.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded border bg-muted/40 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`px-2 py-0.5 rounded font-medium cursor-pointer ${filter === "all" ? "bg-background shadow-2xs text-foreground" : "text-muted-foreground"}`}
              >
                All ({documents.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("pending")}
                className={`px-2 py-0.5 rounded font-medium cursor-pointer ${filter === "pending" ? "bg-background shadow-2xs text-foreground" : "text-muted-foreground"}`}
              >
                Needs Action ({documents.length - resolvedCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter("resolved")}
                className={`px-2 py-0.5 rounded font-medium cursor-pointer ${filter === "resolved" ? "bg-background shadow-2xs text-foreground" : "text-muted-foreground"}`}
              >
                Resolved ({resolvedCount})
              </button>
            </div>

            <div className="relative w-36 sm:w-44">
              <Search className="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search fields..."
                className="h-7 pl-6 text-xs bg-background"
              />
            </div>
          </div>
        )}
      </div>

      {tab === "fields" ? (
        <div role="tabpanel" aria-label="Document Fields" className="space-y-3">
          {/* Main Table: No Decision Column */}
          <div className="rounded border bg-card overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50 border-b border-border/80">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 text-center text-[10px] font-semibold uppercase text-muted-foreground px-2 py-2 select-none">
                    #
                  </TableHead>
                  <TableHead className="w-56 text-left text-[10px] font-semibold uppercase text-muted-foreground px-3 py-2 border-r border-border/60 select-none">
                    Field &amp; Status
                  </TableHead>
                  {docSections.map((sec, idx) => (
                    <TableHead
                      key={sec.role}
                      className={`text-left text-[10px] font-semibold uppercase text-muted-foreground px-3 py-2 select-none ${
                        idx < docSections.length - 1 ? "border-r border-border/60" : ""
                      }`}
                    >
                      <span>{sec.label}</span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((finding, idx) => {
                  const offer = workflow.field_suggestions?.find((entry) => entry.key === finding.key);
                  const targetCorrection = offer?.target
                    ? saved?.corrections.find((c) => reviewKey(c) === reviewKey(offer.target!))
                    : undefined;

                  return (
                    <FindingTableRow
                      key={`${finding.key}:${saved?.id ?? "new"}`}
                      index={idx}
                      finding={finding}
                      offer={offer}
                      current={decisions.find((entry) => entry.key === finding.key)}
                      targetCorrection={targetCorrection}
                      docSections={docSections}
                      analysis={analysis}
                      busy={disabled}
                      enabled={enabled}
                      onSelectSource={(role, val, src) => selectSource(finding, role, val, src)}
                      onUndo={() => undoFinding(finding)}
                      onInspect={onInspect}
                    />
                  );
                })}

                {!filteredDocuments.length && (
                  <TableRow>
                    <TableCell colSpan={docSections.length + 2} className="text-center py-6 text-muted-foreground text-xs">
                      {documents.length === 0
                        ? "Document comparisons pass. Staff confirmation is still required."
                        : "No checks match the current search or filter."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>

              {/* Table Footer with Summary */}
              <TableFooter className="border-t border-border/80 bg-muted/20 text-xs font-semibold">
                <TableRow className="hover:bg-transparent">
                  <TableCell className="px-2 py-2 font-mono text-center text-muted-foreground">
                    Σ
                  </TableCell>
                  <TableCell className="px-3 py-2 font-mono text-[11px] font-semibold text-muted-foreground uppercase border-r border-border/60">
                    Summary
                  </TableCell>
                  <TableCell
                    colSpan={Math.max(1, docSections.length - 1)}
                    className="px-3 py-2 text-[11px] text-muted-foreground font-medium"
                  >
                    {documents.length} discrepancy checks · {resolvedCount} resolved · {documents.length - resolvedCount} pending
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={disabled || !passed.length}
                      onClick={async () => {
                        setError("");
                        try {
                          await onSave({
                            ...reviewDraft(saved),
                            finding_decisions: [
                              ...decisions.filter((entry) => !passed.some((check) => check.key === entry.key)),
                              ...passed.map((entry): FindingDecision => ({
                                key: entry.key,
                                action: "approved",
                                note: "Confirmed passing comparisons against the cited documents.",
                              })),
                            ],
                          });
                        } catch (cause) {
                          setError(cause instanceof Error ? cause.message : "Could not confirm passing checks.");
                        }
                      }}
                      className="text-xs font-semibold"
                    >
                      Confirm all passing document checks
                    </Button>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {documents.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Click &ldquo;Use this&rdquo; on any document column to quickly resolve discrepancies, or inspect cited locations.
            </p>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="CDC Items" className="space-y-3">
          <div className="rounded border bg-muted/20 px-3 py-2 text-xs">
            <p className="font-semibold text-foreground">
              {analysis.analyzed_master
                ? `${analysis.analyzed_master.company} · ${analysis.analyzed_master.approval_ref} (${analysis.analyzed_master.year})`
                : "Select applicable company Master List in the CDC section."}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Material identity approval does not clear shortages or price differences. Suggestions do not deduct stock.
            </p>
          </div>

          {saved && (
            <p role="status" className={saved.cdc_ready ? "text-emerald-700 dark:text-emerald-400 font-medium text-xs flex items-center gap-1.5" : "text-amber-700 dark:text-amber-400 font-medium text-xs flex items-center gap-1.5"}>
              {saved.cdc_ready ? (
                <>
                  <CheckCircle2 className="size-3.5" aria-hidden />
                  <span>CDC checks complete</span>
                </>
              ) : (
                <>
                  <AlertCircle className="size-3.5" aria-hidden />
                  <span>CDC checks remain unresolved</span>
                </>
              )}
            </p>
          )}

          {/* CDC Table: No Decision Column */}
          <div className="rounded border bg-card overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50 border-b border-border/80">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 text-center text-[10px] font-semibold uppercase text-muted-foreground px-2 py-2 select-none">
                    #
                  </TableHead>
                  <TableHead className="w-56 text-left text-[10px] font-semibold uppercase text-muted-foreground px-3 py-2 border-r border-border/60 select-none">
                    Invoice Item
                  </TableHead>
                  <TableHead className="min-w-[260px] text-left text-[10px] font-semibold uppercase text-muted-foreground px-3 py-2 border-r border-border/60 select-none">
                    CDC Candidate
                  </TableHead>
                  <TableHead className="text-left text-[10px] font-semibold uppercase text-muted-foreground px-3 py-2 select-none">
                    Evidence &amp; Checks
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice?.items.map((item, idx) => (
                  <CdcTableRow
                    key={`${invoice.document_id}:${item.row}:${saved?.id ?? "new"}`}
                    index={idx}
                    row={item.row}
                    description={sourceValue(item.fields.description)}
                    quantity={sourceValue(item.fields.quantity)}
                    price={sourceValue(item.fields.unit_price)}
                    candidates={enabled ? candidates.filter((entry) => entry.invoice_document_id === invoice.document_id && entry.invoice_row === item.row) : []}
                    findings={cdcFindings.filter((entry) => entry.key.startsWith(`cdc.row.${item.row}.`) || entry.key === `cdc.unit.${item.row}` || entry.key === `cdc.unit_price.${item.row}`)}
                    current={decisions.find((entry) => entry.key === `cdc.row.${item.row}.mapping`)}
                    busy={disabled}
                    onSelectCandidate={selectCdcCandidate}
                    onInspect={onInspect}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          {cdcFindings.filter((entry) => entry.key.startsWith("cdc.quota.") || ["company", "version", "year"].includes(entry.field)).map((finding) => (
            <p key={finding.key} className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              {documentFieldLabel(finding.field)} · {finding.outcome.replaceAll("_", " ")} · {finding.explanation}
              {finding.left && ` (${finding.left} / ${finding.right ?? "unknown"})`}
            </p>
          ))}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-destructive font-medium">{error}</p>}

      {!!workflow.finding_audit?.length && (
        <details className="text-xs rounded border bg-muted/20 p-2">
          <summary className="cursor-pointer font-medium text-[11px] text-primary hover:underline">
            Finding decision history ({workflow.finding_audit.length})
          </summary>
          <ul className="space-y-1 pt-1.5 border-t mt-1.5 text-[11px]">
            {workflow.finding_audit.map((entry) => (
              <li key={entry.id} className="text-muted-foreground flex flex-wrap items-center gap-1">
                <span className="font-medium text-foreground">
                  {entry.key.startsWith("cdc.row.") ? `CDC row ${entry.key.split(".")[2]}` : documentFieldLabel(entry.key.split(".")[1] ?? "field")}
                </span>
                <span>·</span>
                <Badge variant={entry.action === "approved" ? "success" : entry.action === "rejected" ? "destructive" : "warning"} className="h-3.5 text-[9px] px-1">
                  {entry.action}
                </Badge>
                <span>·</span>
                <span className="truncate max-w-[250px]">{entry.note}</span>
                <span>·</span>
                <span>{timestamp(entry.created_at)}</span>
                <span>·</span>
                <span>{entry.actor_email ?? "Staff"}</span>
                {entry.stale && <span className="text-amber-600">· superseded</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
