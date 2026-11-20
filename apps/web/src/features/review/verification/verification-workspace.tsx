"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Info, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PermitDraftPreview, type PermitTemplate } from "@/features/review/verification/permit-draft-preview";
import { sourceKey } from "@/features/review/review-findings";
import { VerificationField, type VerificationFieldSave, type VerificationSourceChoice } from "@/features/review/verification/verification-field";
import { VerificationDocumentCard } from "@/features/review/verification/verification-document-card";
import { ResizableSplit } from "@/features/review/resizable-split";
import { useVerificationReview } from "@/features/review/verification/use-verification-review";
import { reviewKey } from "@/features/review/staff-review";
import type {
  CaseDetail,
  ExtractedField,
  Extraction,
  FindingDecision,
  MasterVersion,
  ReviewAnalysis,
  ReviewField,
  ReviewWorkflow,
  StaffReview,
} from "@/lib/contracts";
import { documentFieldLabel, location, timestamp } from "@/lib/format";
import { decimalTotal, replaceVerificationField, splitPartyAndAddress } from "@/features/review/verification/verification-review";

const totals = ["packages", "quantity", "net_weight", "gross_weight", "measurement", "amount"];
const headerOrder = [
  "supplier",
  "supplier_address",
  "invoice_no",
  "invoice_date",
  "consignee",
  "consignee_address",
  "vat",
  "shipping_mode",
  "origin",
  "country_of_origin",
  "destination",
  "port",
  "bl_no",
  "container",
  "seal",
  "booking_no",
];

const invoicePreferredColumns = ["description", "quantity", "unit", "unit_price", "amount"];
const packingPreferredColumns = ["description", "packages", "quantity", "unit", "net_weight", "gross_weight", "measurement"];

function position(value?: ExtractedField) {
  const cite = value?.evidence[0];
  const letters = cite?.cell?.match(/^[A-Z]+/)?.[0];
  return letters ? [...letters].reduce((col, letter) => col * 26 + letter.charCodeAt(0) - 64, 0) : cite?.bbox ? cite.bbox[0] * 1000 : 10_000;
}

function lineColumns(doc: Extraction) {
  const all = [...new Set(doc.items.flatMap((item) => Object.keys(item.fields)))];
  return all
    .filter(
      (key) =>
        doc.items.some((item) => item.fields[key]?.value != null || !!item.fields[key]?.evidence.length) ||
        ["description", "quantity", "unit", ...(doc.role === "invoice" ? ["unit_price", "amount"] : ["packages", "net_weight", "gross_weight"])].includes(key) ||
        (key === "english_description" && doc.items.some((item) => item.fields.description?.english?.status === "proposed"))
    )
    .sort((a, b) => {
      const left = doc.items.find((item) => item.fields[a]?.evidence.length)?.fields[a];
      const right = doc.items.find((item) => item.fields[b]?.evidence.length)?.fields[b];
      return position(left) - position(right);
    });
}

function columnWeight(name: string) {
  switch (name) {
    case "description":
      return 4.5;
    case "unit":
      return 0.9;
    case "packages":
      return 1.3;
    case "quantity":
      return 1.3;
    case "unit_price":
      return 1.3;
    case "amount":
      return 1.5;
    case "net_weight":
      return 1.2;
    case "gross_weight":
      return 1.2;
    case "measurement":
      return 1.2;
    default:
      return 1.2;
  }
}

