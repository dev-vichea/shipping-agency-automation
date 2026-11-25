"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PermitDraftPreview, type PermitTemplate } from "@/features/review/verification/permit-draft-preview";
import { DocumentCanvas, type DocumentSourceOption } from "@/features/review/document-canvas";
import { sourceKey } from "@/features/review/review-findings";
import { VerificationField, type VerificationFieldSave, type VerificationSourceChoice } from "@/features/review/verification/verification-field";
import { VerificationDocumentCard } from "@/features/review/verification/verification-document-card";
import { ResizableSplit } from "@/features/review/resizable-split";
import { useVerificationReview } from "@/features/review/verification/use-verification-review";
import { reviewKey } from "@/features/review/staff-review";
import { toast } from "@/lib/toast";
import { write } from "@/lib/client-api";
import { scopedPath } from "@/lib/scope";
import type {
  CaseDetail,
  Evidence,
  ExtractedField,
  Extraction,
  FindingDecision,
  MasterVersion,
  ReviewAnalysis,
  ReviewCorrection,
  ReviewField,
  ReviewWorkflow,
  StaffReview,
} from "@/lib/contracts";
import { documentFieldLabel, formatFieldValue, invoiceReference, location, timestamp } from "@/lib/format";
import {
  calculateAmount,
  decimalTotal,
  findMatchingInvoiceRow,
  removeSyncedPackingListField,
  replaceVerificationField,
  splitPartyAndAddress,
  syncInvoiceEditToPackingList,
} from "@/features/review/verification/verification-review";

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

export interface VerificationWorkspaceHandle {
  validateAndApprove: () => Promise<boolean>;
  setRole: (role: "invoice" | "packing_list") => void;
}

export interface VerificationWorkspaceProps {
  item: CaseDetail;
  analysis: ReviewAnalysis;
  workflow: ReviewWorkflow;
  saved: StaffReview | null;
  versions: MasterVersion[];
  admin: boolean;
  onSaved: (review: StaffReview) => void;
  onPending: (pending: boolean) => void;
  onActionError?: (error: string) => void;
  onOpenAudit?: () => void;
}