function normalizeDocument(document: Extraction | undefined): Extraction | undefined {
  if (!document) return undefined;
  const fields = { ...document.fields };

  // Consignee & Consignee Address split
  const rawConsignee = fields.consignee?.value ?? "";
  const rawConsigneeAddress = fields.consignee_address?.value ?? "";
  if (rawConsignee && (!rawConsigneeAddress.trim() || rawConsignee.includes("\n"))) {
    const { name, address } = splitPartyAndAddress(rawConsignee);
    if (address && !rawConsigneeAddress.trim()) {
      fields.consignee = {
        ...fields.consignee,
        status: "present",
        value: name,
      };
      fields.consignee_address = {
        status: "present",
        value: address,
        evidence: fields.consignee?.evidence ?? [],
        unit: null,
        currency: null,
      };
    } else if (rawConsignee.includes("\n")) {
      fields.consignee = {
        ...fields.consignee,
        value: name,
      };
    }
  }

  // Supplier & Supplier Address split
  const rawSupplier = fields.supplier?.value ?? "";
  const rawSupplierAddress = fields.supplier_address?.value ?? "";
  if (rawSupplier && (!rawSupplierAddress.trim() || rawSupplier.includes("\n"))) {
    const { name, address } = splitPartyAndAddress(rawSupplier);
    if (address && !rawSupplierAddress.trim()) {
      fields.supplier = {
        ...fields.supplier,
        status: "present",
        value: name,
      };
      fields.supplier_address = {
        status: "present",
        value: address,
        evidence: fields.supplier?.evidence ?? [],
        unit: null,
        currency: null,
      };
    } else if (rawSupplier.includes("\n")) {
      fields.supplier = {
        ...fields.supplier,
        value: name,
      };
    }
  }

  // Extract VAT if present in address and not yet set
  const fullText = `${fields.consignee_address?.value ?? ""} ${rawConsignee}`;
  const vatMatch = fullText.match(/VAT[:\s]*([A-Za-z0-9\-]+)/i);
  if (vatMatch && (!fields.vat?.value || !fields.vat.value.trim())) {
    fields.vat = {
      status: "present",
      value: vatMatch[1].trim(),
      evidence: fields.consignee?.evidence ?? [],
      unit: null,
      currency: null,
    };
  }

  return {
    ...document,
    fields,
  };
}