export const VerificationWorkspace = forwardRef<VerificationWorkspaceHandle, VerificationWorkspaceProps>(
  function VerificationWorkspace(
    {
      item,
      analysis,
      workflow,
      saved,
      versions,
      admin,
      onSaved,
      onPending,
      onActionError,
      onOpenAudit,
    },
    ref
  ) {
    const router = useRouter();
    const [, startRefresh] = useTransition();
  const [role, setRoleState] = useState<"invoice" | "packing_list">(() => {
    if (typeof window !== "undefined") {
      const savedRole = window.sessionStorage.getItem(`harborway:verification:role:${item.id}`);
      if (savedRole === "invoice" || savedRole === "packing_list") return savedRole;
    }
    return "invoice";
  });

  const [previewSheetTab, setPreviewSheetTab] = useState<"inv" | "pl" | "bl">(() => {
    return role === "invoice" ? "inv" : "pl";
  });

  const setRole = useCallback((nextRole: "invoice" | "packing_list") => {
    setRoleState(nextRole);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(`harborway:verification:role:${item.id}`, nextRole);
    }
  }, [item.id]);
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
  const invoice = role === "invoice" ? document : analysis.extractions.find((entry) => entry.role === "invoice");
  const packing = role === "packing_list" ? document : analysis.extractions.find((entry) => entry.role === "packing_list");
  const blExtraction =
    analysis.extractions.find((entry) => entry.role === "final_bl") ??
    analysis.extractions.find((entry) => entry.role === "draft_bl");
  const originalBlDoc = useMemo(() => {
    const docs = item.documents ?? [];
    return (
      docs.find((d) => d.classification === "final_bl") ??
      docs.find((d) => d.classification === "draft_bl") ??
      (blExtraction?.document_id ? docs.find((d) => d.id === blExtraction.document_id) : undefined) ??
      docs.find(
        (d) =>
          /b[\/_ -]?l|lading|提单/i.test(d.original_filename) &&
          (d.mime === "application/pdf" || d.original_filename.toLowerCase().endsWith(".pdf"))
      ) ??
      null
    );
  }, [item.documents, blExtraction]);
  const blFile = useMemo(() => {
    if (!originalBlDoc) return undefined;
    const isPdf =
      originalBlDoc.mime === "application/pdf" ||
      originalBlDoc.original_filename.toLowerCase().endsWith(".pdf");
    return {
      id: originalBlDoc.id,
      name: originalBlDoc.original_filename,
      fileType: (isPdf ? "PDF" : "Excel") as "PDF" | "Excel",
      url: `/api/v1/documents/${originalBlDoc.id}/download`,
      version_number: originalBlDoc.version_number ?? 1,
      classification: originalBlDoc.classification,
    };
  }, [originalBlDoc]);
  const blOptions = useMemo<DocumentSourceOption[]>(() => {
    if (!blFile) return [];
    return [
      {
        key: `${blFile.id}:`,
        id: blFile.id,
        title: blFile.name,
        sheet: null,
        fileType: blFile.fileType,
        name: blFile.name,
        url: blFile.url,
        lines: [],
        version_number: blFile.version_number,
        classification: blFile.classification,
      },
    ];
  }, [blFile]);
  const original = item.documents.find((entry) => entry.id === document?.document_id);
  const master = analysis.analyzed_master;
  const disabled =
    analysis.state !== "available" ||
    analysis.analysis_revision !== analysis.revision ||
    !["needs_review", "ready_for_approval", "awaiting_updated_document"].includes(item.state);

  const corrections = new Map(review?.corrections.map((entry) => [reviewKey(entry), entry]));
  const changed = new Map(review?.changes.map((entry) => [reviewKey(entry.edit), entry.after]));
  const findings = useMemo(
    () => [
      ...(review?.findings ?? analysis.findings.filter((entry) => entry.group !== "cdc")),
      ...(review?.cdc_findings ?? analysis.findings.filter((entry) => entry.group === "cdc")),
    ],
    [review?.findings, review?.cdc_findings, analysis.findings]
  );

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

  function findExtractionFallback(fieldName: string): { value: string; evidence: Evidence[]; role: string; docName: string } | null {
    for (const doc of analysis.extractions) {
      let targetVal: string | null | undefined;
      let targetEvidence: Evidence[] = [];

      if (fieldName === "supplier") {
        targetVal = doc.fields.supplier?.value || doc.fields.shipper?.value;
        targetEvidence = doc.fields.supplier?.evidence || doc.fields.shipper?.evidence || [];
        if (targetVal && targetVal.includes("\n")) {
          targetVal = splitPartyAndAddress(targetVal).name;
        }
      } else if (fieldName === "supplier_address") {
        targetVal = doc.fields.supplier_address?.value || doc.fields.shipper_address?.value;
        targetEvidence = doc.fields.supplier_address?.evidence || doc.fields.shipper_address?.evidence || [];
        if (!targetVal) {
          const rawP = doc.fields.supplier?.value || doc.fields.shipper?.value;
          if (rawP && rawP.includes("\n")) {
            targetVal = splitPartyAndAddress(rawP).address;
            targetEvidence = doc.fields.supplier?.evidence || doc.fields.shipper?.evidence || [];
          }
        }
      } else if (fieldName === "consignee") {
        targetVal = doc.fields.consignee?.value;
        targetEvidence = doc.fields.consignee?.evidence || [];
        if (targetVal && targetVal.includes("\n")) {
          targetVal = splitPartyAndAddress(targetVal).name;
        }
        if (!targetVal && analysis.analyzed_master?.company) {
          targetVal = analysis.analyzed_master.company;
        }
        if (!targetVal && item.company) {
          targetVal = item.company;
        }
      } else if (fieldName === "consignee_address") {
        targetVal = doc.fields.consignee_address?.value;
        targetEvidence = doc.fields.consignee_address?.evidence || [];
        if (!targetVal) {
          const rawP = doc.fields.consignee?.value;
          if (rawP && rawP.includes("\n")) {
            targetVal = splitPartyAndAddress(rawP).address;
            targetEvidence = doc.fields.consignee?.evidence || [];
          }
        }
      } else if (fieldName === "invoice_date") {
        targetVal = doc.fields.invoice_date?.value || doc.fields.issue_date?.value;
        targetEvidence = doc.fields.invoice_date?.evidence || doc.fields.issue_date?.evidence || [];
      } else if (fieldName === "shipping_mode") {
        targetVal = doc.fields.shipping_mode?.value || doc.fields.transport_mode?.value;
        targetEvidence = doc.fields.shipping_mode?.evidence || doc.fields.transport_mode?.evidence || [];
      } else if (fieldName === "invoice_no") {
        targetVal = doc.fields.invoice_no?.value || (item.detected_reference ? invoiceReference(item.detected_reference) : undefined);
        targetEvidence = doc.fields.invoice_no?.evidence || [];
      } else {
        targetVal = doc.fields[fieldName]?.value;
        targetEvidence = doc.fields[fieldName]?.evidence || [];
      }

      if (targetVal && targetVal.trim()) {
        const docObj = item.documents.find((d) => d.id === doc.document_id);
        return {
          value: targetVal.trim(),
          evidence: targetEvidence,
          role: doc.role,
          docName: docObj?.original_filename || doc.role.replaceAll("_", " "),
        };
      }
    }
    return null;
  }

  function displayed(ref: ReviewField, fallback: ExtractedField) {
    const explicit = changed.get(reviewKey(ref));
    if (explicit?.value && explicit.value.trim()) return explicit;

    const corr = corrections.get(reviewKey(ref));
    if (corr?.value && corr.value.trim()) {
      return {
        status: "present" as const,
        value: corr.value,
        evidence: fallback.evidence,
        unit: corr.unit ?? fallback.unit,
        currency: corr.currency ?? fallback.currency,
      };
    }

    // When viewing packing list line item, check if synced from commercial invoice
    if (ref.role === "packing_list" && ref.row !== null && ["description", "english_description", "unit"].includes(ref.name)) {
      const targetName = ref.name === "english_description" ? "description" : ref.name;
      const matchingInvRow = findMatchingInvoiceRow(ref.row, packing, invoice, analysis.line_items, findings);
      if (matchingInvRow !== null && invoice) {
        const invRef: ReviewField = { document_id: invoice.document_id, role: "invoice", row: matchingInvRow, name: targetName };
        const invCorr = corrections.get(reviewKey(invRef));
        const invChange = changed.get(reviewKey(invRef));
        const invVal = invChange?.value ?? invCorr?.value;
        if (invVal && invVal.trim()) {
          return {
            status: "present" as const,
            value: invVal,
            evidence: fallback.evidence,
            unit: targetName === "unit" ? invVal : (invCorr?.unit ?? fallback.unit),
            currency: invCorr?.currency ?? fallback.currency,
          };
        }
      }
    }

    const val = explicit ?? fallback;
    if (ref.row === null) {
      if ((!val.value || !val.value.trim())) {
        const fb = findExtractionFallback(ref.name);
        if (fb) {
          return { status: "present" as const, value: fb.value, evidence: fb.evidence, unit: null, currency: null };
        }
      }

      if (ref.name === "consignee" && val.value && val.value.includes("\n")) {
        const { name } = splitPartyAndAddress(val.value);
        return { ...val, value: name };
      }
      if (ref.name === "supplier" && val.value && val.value.includes("\n")) {
        const { name } = splitPartyAndAddress(val.value);
        return { ...val, value: name };
      }
      if (ref.name === "consignee_address") {
        const cVal = changed.get(reviewKey({ ...ref, name: "consignee" }))?.value ?? normalizedDoc?.fields.consignee?.value ?? "";
        if (cVal && cVal.includes("\n") && (!val.value || !val.value.trim())) {
          const { address } = splitPartyAndAddress(cVal);
          if (address) return { ...val, status: "present" as const, value: address };
        }
      }
      if (ref.name === "supplier_address") {
        const sVal = changed.get(reviewKey({ ...ref, name: "supplier" }))?.value ?? normalizedDoc?.fields.supplier?.value ?? "";
        if (sVal && sVal.includes("\n") && (!val.value || !val.value.trim())) {
          const { address } = splitPartyAndAddress(sVal);
          if (address) return { ...val, status: "present" as const, value: address };
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
    let rawVal: ExtractedField = raw ?? { status: "missing", value: "", evidence: [], unit: null, currency: null };
    if (ref.row === null && (!rawVal.value || !rawVal.value.trim())) {
      const fb = findExtractionFallback(ref.name);
      if (fb) {
        rawVal = { status: "present", value: fb.value, evidence: fb.evidence, unit: null, currency: null };
      }
    }
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

    // Document choices from all extractions in the shipment (with semantic aliases)
    const validRoles = new Set<ReviewField["role"]>(["invoice", "packing_list", "draft_bl", "final_bl"]);
    const extraDocChoices: VerificationSourceChoice[] = [];

    for (const doc of analysis.extractions) {
      if (!validRoles.has(doc.role as ReviewField["role"])) continue;
      const docObj = item.documents.find((d) => d.id === doc.document_id);
      const docLabel = docObj?.original_filename || doc.role.replaceAll("_", " ");

      const checkAndPush = (valField: ExtractedField | undefined, effectiveName: string) => {
        if (!valField?.value || !valField.value.trim()) return;
        const loc = valField.evidence?.[0] ? ` · ${location(valField.evidence[0])}` : "";
        extraDocChoices.push({
          source: { document_id: doc.document_id, role: doc.role as ReviewField["role"], row: null, name: effectiveName },
          field: valField,
          label: `${docLabel}${loc}`,
        });
      };

      if (ref.name === "supplier") {
        const sField = doc.fields.supplier;
        const shField = doc.fields.shipper;
        if (sField?.value) {
          const { name } = splitPartyAndAddress(sField.value);
          checkAndPush({ ...sField, value: name }, "supplier");
        }
        if (shField?.value) {
          const { name } = splitPartyAndAddress(shField.value);
          checkAndPush({ ...shField, value: name }, "shipper");
        }
      } else if (ref.name === "supplier_address") {
        const saField = doc.fields.supplier_address;
        const shaField = doc.fields.shipper_address;
        if (saField?.value) checkAndPush(saField, "supplier_address");
        if (shaField?.value) checkAndPush(shaField, "shipper_address");
        const sVal = doc.fields.supplier?.value || doc.fields.shipper?.value;
        const sEv = doc.fields.supplier?.evidence || doc.fields.shipper?.evidence || [];
        if (sVal && sVal.includes("\n")) {
          const { address } = splitPartyAndAddress(sVal);
          if (address) {
            checkAndPush({ status: "present", value: address, evidence: sEv, unit: null, currency: null }, "supplier_address");
          }
        }
      } else if (ref.name === "consignee") {
        const cField = doc.fields.consignee;
        if (cField?.value) {
          const { name } = splitPartyAndAddress(cField.value);
          checkAndPush({ ...cField, value: name }, "consignee");
        }
      } else if (ref.name === "consignee_address") {
        const caField = doc.fields.consignee_address;
        if (caField?.value) checkAndPush(caField, "consignee_address");
        const cVal = doc.fields.consignee?.value;
        if (cVal && cVal.includes("\n")) {
          const { address } = splitPartyAndAddress(cVal);
          if (address) {
            checkAndPush({ status: "present", value: address, evidence: doc.fields.consignee?.evidence ?? [], unit: null, currency: null }, "consignee_address");
          }
        }
      } else if (ref.name === "invoice_date") {
        if (doc.fields.invoice_date?.value) checkAndPush(doc.fields.invoice_date, "invoice_date");
        if (doc.fields.issue_date?.value) checkAndPush(doc.fields.issue_date, "issue_date");
      } else if (ref.name === "shipping_mode") {
        if (doc.fields.shipping_mode?.value) checkAndPush(doc.fields.shipping_mode, "shipping_mode");
        if (doc.fields.transport_mode?.value) checkAndPush(doc.fields.transport_mode, "transport_mode");
      } else {
        const directField = doc.fields[ref.name];
        if (directField?.value) checkAndPush(directField, ref.name);
      }
    }

    if (ref.name === "consignee" && analysis.analyzed_master?.company) {
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

    if (ref.name === "consignee" && item.company && !extraDocChoices.some((c) => c.field.value === item.company)) {
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
          await save((draft) => {
            const invoiceCorrection: ReviewCorrection = {
              ...ref,
              value: edit.value,
              unit: edit.unit,
              currency: edit.currency,
              note: edit.note,
              confirmed: edit.confirmed,
              alternative_index: edit.alternative_index,
              suggestion_source: edit.suggestion_source,
            };

            let next = replaceVerificationField(
              draft,
              invoiceCorrection,
              workflow
            );

            // Sync description and unit to Packing List (PKL) when updated in Commercial Invoice
            if (ref.role === "invoice" && ref.row !== null && ["description", "english_description", "unit"].includes(ref.name)) {
              next = syncInvoiceEditToPackingList(
                next,
                invoiceCorrection,
                workflow,
                analysis.extractions,
                analysis.line_items,
                findings
              );
            }

            // Auto-calculate amount when quantity or unit_price changes on a line item
            if (ref.row !== null && (ref.name === "quantity" || ref.name === "unit_price") && document) {
              const line = document.items.find((item) => item.row === ref.row);
              const qtyVal = ref.name === "quantity"
                ? edit.value
                : displayed({ document_id: document.document_id, role: ref.role, row: ref.row, name: "quantity" }, line?.fields.quantity ?? { status: "missing", value: "", evidence: [], unit: null, currency: null }).value;
              const priceVal = ref.name === "unit_price"
                ? edit.value
                : displayed({ document_id: document.document_id, role: ref.role, row: ref.row, name: "unit_price" }, line?.fields.unit_price ?? { status: "missing", value: "", evidence: [], unit: null, currency: null }).value;

              if (qtyVal && priceVal) {
                const autoAmount = calculateAmount(qtyVal, priceVal);
                if (autoAmount !== null) {
                  const amountRef: ReviewField = {
                    document_id: document.document_id,
                    role: ref.role,
                    row: ref.row,
                    name: "amount",
                  };
                  next = replaceVerificationField(next, {
                    ...amountRef,
                    value: autoAmount,
                    unit: null,
                    currency: edit.currency ?? line?.fields.amount?.currency ?? "USD",
                    note: "Auto-calculated from quantity and unit price",
                    confirmed: edit.confirmed,
                  }, workflow);
                }
              }
            }

            return next;
          });
        }}
      />
    );
  }

  const handleUndo = async (ref: ReviewField) => {
    await save((draft) => {
      const key = reviewKey(ref);
      const isCdcRow = ref.role === "invoice" && ref.row !== null;
      let nextDraft = draft;
      if (ref.role === "invoice" && ref.row !== null && ["description", "english_description", "unit"].includes(ref.name)) {
        nextDraft = removeSyncedPackingListField(
          nextDraft,
          ref,
          analysis.extractions,
          analysis.line_items,
          findings
        );
      }
      const nextCorrections = nextDraft.corrections.filter((c) => reviewKey(c) !== key);
      const nextMappings = isCdcRow
        ? nextDraft.mappings.filter((m) => m.invoice_row !== ref.row)
        : nextDraft.mappings;
      const nextDecisions = (nextDraft.finding_decisions ?? []).filter((d) =>
        isCdcRow ? d.key !== `cdc.row.${ref.row}.mapping` : d.key !== key
      );
      return {
        ...nextDraft,
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
        setPreviewSheetTab(next === "invoice" ? "inv" : "pl");
        setChosenDocument(undefined);
        setActiveField(undefined);
      });
      setLeaveAlertOpen(true);
      return;
    }
    setRole(next);
    setPreviewSheetTab(next === "invoice" ? "inv" : "pl");
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
    if (sum === null) return "Incomplete";
    const formattedSum = formatFieldValue(sum, key);
    return `${formattedSum}${[...dimensions][0] ? ` ${[...dimensions][0]}` : ""}`;
  }

  const handleSelectCandidate = async (
    row: number,
    candidate: ReviewAnalysis["candidates"][number],
    reason?: string
  ) => {
    if (!document) return;
    await save((draft) => {
      const descCorrection: ReviewCorrection = {
        document_id: document.document_id,
        role: "invoice",
        row,
        name: "description",
        value: candidate.description,
        unit: null,
        currency: null,
        note: `Matched CDC material ${candidate.master_row}`,
        confirmed: true,
      };
      // Invalidate edits and mappings based on the previous description before
      // writing the mapping the reviewer just selected for the new description.
      let next = replaceVerificationField(draft, descCorrection, workflow);
      next = syncInvoiceEditToPackingList(
        next,
        descCorrection,
        workflow,
        analysis.extractions,
        analysis.line_items,
        findings
      );

      // Link unit from CDC candidate if present
      if (candidate.unit) {
        const unitCorrection: ReviewCorrection = {
          document_id: document.document_id,
          role: "invoice",
          row,
          name: "unit",
          value: candidate.unit,
          unit: null,
          currency: null,
          note: "Matched CDC material unit",
          confirmed: true,
        };
        next = replaceVerificationField(next, unitCorrection, workflow);
        next = syncInvoiceEditToPackingList(
          next,
          unitCorrection,
          workflow,
          analysis.extractions,
          analysis.line_items,
          findings
        );
      }

      // Link unit_price from CDC candidate if present
      if (candidate.unit_price) {
        next = replaceVerificationField(next, {
          document_id: document.document_id,
          role: "invoice",
          row,
          name: "unit_price",
          value: String(candidate.unit_price),
          unit: null,
          currency: candidate.currency ?? "USD",
          note: "Matched CDC material unit price",
          confirmed: true,
        }, workflow);

        // Auto-calculate amount if quantity is available
        const line = document.items.find((item) => item.row === row);
        const qtyVal = displayed(
          { document_id: document.document_id, role: "invoice", row, name: "quantity" },
          line?.fields.quantity ?? { status: "missing", value: "", evidence: [], unit: null, currency: null }
        ).value;
        if (qtyVal) {
          const autoAmount = calculateAmount(qtyVal, String(candidate.unit_price));
          if (autoAmount !== null) {
            next = replaceVerificationField(next, {
              document_id: document.document_id,
              role: "invoice",
              row,
              name: "amount",
              value: autoAmount,
              unit: null,
              currency: candidate.currency ?? "USD",
              note: `Calculated from CDC unit price (${candidate.unit_price}) and quantity (${qtyVal})`,
              confirmed: true,
            }, workflow);
          }
        }
      }

      const mappingDecision: FindingDecision = {
        key: `cdc.row.${row}.mapping`,
        action: "approved",
        note: reason || `Selected CDC material ${candidate.serial ? `${candidate.serial} · ` : ""}${candidate.description}`,
        master_row: candidate.master_row,
      };
      return {
        ...next,
        mappings: [...next.mappings.filter((m) => m.invoice_row !== row), { invoice_row: row, master_row: candidate.master_row }],
        verify_cdc_mappings: true,
        finding_decisions: [
          ...(next.finding_decisions ?? []).filter((d) => d.key !== mappingDecision.key),
          mappingDecision,
        ],
      };
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

  const validateForApproval = useCallback((): {
    valid: boolean;
    error?: string;
    role?: "invoice" | "packing_list";
    elementId?: string;
    isAudit?: boolean;
  } => {
    if (!invoice) {
      return { valid: false, role: "invoice", error: "Commercial Invoice document is required." };
    }

    // 1. Check Invoice Header fields
    const requiredHeaderFields: Array<{ key: string; label: string }> = [
      { key: "supplier", label: "Supplier" },
      { key: "consignee", label: "Consignee" },
      { key: "invoice_no", label: "Invoice number" },
      { key: "invoice_date", label: "Invoice date" },
      { key: "origin", label: "Origin" },
      { key: "destination", label: "Destination" },
    ];

    for (const { key, label } of requiredHeaderFields) {
      const field = displayed(
        { document_id: invoice.document_id, role: "invoice", row: null, name: key },
        invoice.fields[key] ?? { status: "missing", value: "", confidence: 1, evidence: [] }
      );
      if (!field.value || !field.value.trim()) {
        return {
          valid: false,
          role: "invoice",
          elementId: `verify-invoice-header-${key}`,
          error: `${label} is required on Commercial Invoice.`,
        };
      }
    }

    // 2. Check Invoice Line Items
    if (!invoice.items || invoice.items.length === 0) {
      return { valid: false, role: "invoice", error: "Commercial Invoice requires line items." };
    }

    const currentMappings = review?.mappings ?? [];

    for (let i = 0; i < invoice.items.length; i++) {
      const itm = invoice.items[i];
      const row = itm.row;

      // Description
      const desc = displayed(
        { document_id: invoice.document_id, role: "invoice", row, name: "description" },
        itm.fields.description ?? { status: "missing", value: "", confidence: 1, evidence: [] }
      ).value;
      if (!desc || !desc.trim()) {
        return {
          valid: false,
          role: "invoice",
          elementId: `verify-invoice-${row}-description`,
          error: `Invoice row ${i + 1} requires a goods description.`,
        };
      }

      // Quantity
      const qtyStr = displayed(
        { document_id: invoice.document_id, role: "invoice", row, name: "quantity" },
        itm.fields.quantity ?? { status: "missing", value: "", confidence: 1, evidence: [] }
      ).value;
      const qtyNum = qtyStr ? parseFloat(qtyStr) : NaN;
      if (!qtyStr || isNaN(qtyNum) || qtyNum <= 0) {
        return {
          valid: false,
          role: "invoice",
          elementId: `verify-invoice-${row}-quantity`,
          error: `Invoice row ${i + 1} requires a positive quantity.`,
        };
      }

      // Unit
      const unit = displayed(
        { document_id: invoice.document_id, role: "invoice", row, name: "unit" },
        itm.fields.unit ?? { status: "missing", value: "", confidence: 1, evidence: [] }
      ).value;
      if (!unit || !unit.trim()) {
        return {
          valid: false,
          role: "invoice",
          elementId: `verify-invoice-${row}-unit`,
          error: `Invoice row ${i + 1} requires a unit.`,
        };
      }

      // Unit Price
      const priceStr = displayed(
        { document_id: invoice.document_id, role: "invoice", row, name: "unit_price" },
        itm.fields.unit_price ?? { status: "missing", value: "", confidence: 1, evidence: [] }
      ).value;
      const priceNum = priceStr ? parseFloat(priceStr) : NaN;
      if (!priceStr || isNaN(priceNum) || priceNum <= 0) {
        return {
          valid: false,
          role: "invoice",
          elementId: `verify-invoice-${row}-unit_price`,
          error: `Invoice row ${i + 1} requires a unit price.`,
        };
      }

      // Amount
      const amountStr = displayed(
        { document_id: invoice.document_id, role: "invoice", row, name: "amount" },
        itm.fields.amount ?? { status: "missing", value: "", confidence: 1, evidence: [] }
      ).value;
      const amountNum = amountStr ? parseFloat(amountStr) : NaN;
      if (!amountStr || isNaN(amountNum) || amountNum <= 0) {
        return {
          valid: false,
          role: "invoice",
          elementId: `verify-invoice-${row}-amount`,
          error: `Invoice row ${i + 1} requires a line amount.`,
        };
      }

      // CDC Mapping
      const hasMapping = currentMappings.some((m) => m.invoice_row === row && m.master_row);
      if (!hasMapping) {
        return {
          valid: false,
          role: "invoice",
          elementId: `verify-cdc-row-${row}`,
          error: `Invoice row ${i + 1} (${desc}) requires a verified CDC material mapping.`,
        };
      }
    }

    // 3. Check Packing List Line Items
    if (packing && packing.items) {
      for (let i = 0; i < packing.items.length; i++) {
        const itm = packing.items[i];
        const row = itm.row;
        const desc = displayed(
          { document_id: packing.document_id, role: "packing_list", row, name: "description" },
          itm.fields.description ?? { status: "missing", value: "", confidence: 1, evidence: [] }
        ).value;
        if (!desc || !desc.trim()) {
          return {
            valid: false,
            role: "packing_list",
            elementId: `verify-packing_list-${row}-description`,
            error: `Packing list row ${i + 1} requires a goods description.`,
          };
        }
        const qtyStr = displayed(
          { document_id: packing.document_id, role: "packing_list", row, name: "quantity" },
          itm.fields.quantity ?? { status: "missing", value: "", confidence: 1, evidence: [] }
        ).value;
        const qtyNum = qtyStr ? parseFloat(qtyStr) : NaN;
        if (!qtyStr || isNaN(qtyNum) || qtyNum <= 0) {
          return {
            valid: false,
            role: "packing_list",
            elementId: `verify-packing_list-${row}-quantity`,
            error: `Packing list row ${i + 1} requires a quantity.`,
          };
        }
      }
    }

    return { valid: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice, packing, review?.mappings]);

  const moveToWarning = useCallback(
    (result: {
      valid: boolean;
      error?: string;
      role?: "invoice" | "packing_list";
      elementId?: string;
      isAudit?: boolean;
    }) => {
      if (result.role && result.role !== role) {
        changeRole(result.role);
      }
      if (result.error) {
        toast.error(result.error);
        onActionError?.(result.error);
      }
      if (result.isAudit) {
        onOpenAudit?.();
        return;
      }
      if (result.elementId) {
        const targetId = result.elementId;
        setTimeout(() => {
          if (typeof window === "undefined") return;
          const el = window.document.getElementById(targetId) || window.document.querySelector(`[data-field-id="${targetId}"]`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            (el as HTMLElement).focus?.();
            el.classList.add("ring-2", "ring-destructive", "ring-offset-2", "ring-offset-background", "animate-pulse");
            setTimeout(() => {
              el.classList.remove("ring-2", "ring-destructive", "ring-offset-2", "ring-offset-background", "animate-pulse");
            }, 4000);
          }
        }, 150);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, onActionError, onOpenAudit]
  );

  const validateAndApprove = useCallback(async (): Promise<boolean> => {
    onActionError?.("");
    const check = validateForApproval();
    if (!check.valid) {
      moveToWarning(check);
      return false;
    }

    try {
      const resolvableFindings = findings.filter(
        (f) =>
          (f.group === "transport" && f.outcome === "NEEDS_REVIEW") ||
          (f.group === "invoice_packing" && f.field === "description" && !f.key.includes(".unpaired."))
      );
      const autoResolutions = resolvableFindings.map((f) => ({
        key: f.key,
        note: "Confirmed after staff review.",
      }));

      const pklTotalPkgs = packing ? total("packages") || packing.fields.packages?.value : null;

      const savedReview = await save((draft) => {
        const existingKeys = new Set(draft.resolutions.map((r) => r.key));
        const mergedResolutions = [
          ...draft.resolutions,
          ...autoResolutions.filter((ar) => !existingKeys.has(ar.key)),
        ];

        let nextCorrections = draft.corrections.map((c) => ({ ...c, confirmed: true }));

        if (invoice && pklTotalPkgs && pklTotalPkgs !== "Mixed units" && pklTotalPkgs !== "Incomplete") {
          const invPkgsRef = { document_id: invoice.document_id, role: "invoice" as const, row: null, name: "packages" };
          const invPkgsVal = displayed(invPkgsRef, invoice.fields.packages ?? { status: "missing", value: "", confidence: 1, evidence: [] }).value;
          if (invPkgsVal !== pklTotalPkgs) {
            nextCorrections = nextCorrections.filter(
              (c) => !(c.role === "invoice" && c.row === null && c.name === "packages")
            );
            nextCorrections.push({
              ...invPkgsRef,
              value: pklTotalPkgs,
              unit: "PKG",
              currency: null,
              confirmed: true,
              note: "Matches packing list packages count",
            });
          }
        }

        return {
          ...draft,
          verify_cdc_mappings: true,
          corrections: nextCorrections,
          resolutions: mergedResolutions,
        };
      });

      if (savedReview && !savedReview.ready) {
        const payload = savedReview as unknown as { blockers?: string[] };
        const blockers = payload.blockers ?? [];
        if (blockers.length > 0) {
          const firstBlocker = blockers[0];
          const rowMatch = firstBlocker.match(/row\s+(\d+)/i);
          if (rowMatch && invoice) {
            const rowNum = parseInt(rowMatch[1], 10);
            moveToWarning({
              valid: false,
              role: "invoice",
              elementId: `verify-invoice-${rowNum}-description`,
              error: `Cannot approve: ${firstBlocker}`,
            });
          } else {
            moveToWarning({
              valid: false,
              error: `Cannot approve: ${firstBlocker}`,
              isAudit: true,
            });
          }
          return false;
        }
      }

      const approved = await write<{ approval_id?: string; import_id?: string }>(
        `/intakes/${item.id}/approve`,
        {
          expected_revision: analysis.revision,
          review_id: savedReview?.id ?? saved?.id ?? null,
          notes: "Approved after staff review.",
        }
      );

      toast.saved("Shipment approved! Moved to Import records.");
      startRefresh(() => {
        const target = approved?.import_id
          ? scopedPath(`/imports/${approved.import_id}`, item.company_id ?? undefined)
          : scopedPath("/imports", item.company_id ?? undefined);
        router.push(target);
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to approve review.";
      toast.error(msg);
      onActionError?.(msg);
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    onActionError,
    validateForApproval,
    moveToWarning,
    findings,
    packing,
    save,
    invoice,
    item.id,
    item.company_id,
    analysis.revision,
    saved?.id,
    router,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      validateAndApprove,
      setRole: changeRole,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [validateAndApprove]
  );

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
                  <div className="pointer-events-none absolute right-0 bottom-full mb-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-50 w-56 sm:right-auto sm:left-0 sm:w-72 rounded-md bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-slate-100 shadow-md dark:bg-slate-800 dark:text-slate-100">
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
              {previewSheetTab === "bl" && blFile ? (
                <DocumentCanvas
                  embedded
                  showBadges={false}
                  hideExcerptToggle
                  file={blFile}
                  options={blOptions}
                  currentKey={blOptions[0]?.key}
                  headerActions={
                    <div role="group" aria-label="Print document" className="flex gap-1">
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        aria-label="INV (Invoice)"
                        disabled={pending > 0 || dirtyFields.size > 0}
                        onClick={() => {
                          setPreviewSheetTab("inv");
                          if (role !== "invoice") changeRole("invoice");
                        }}
                      >
                        INV
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        aria-label="PL (Packing List)"
                        disabled={pending > 0 || dirtyFields.size > 0}
                        onClick={() => {
                          setPreviewSheetTab("pl");
                          if (role !== "packing_list") changeRole("packing_list");
                        }}
                      >
                        PL
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="default"
                        aria-label="BL (Bill of Lading)"
                        aria-pressed
                      >
                        BL
                      </Button>
                    </div>
                  }
                />
              ) : (
                <PermitDraftPreview
                  embedded
                  searchQuery={previewSearch}
                  onMatchCountChange={setPreviewMatchCount}
                  sheetTab={previewSheetTab}
                  onSheetTabChange={(tab) => {
                    setPreviewSheetTab(tab);
                    if (tab === "inv" && role !== "invoice") {
                      changeRole("invoice");
                    } else if (tab === "pl" && role !== "packing_list") {
                      changeRole("packing_list");
                    }
                  }}
                  template={template}
                  onTemplateChange={setTemplate}
                  switchingDisabled={pending > 0 || dirtyFields.size > 0}
                  invoiceExt={invoice}
                  packingExt={packing}
                  blExt={blExtraction}
                  selectedMaster={analysis.selected_master ?? master}
                  mappings={review?.mappings ?? []}
                  candidates={review?.candidates ?? analysis.candidates}
                  reviewedFields={changed}
                  companyName={item.company}
                  reference={invoice?.fields.invoice_no?.value}
                  state={item.state}
                  lineItems={analysis.line_items}
                  findings={findings}
                />
              )}
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
});

VerificationWorkspace.displayName = "VerificationWorkspace";