export function VerificationWorkspace({
  item,
  analysis,
  workflow,
  saved,
  versions,
  admin,
  onSaved,
  onPending,
}: {
  item: CaseDetail;
  analysis: ReviewAnalysis;
  workflow: ReviewWorkflow;
  saved: StaffReview | null;
  versions: MasterVersion[];
  admin: boolean;
  onSaved: (review: StaffReview) => void;
  onPending: (pending: boolean) => void;
}) {
  const [role, setRole] = useState<"invoice" | "packing_list">("invoice");
  const [template, setTemplate] = useState<PermitTemplate>("cdc_classic");
  const [chosenDocument, setChosenDocument] = useState<string>();
  const [activeField, setActiveField] = useState<ReviewField>();
  const [autosave, setAutosave] = useState(true);
  const [suggestions, setSuggestions] = useState(true);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewMatchCount, setPreviewMatchCount] = useState<number>(0);
  const [history, setHistory] = useState(false);
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());
  const dirtyCount = useRef(0);

  const markDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyFields((previous) => {
      if (previous.has(key) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const notifyPending = useCallback((isPending: boolean) => {
    onPending(isPending || dirtyCount.current > 0);
  }, [onPending]);

  const { review, pending, error, clearError, save } = useVerificationReview({
    caseId: item.id,
    revision: analysis.revision,
    saved,
    onSaved,
    onPending: notifyPending,
  });

  useEffect(() => {
    dirtyCount.current = dirtyFields.size;
    onPending(pending > 0 || dirtyFields.size > 0);
  }, [pending, dirtyFields.size, onPending]);

  useEffect(() => () => onPending(false), [onPending]);

  const documents = analysis.extractions.filter((entry) => entry.role === role);
  const document = documents.find((entry) => `${entry.document_id}:${entry.sheet ?? ""}` === chosenDocument) ?? documents[0];
  const original = item.documents.find((entry) => entry.id === document?.document_id);
  const master = analysis.analyzed_master;
  const disabled =
    analysis.state !== "available" ||
    analysis.analysis_revision !== analysis.revision ||
    !["needs_review", "ready_for_approval", "awaiting_updated_document"].includes(item.state);

  const corrections = new Map(review?.corrections.map((entry) => [reviewKey(entry), entry]));
  const changed = new Map(review?.changes.map((entry) => [reviewKey(entry.edit), entry.after]));
  const findings = [
    ...(review?.findings ?? analysis.findings.filter((entry) => entry.group !== "cdc")),
    ...(review?.cdc_findings ?? analysis.findings.filter((entry) => entry.group === "cdc")),
  ];

  const allColumns = document ? lineColumns(document) : [];
  const primaryCandidates = role === "invoice" ? invoicePreferredColumns : packingPreferredColumns;
  const columns = [
    ...primaryCandidates.filter(
      (name) =>
        allColumns.includes(name) ||
        (role === "invoice"
          ? ["description", "quantity", "unit", "unit_price", "amount"].includes(name)
          : ["description", "packages", "quantity", "unit", "net_weight", "gross_weight", "measurement"].includes(name))
    ),
    ...allColumns.filter((name) => !primaryCandidates.includes(name)),
  ];
  const columnWeights = columns.reduce((sum, name) => sum + columnWeight(name), 0);

  const normalizedDoc = normalizeDocument(document);

  const allFieldKeys = normalizedDoc
    ? Array.from(new Set([...Object.keys(normalizedDoc.fields), "supplier_address", "consignee_address"]))
    : [];

  const fields = normalizedDoc
    ? allFieldKeys
        .filter((key) => !totals.includes(key) && !["english_description", "delivery", "discharge", "route_legs"].includes(key))
        .filter(
          (key) =>
            (normalizedDoc.fields[key] && (normalizedDoc.fields[key].value !== null || normalizedDoc.fields[key].evidence?.length > 0)) ||
            ["invoice_no", "invoice_date", "supplier", "supplier_address", "consignee", "consignee_address"].includes(key)
        )
        .sort((a, b) => (headerOrder.indexOf(a) < 0 ? 100 : headerOrder.indexOf(a)) - (headerOrder.indexOf(b) < 0 ? 100 : headerOrder.indexOf(b)))
    : [];

  function displayed(ref: ReviewField, fallback: ExtractedField) {
    const val = changed.get(reviewKey(ref)) ?? fallback;
    if (ref.row === null) {
      if (ref.name === "consignee" && val.value && val.value.includes("\n")) {
        const { name } = splitPartyAndAddress(val.value);
        return { ...val, value: name };
      }
      if (ref.name === "supplier" && val.value && val.value.includes("\n")) {
        const { name } = splitPartyAndAddress(val.value);
        return { ...val, value: name };
      }
      if (ref.name === "consignee_address") {
        const explicit = changed.get(reviewKey(ref));
        if (explicit?.value && explicit.value.trim()) return explicit;
        const cVal = changed.get(reviewKey({ ...ref, name: "consignee" }))?.value ?? normalizedDoc?.fields.consignee?.value ?? "";
        if (cVal && cVal.includes("\n") && (!fallback.value || !fallback.value.trim())) {
          const { address } = splitPartyAndAddress(cVal);
          if (address) return { ...fallback, status: "present" as const, value: address };
        }
      }
      if (ref.name === "supplier_address") {
        const explicit = changed.get(reviewKey(ref));
        if (explicit?.value && explicit.value.trim()) return explicit;
        const sVal = changed.get(reviewKey({ ...ref, name: "supplier" }))?.value ?? normalizedDoc?.fields.supplier?.value ?? "";
        if (sVal && sVal.includes("\n") && (!fallback.value || !fallback.value.trim())) {
          const { address } = splitPartyAndAddress(sVal);
          if (address) return { ...fallback, status: "present" as const, value: address };
        }
      }
    }
    return val;
  }

  function inspect(ref: ReviewField) {
    setActiveField(ref);
  }

  function conflict(ref: ReviewField, field: ExtractedField) {
    return findings.find(
      (check) =>
        check.group !== "cdc" &&
        ["MISMATCH", "NEEDS_REVIEW"].includes(check.outcome) &&
        (check.field === ref.name || (ref.name === "english_description" && check.field === "description")) &&
        check.evidence.some((cite) => field.evidence.some((source) => sourceKey(cite) === sourceKey(source)))
    )?.explanation;
  }

  function fieldEditor(ref: ReviewField, raw?: ExtractedField, compact = false) {
    const rawVal: ExtractedField = raw ?? { status: "missing", value: "", evidence: [], unit: null, currency: null };
    const value = displayed(ref, rawVal);
    const proposed = workflow.issues?.find((issue) => issue.target && reviewKey(issue.target) === reviewKey(ref))?.suggestion;
    const suggestion = suggestions && proposed?.value && proposed.evidence.length ? { value: proposed.value, evidence: proposed.evidence } : undefined;
    const workflowChoices: VerificationSourceChoice[] = suggestions
      ? [
          ...new Map(
            (workflow.field_suggestions ?? [])
              .filter((offer) => (offer.target && reviewKey(offer.target) === reviewKey(ref)) || offer.options.some((option) => reviewKey(option.source) === reviewKey(ref)))
              .flatMap((offer) => offer.options)
              .filter(
                (option) =>
                  option.source.name === ref.name &&
                  reviewKey(option.source) !== reviewKey(ref) &&
                  option.field.status === "present" &&
                  option.field.evidence.length > 0
              )
              .map((option) => [
                reviewKey(option.source),
                {
                  ...option,
                  label: `${option.source.role.replaceAll("_", " ")} · ${location(option.field.evidence[0])}`,
                },
              ])
          ).values(),
        ]
      : [];

    // Document choices from other extractions in the same shipment
    const validRoles = new Set<ReviewField["role"]>(["invoice", "packing_list", "draft_bl", "final_bl"]);
    const extraDocChoices: VerificationSourceChoice[] = [];
    for (const doc of analysis.extractions) {
      if ((doc.document_id === ref.document_id && doc.role === ref.role) || !validRoles.has(doc.role as ReviewField["role"])) continue;
      const otherField = doc.fields[ref.name];
      if (otherField?.value && otherField.value.trim() && otherField.value !== rawVal.value) {
        const docObj = item.documents.find((d) => d.id === doc.document_id);
        const docLabel = docObj?.original_filename || doc.role.replaceAll("_", " ");
        const loc = otherField.evidence?.[0] ? ` · ${location(otherField.evidence[0])}` : "";
        extraDocChoices.push({
          source: { document_id: doc.document_id, role: doc.role as ReviewField["role"], row: null, name: ref.name },
          field: otherField,
          label: `${docLabel}${loc}`,
        });
      }
    }

    if (ref.name === "consignee" && analysis.analyzed_master?.company && analysis.analyzed_master.company !== rawVal.value) {
      extraDocChoices.push({
        source: { document_id: "master", role: "invoice", row: null, name: "consignee" },
        field: {
          status: "present",
          value: analysis.analyzed_master.company,
          evidence: [],
          unit: null,
          currency: null,
        },
        label: `Verified Master List · ${analysis.analyzed_master.approval_ref || "QIP"}`,
      });
    }

    if (ref.name === "consignee" && item.company && item.company !== rawVal.value && !extraDocChoices.some((c) => c.field.value === item.company)) {
      extraDocChoices.push({
        source: { document_id: "intake", role: "invoice", row: null, name: "consignee" },
        field: {
          status: "present",
          value: item.company,
          evidence: [],
          unit: null,
          currency: null,
        },
        label: "Company Profile",
      });
    }

    const seenValues = new Set<string>();
    const sourceChoices: VerificationSourceChoice[] = [];
    for (const choice of [...workflowChoices, ...extraDocChoices]) {
      const val = choice.field?.value?.trim();
      if (val && !seenValues.has(val)) {
        seenValues.add(val);
        sourceChoices.push(choice);
      }
    }

    return (
      <VerificationField
        key={reviewKey(ref)}
        target={ref}
        field={value}
        rawField={rawVal}
        correction={corrections.get(reviewKey(ref))}
        conflict={conflict(ref, rawVal)}
        suggestion={suggestion}
        sourceChoices={sourceChoices}
        autosave={autosave}
        disabled={disabled}
        compact={compact}
        onInspect={() => inspect(ref)}
        onDirtyChange={markDirty}
        onUndo={() => handleUndo(ref)}
        onSave={async (edit: VerificationFieldSave) => {
          await save((draft) =>
            replaceVerificationField(
              draft,
              {
                ...ref,
                value: edit.value,
                unit: edit.unit,
                currency: edit.currency,
                note: edit.note,
                confirmed: edit.confirmed,
                alternative_index: edit.alternative_index,
                suggestion_source: edit.suggestion_source,
              },
              workflow
            )
          );
        }}
      />
    );
  }

  const handleUndo = async (ref: ReviewField) => {
    await save((draft) => {
      const key = reviewKey(ref);
      const isCdcRow = ref.role === "invoice" && ref.row !== null;
      const nextCorrections = draft.corrections.filter((c) => reviewKey(c) !== key);
      const nextMappings = isCdcRow
        ? draft.mappings.filter((m) => m.invoice_row !== ref.row)
        : draft.mappings;
      const nextDecisions = (draft.finding_decisions ?? []).filter((d) =>
        isCdcRow ? d.key !== `cdc.row.${ref.row}.mapping` : d.key !== key
      );
      return {
        ...draft,
        corrections: nextCorrections,
        mappings: nextMappings,
        verify_cdc_mappings: nextMappings.length > 0,
        finding_decisions: nextDecisions,
      };
    });
  };

  const [leaveAlertOpen, setLeaveAlertOpen] = useState(false);
  const [pendingLeaveAction, setPendingLeaveAction] = useState<(() => void) | null>(null);
  const [leaveAlertMessage, setLeaveAlertMessage] = useState("");

  const incompleteDescriptions = (document?.items ?? []).filter((line) => {
    const descField = line.fields.description;
    const descVal = displayed(
      { document_id: document?.document_id ?? "", role, row: line.row, name: "description" },
      descField ?? { status: "missing", value: "", confidence: 1, evidence: [] }
    ).value;
    return !descVal || descVal.trim() === "";
  });
  const hasIncompleteDesc = incompleteDescriptions.length > 0;

  function changeRole(next: typeof role) {
    if (next === role) return;
    if (dirtyFields.size > 0 || hasIncompleteDesc) {
      setLeaveAlertMessage(
        dirtyFields.size > 0
          ? `You have ${dirtyFields.size} unsaved edit${dirtyFields.size > 1 ? "s" : ""}. If you leave without saving, your changes may be lost.`
          : `Some items have an empty or incomplete description. All items must have complete descriptions before proceeding.`
      );
      setPendingLeaveAction(() => () => {
        setRole(next);
        setChosenDocument(undefined);
        setActiveField(undefined);
      });
      setLeaveAlertOpen(true);
      return;
    }
    setRole(next);
    setChosenDocument(undefined);
    setActiveField(undefined);
  }

  useEffect(() => {
    const handleLinkClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor || !anchor.href || anchor.target === "_blank") return;
      if (dirtyFields.size > 0 || hasIncompleteDesc) {
        e.preventDefault();
        e.stopPropagation();
        const href = anchor.href;
        setLeaveAlertMessage(
          dirtyFields.size > 0
            ? `You have ${dirtyFields.size} unsaved edit${dirtyFields.size > 1 ? "s" : ""}. If you leave without saving, your changes may be lost.`
            : `Some items have an empty or incomplete description. All items must have complete descriptions before proceeding.`
        );
        setPendingLeaveAction(() => () => {
          window.location.href = href;
        });
        setLeaveAlertOpen(true);
      }
    };
    window.addEventListener("click", handleLinkClick, true);
    return () => window.removeEventListener("click", handleLinkClick, true);
  }, [dirtyFields.size, hasIncompleteDesc]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyFields.size > 0 || hasIncompleteDesc) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyFields.size, hasIncompleteDesc]);

  const invoice = role === "invoice" ? document : analysis.extractions.find((entry) => entry.role === "invoice");
  const packing = role === "packing_list" ? document : analysis.extractions.find((entry) => entry.role === "packing_list");

  const quotaChecks = findings.filter(
    (check) =>
      check.group === "cdc" &&
      check.outcome !== "PASS" &&
      (check.key.startsWith("cdc.quota.") || ["company", "version", "year"].includes(check.field))
  );

  const blockerCount = review
    ? review.blockers.length
    : workflow.issues?.filter((issue) => issue.blocking).length ??
      findings.filter((check) => ["MISMATCH", "NEEDS_REVIEW"].includes(check.outcome)).length;

  function total(key: string) {
    if (!document || !["quantity", "amount", "packages", "gross_weight", "net_weight", "measurement"].includes(key)) return "";
    const dimensions = new Set(
      document.items.map((line) => {
        const raw = line.fields[key];
        if (!raw) return null;
        const value = displayed({ document_id: document.document_id, role, row: line.row, name: key }, raw);
        const unit = line.fields.unit
          ? displayed({ document_id: document.document_id, role, row: line.row, name: "unit" }, line.fields.unit).value
          : null;
        return value.currency ?? (key === "quantity" ? unit : value.unit);
      })
    );
    if (dimensions.size > 1) return "Mixed units";
    const sum = decimalTotal(
      document.items.map((line) =>
        line.fields[key]
          ? displayed({ document_id: document.document_id, role, row: line.row, name: key }, line.fields[key]).value
          : null
      )
    );
    return sum === null ? "Incomplete" : `${sum}${[...dimensions][0] ? ` ${[...dimensions][0]}` : ""}`;
  }

  const handleSelectCandidate = async (
    row: number,
    candidate: ReviewAnalysis["candidates"][number],
    reason?: string
  ) => {
    if (!document) return;
    await save((draft) => {
      const nextMappings = [
        ...draft.mappings.filter((m) => m.invoice_row !== row),
        { invoice_row: row, master_row: candidate.master_row },
      ];
      const mappingDecision: FindingDecision = {
        key: `cdc.row.${row}.mapping`,
        action: "approved",
        note: reason || `Selected CDC material ${candidate.serial ? `${candidate.serial} · ` : ""}${candidate.description}`,
        master_row: candidate.master_row,
      };

      const withMapping = {
        ...draft,
        mappings: nextMappings,
        verify_cdc_mappings: true,
        finding_decisions: [
          ...(draft.finding_decisions ?? []).filter((entry) => entry.key !== mappingDecision.key),
          mappingDecision,
        ],
      };

      const descRef: ReviewField = {
        document_id: document.document_id,
        role: "invoice",
        row,
        name: "description",
      };

      return replaceVerificationField(
        withMapping,
        {
          ...descRef,
          value: candidate.description,
          unit: null,
          currency: null,
          note: `Matched CDC material ${candidate.master_row}`,
          confirmed: true,
        },
        workflow
      );
    });
  };

  const handleClearCandidate = async (row: number) => {
    await save((draft) => {
      const nextMappings = draft.mappings.filter((m) => m.invoice_row !== row);
      const decision: FindingDecision = {
        key: `cdc.row.${row}.mapping`,
        action: "unresolved",
        note: "Cleared selection.",
        master_row: null,
      };
      return {
        ...draft,
        mappings: nextMappings,
        verify_cdc_mappings: nextMappings.length > 0,
        finding_decisions: [
          ...(draft.finding_decisions ?? []).filter((entry) => entry.key !== decision.key),
          decision,
        ],
      };
    });
  };

  return (
    <section aria-label="Verification document editor" className="min-w-0">
      {error && (
        <div role="alert" className="mb-3 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span>{error} Your input remains in the editor. Refresh before retrying if another review changed.</span>
          <button
            type="button"
            onClick={clearError}
            className="ml-2 rounded p-0.5 text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {disabled && (
        <p className="mb-3 rounded-md border border-border/80 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {analysis.state !== "available"
            ? "Waiting for the current document analysis. Earlier evidence is read-only."
            : "This revision is read-only. Reprocess revised documents to start another review."}
        </p>
      )}

      <ResizableSplit
        defaultWidth={50}
        minWidth={32}
        maxWidth={76}
        ariaLabel="Resize editor and preview"
        dividerHeightClassName="lg:h-[calc(100vh-5.5rem)] lg:min-h-[860px] xl:min-h-[960px] 2xl:min-h-[1100px]"
        left={
          <div className="flex flex-col min-w-0">
            {/* Clean top toolbar above left card */}
            <div className="flex items-center justify-between h-9 px-1 mb-2">
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground hover:text-primary transition-colors select-none">
                  <input
                    type="checkbox"
                    checked={suggestions}
                    onChange={(event) => setSuggestions(event.target.checked)}
                    className="size-3.5 rounded border-slate-300 text-primary accent-primary cursor-pointer focus:ring-1 focus:ring-primary dark:border-slate-700"
                  />
                  <span>AI Auto-Suggestion with CDC Rules</span>
                </label>
                <div className="group relative inline-flex items-center">
                  <button
                    type="button"
                    tabIndex={0}
                    className="text-muted-foreground/70 hover:text-foreground transition-colors cursor-help p-0.5 rounded-full"
                    aria-label="About AI Auto-Suggestion with CDC Rules"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Info className="size-3.5" />
                  </button>
                  <div className="pointer-events-none absolute left-0 bottom-full mb-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-50 w-72 rounded-md bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-slate-100 shadow-md dark:bg-slate-800 dark:text-slate-100">
                    Compare cited document values and CDC candidates. All suggestions require staff review and cannot auto-deduct stock.
                  </div>
                </div>
              </div>
            </div>
            <VerificationDocumentCard
              role={role}
              onRoleChange={changeRole}
              document={normalizedDoc ?? document}
              documents={documents}
              original={original}
              chosenDocument={chosenDocument}
              onSelectDocument={(docKey) => {
                setChosenDocument(docKey);
                setActiveField(undefined);
              }}
              analysis={analysis}
              item={item}
              review={review}
              master={master}
              versions={versions}
              admin={admin}
              disabled={disabled}
              pending={pending}
              error={error}
              dirtyCount={dirtyFields.size}
              autosave={autosave}
              onAutosaveChange={setAutosave}
              suggestions={suggestions}
              onSuggestionsChange={setSuggestions}
              historyOpen={history}
              onToggleHistory={() => setHistory(!history)}
              activeField={activeField}
              onInspect={inspect}
              fields={fields}
              columns={columns}
              columnWeight={columnWeight}
              columnWeights={columnWeights}
              fieldEditor={fieldEditor}
              total={total}
              quotaChecks={quotaChecks}
              blockerCount={blockerCount}
              onSelectCandidate={handleSelectCandidate}
              onClearCandidate={handleClearCandidate}
            />
          </div>
        }
        right={
          <div className="flex flex-col min-w-0 lg:sticky lg:top-4">
            {/* Clean top toolbar above right card */}
            <div className="flex items-center justify-end gap-2 h-9 px-1 mb-2">
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search draft preview data..."
                  value={previewSearch}
                  onChange={(e) => setPreviewSearch(e.target.value)}
                  className="h-8 pl-8 pr-7 text-xs bg-white dark:bg-slate-900 border-border/80 rounded-md focus-visible:ring-1 focus-visible:ring-primary shadow-2xs"
                />
                {previewSearch && (
                  <button
                    type="button"
                    onClick={() => setPreviewSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                    aria-label="Clear search"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
              {previewSearch && previewMatchCount > 0 && (
                <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                  {previewMatchCount} match{previewMatchCount === 1 ? "" : "es"}
                </span>
              )}
            </div>
            <div
              className="flex min-h-[720px] min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-xs lg:h-[calc(100vh-5.5rem)] lg:min-h-[860px] xl:min-h-[960px] 2xl:min-h-[1100px]"
              role="region"
              aria-label="Permit draft print preview"
            >
              <PermitDraftPreview
                embedded
                searchQuery={previewSearch}
                onMatchCountChange={setPreviewMatchCount}
                sheetTab={role === "invoice" ? "inv" : "pl"}
                onSheetTabChange={(tab) => changeRole(tab === "inv" ? "invoice" : "packing_list")}
                template={template}
                onTemplateChange={setTemplate}
                switchingDisabled={pending > 0 || dirtyFields.size > 0}
                invoiceExt={invoice}
                packingExt={packing}
                blExt={
                  analysis.extractions.find((entry) => entry.role === "final_bl") ??
                  analysis.extractions.find((entry) => entry.role === "draft_bl")
                }
                selectedMaster={analysis.selected_master ?? master}
                mappings={review?.mappings ?? []}
                candidates={review?.candidates ?? analysis.candidates}
                reviewedFields={changed}
                companyName={item.company}
                reference={invoice?.fields.invoice_no?.value}
                state={item.state}
              />
            </div>
          </div>
        }
      />

      {/* Verification History Drawer */}
      {history && (
        <div className="mt-4 rounded-lg border bg-card p-4 text-xs" aria-label="Verification audit history">
          <h3 className="mb-2 font-semibold">Review history</h3>
          {workflow.history?.map((entry) => (
            <a
              key={entry.id}
              className="data-link mb-1 block"
              target="_blank"
              rel="noreferrer"
              href={`/api/v1/intakes/${item.id}/review/${entry.id}`}
            >
              {timestamp(entry.created_at)} · {entry.actor_email ?? "Staff member"} ·{" "}
              {entry.ready ? "Ready for approval" : "Review in progress"}
            </a>
          ))}
          {review?.changes.map((change) => (
            <p key={reviewKey(change.edit)} className="py-1 text-muted-foreground">
              {documentFieldLabel(change.edit.name)}
              {change.edit.row ? ` · row ${change.edit.row}` : ""}: {change.before.value ?? "Missing"} →{" "}
              {change.after.value} · {change.edit.confirmed === false ? "Awaiting confirmation" : "Confirmed"} ·{" "}
              {change.edit.note}
            </p>
          ))}
        </div>
      )}
      {/* Unsaved or Incomplete Description Alert Dialog */}
      <Dialog open={leaveAlertOpen} onOpenChange={setLeaveAlertOpen}>
        <DialogContent className="max-w-md p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400 shrink-0">
              <AlertTriangle className="size-5" />
            </div>
            <div className="space-y-1.5 flex-1 min-w-0">
              <DialogTitle className="text-sm font-semibold text-foreground">
                {dirtyFields.size > 0 ? "Unsaved Changes" : "Incomplete Description"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {leaveAlertMessage || "You have unsaved edits or incomplete descriptions. Leave without saving?"}
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLeaveAlertOpen(false);
                if (pendingLeaveAction) {
                  pendingLeaveAction();
                  setPendingLeaveAction(null);
                }
              }}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Discard & Leave
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => {
                setLeaveAlertOpen(false);
                setPendingLeaveAction(null);
              }}
              className="text-xs"
            >
              Keep Editing
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
