"use client";

import { useCallback, useId, useState } from "react";
import { Anchor, Box, Check, Copy, DollarSign, FileText, Minus, Package, ShieldCheck, X } from "lucide-react";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sourceKey } from "@/features/review/review-findings";
import type { FieldEditor } from "@/features/review/field-editor-types";
import type { CaseDetail, CdcItemName, Evidence, ExtractedField, Extraction, ReviewAnalysis, ReviewField } from "@/lib/contracts";
import { documentFieldLabel, formatFieldValue, intakeField, invoiceReference, location } from "@/lib/format";
import { lastPageOffset, pageSize } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { highlightMatch } from "./highlight-match";
import { splitPartyAndAddress } from "@/features/review/verification/verification-review";

export type InspectedField = {
  name: string;
  value: string;
  id?: string;
  uncertain?: boolean;
  target?: ReviewField;
};

const groups = [
  {
    title: "Document Details",
    icon: FileText,
    keys: [
      "bl_no",
      "booking_no",
      "invoice_no",
      "invoice_date",
      "issue_date",
      "shipper",
      "shipper_address",
      "supplier",
      "supplier_address",
      "consignee",
      "consignee_address",
      "vat",
      "notify_party",
      "carrier",
      "origin",
      "port",
      "destination",
      "shipping_mode",
      "vessel",
      "voyage",
      "etd",
      "eta",
      "payment_terms",
      "incoterms",
    ],
  },
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

function IntakeStatusDot({ status }: { status: keyof typeof statuses }) {
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

function formatNumberValue(val?: string | null, fieldName?: string): string {
  return formatFieldValue(val, fieldName);
}

function renderFieldValue(field: ExtractedField | undefined, fallbackValue: string, searchQuery?: string, fieldName?: string) {
  if (!field?.value) return highlightMatch(fallbackValue, searchQuery);
  const unitOrCurrency = field.unit || field.currency;

  const rawDisplayVal = field.english?.value && ["source", "staff_verified", "verified_company_alias", "proposed"].includes(field.english.status)
    ? field.english.value
    : field.value;

  const displayVal = formatNumberValue(rawDisplayVal, fieldName);

  if (!unitOrCurrency) return highlightMatch(displayVal, searchQuery);

  return (
    <span className="inline-flex items-baseline justify-end gap-1.5 font-mono">
      <span>{highlightMatch(displayVal, searchQuery)}</span>
      <span className="text-muted-foreground font-semibold text-[10px] uppercase select-none">{highlightMatch(unitOrCurrency, searchQuery)}</span>
    </span>
  );
}

function GoodsItems({ document, active, inspect, names, candidates, editable, viewedField, isReviewed, searchQuery }: {
  names: CdcItemName[];
  candidates: ReviewAnalysis["candidates"];
  document: Extraction;
  active: (id: string, evidence?: Evidence) => boolean;
  inspect: (evidence: Evidence | undefined, meta: InspectedField) => void;
  editable: boolean;
  viewedField: (target: ReviewField, field: ExtractedField) => ExtractedField;
  isReviewed: (target: ReviewField) => boolean;
  searchQuery?: string;
}) {
  const [requestedOffset, setOffset] = useState(0);
  const descriptionId = useId();
  const { items } = document;
  const offset = Math.min(requestedOffset, lastPageOffset(items.length));
  const displayed = items.slice(offset, offset + pageSize);

  const hasUnit = items.some(({ fields }) => (fields.unit?.value && fields.unit.value.trim() !== "") || (fields.quantity?.unit && fields.quantity.unit.trim() !== ""));
  const docCurrency = document.fields.currency?.value
    || items.find((it) => it.fields.amount?.currency)?.fields.amount?.currency
    || items.find((it) => it.fields.unit_price?.currency)?.fields.unit_price?.currency;

  const primaryOrder = document.role === "invoice"
    ? ["description", "hs_code", "quantity", "unit", "unit_price", "amount"]
    : ["description", "hs_code", "packages", "quantity", "unit", "gross_weight", "net_weight", "measurement", "unit_price", "amount"];

  const columns = primaryOrder.filter((key) => {
    if (key === "description") return true;
    if (key === "quantity") return items.some(({ fields }) => fields.quantity?.value != null && fields.quantity.value !== "");
    if (key === "unit") return hasUnit;
    return items.some(({ fields }) => fields[key]?.value != null && fields[key].value !== "");
  });

  function getColumnHeader(key: string): string {
    switch (key) {
      case "description":
        return "Item";
      case "quantity":
        return "Quantity";
      case "unit":
        return "Unit";
      case "unit_price":
        return docCurrency ? `Unit Price (${docCurrency})` : "Unit Price";
      case "amount":
        return docCurrency ? `Amount (${docCurrency})` : "Amount";
      case "hs_code":
        return "HS Code";
      case "packages":
        return "Packages";
      case "gross_weight":
        return "Gross Wt";
      case "net_weight":
        return "Net Wt";
      case "measurement":
        return "CBM";
      default:
        return documentFieldLabel(key);
    }
  }

  function getColumnAlign(key: string): "left" | "right" | "center" {
    if (key === "description") return "left";
    if (key === "unit" || key === "hs_code") return "center";
    return "right";
  }

  function itemCell(field: ExtractedField | undefined, key: string, row: number, align: "left" | "right" | "center") {
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
    const rawVal = name?.description ?? suggestion?.description ?? (visibleField?.value || text.value);
    const value = formatNumberValue(rawVal, key);
    const selected = active(id, evidence);
    const status = name || reviewed ? "present" : intakeStatus(visibleField, !!suggestion);
    const label = name ? "Verified CDC description" : suggestion ? "Suggested CDC description"
      : text.label ?? (key === "unit" ? "Unit" : documentFieldLabel(key));
    const detail = `${label} · ${reviewed ? "Reviewed" : statuses[status].label}`;

    let formattedContent: React.ReactNode;
    if (key === "description") {
      formattedContent = <span>{highlightMatch(value, searchQuery)}</span>;
    } else if (key === "unit") {
      formattedContent = (
        <span className="font-mono text-[11px] font-semibold text-muted-foreground uppercase">
          {highlightMatch(value, searchQuery)}
        </span>
      );
    } else {
      formattedContent = (
        <span className="font-mono text-[11px]">
          {highlightMatch(value, searchQuery)}
        </span>
      );
    }

    const content = (
      <>
        {(key === "description" || reviewed) && <IntakeStatusDot status={status} />}
        {formattedContent}
        <span hidden id={`${descriptionId}-${id}`}>{detail}</span>
      </>
    );

    return evidence || (editable && field) ? (
      <button
        type="button"
        data-connector-source={selected ? "true" : undefined}
        aria-pressed={selected}
        aria-describedby={`${descriptionId}-${id}`}
        title={evidence ? `${detail} · ${location(evidence)}` : detail}
        onClick={() => {
          inspect(evidence, { name: key === "unit" ? "Unit" : documentFieldLabel(key), value, id, target, uncertain: status === "review" });
        }}
        className={cn(
          "data-link inline-flex items-center gap-1.5 rounded-sm tabular-nums text-xs",
          align === "right" && "justify-end w-full text-right",
          align === "center" && "justify-center w-full text-center",
          align === "left" && "justify-start text-left",
          selected && "bg-primary/10"
        )}
      >
        {content}
      </button>
    ) : (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs",
          align === "right" && "justify-end w-full text-right",
          align === "center" && "justify-center w-full text-center",
          align === "left" && "justify-start text-left"
        )}
      >
        {content}
      </span>
    );
  }

  return (
    <section aria-label="Goods items" className="space-y-1">
      <div className="flex items-center justify-between gap-2 px-0.5 pt-1.5 pb-0.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Box size={12} className="text-primary" aria-hidden /> Goods items
        </h3>
        <span className="tabular-nums text-xs text-muted-foreground">{items.length} {items.length === 1 ? "item" : "items"}</span>
      </div>
      <div className="overflow-x-auto rounded-sm border-y">
        <Table className="text-xs">
          <TableHeader className="bg-muted/40">
            <TableRow>
              {columns.map((key) => {
                const align = getColumnAlign(key);
                return (
                  <TableHead
                    key={key}
                    className={cn(
                      "h-8 text-[11px] font-semibold text-muted-foreground select-none px-2.5",
                      align === "right" && "text-right",
                      align === "center" && "text-center",
                      align === "left" && "text-left"
                    )}
                  >
                    {getColumnHeader(key)}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map(({ row, fields }) => (
              <TableRow key={row} className="hover:bg-muted/30">
                {columns.map((key) => {
                  const align = getColumnAlign(key);
                  let cellField = fields[key];
                  if (key === "description") {
                    cellField = !fields.description?.english && fields.english_description?.status === "present"
                      ? fields.english_description
                      : fields.description;
                  } else if (key === "unit" && (!cellField?.value || cellField.value.trim() === "") && fields.quantity?.unit) {
                    cellField = {
                      value: fields.quantity.unit,
                      status: "present",
                      evidence: fields.quantity.evidence ?? [],
                      unit: null,
                      currency: null,
                    };
                  }

                  return (
                    <TableCell
                      key={key}
                      className={cn(
                        "py-2 px-2.5 align-middle",
                        key === "description" ? "min-w-40 max-w-72 whitespace-normal break-words" : "whitespace-nowrap",
                        align === "right" && "text-right",
                        align === "center" && "text-center",
                        align === "left" && "text-left"
                      )}
                    >
                      {itemCell(cellField, key, row, align)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination
        label="Goods items"
        offset={offset}
        count={displayed.length}
        total={items.length}
        previous={offset > 0 ? () => setOffset(offset - pageSize) : undefined}
        next={offset + pageSize < items.length ? () => setOffset(offset + pageSize) : undefined}
      />
    </section>
  );
}

export function IntakeStudioPanel({
  item, analysis, document, activeEvidence, activeField, activeRole, onInspect,
  cdcNames, cdcControls, intakeReference, editable, hasConsigneeOptions, viewedField, isReviewed,
  searchQuery, onMarkCorrect, onOpenVerification,
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
  searchQuery?: string;
  onMarkCorrect?: (target: ReviewField, value: string) => Promise<void> | void;
  onOpenVerification?: (target?: ReviewField) => void;
}) {
  const descriptionId = useId();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = useCallback((key: string, value: string, name: string) => {
    if (!value || value === "Needs verification") return;
    try {
      void navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.info(`Copied ${name}`);
      setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 1500);
    } catch {
      toast.warning("Failed to copy to clipboard");
    }
  }, []);

  const candidates = analysis.candidates.filter((candidate) => candidate.invoice_document_id === document?.document_id);
  const cdcIssue = analysis.findings.find((finding) =>
    ["cdc.company", "cdc.version"].includes(finding.key) && finding.outcome !== "PASS");
  const isTransport = activeRole === "draft_bl" || document?.role === "draft_bl" || document?.role === "final_bl";
  const details = (document?.role ? roleDetails[document.role as keyof typeof roleDetails] : undefined)
    ?? roleDetails[activeRole as keyof typeof roleDetails]
    ?? { name: "Bill of Lading", icon: Anchor };
  const DocumentIcon = details.icon;
  const rawFields = document?.fields ?? {};
  const fields: Record<string, ExtractedField> = { ...rawFields };

  // Resolve Shipper / Supplier address
  const rawShipper = fields.shipper?.value ?? "";
  const rawSupplier = fields.supplier?.value ?? "";
  const rawShipperAddr = fields.shipper_address?.value ?? "";
  const rawSupplierAddr = fields.supplier_address?.value ?? "";

  if (rawShipper.includes("\n") && !rawShipperAddr) {
    const { name, address } = splitPartyAndAddress(rawShipper);
    if (address) {
      fields.shipper = { ...fields.shipper, value: name };
      fields.shipper_address = { status: "present", value: address, evidence: fields.shipper?.evidence ?? [], unit: null, currency: null };
    }
  }
  if (rawSupplier.includes("\n") && !rawSupplierAddr) {
    const { name, address } = splitPartyAndAddress(rawSupplier);
    if (address) {
      fields.supplier = { ...fields.supplier, value: name };
      fields.supplier_address = { status: "present", value: address, evidence: fields.supplier?.evidence ?? [], unit: null, currency: null };
    }
  }

  // Check reviewed fields for current document and sibling documents
  for (const key of ["shipper_address", "supplier_address", "consignee_address", "vat"]) {
    if (!fields[key]?.value) {
      const target: ReviewField = { document_id: document?.document_id ?? "", role: (document?.role === "final_bl" ? "final_bl" : activeRole) as ReviewField["role"], row: null, name: key };
      const reviewed = viewedField(target, { status: "missing", value: "", evidence: [], unit: null, currency: null });
      if (reviewed?.value?.trim()) {
        fields[key] = reviewed;
      }
    }
  }

  // Cross-reference between shipper_address and supplier_address
  if (fields.shipper_address?.value && !fields.supplier_address?.value) {
    fields.supplier_address = fields.shipper_address;
  } else if (fields.supplier_address?.value && !fields.shipper_address?.value) {
    fields.shipper_address = fields.supplier_address;
  }

  // Cross-reference from sibling document extractions (both raw and reviewed) if not present on this document
  if (!fields.shipper_address?.value && !fields.supplier_address?.value) {
    for (const otherDoc of analysis.extractions) {
      for (const checkKey of ["supplier_address", "shipper_address"]) {
        const target: ReviewField = { document_id: otherDoc.document_id, role: otherDoc.role as ReviewField["role"], row: null, name: checkKey };
        const reviewed = viewedField(target, otherDoc.fields[checkKey] ?? { status: "missing", value: "", evidence: [], unit: null, currency: null });
        if (reviewed?.value?.trim()) {
          if (isTransport) {
            fields.shipper_address = reviewed;
          } else {
            fields.supplier_address = reviewed;
          }
          break;
        }
      }
      if (fields.shipper_address?.value || fields.supplier_address?.value) break;
    }
  }

  // Resolve Consignee address & VAT
  const rawConsignee = fields.consignee?.value ?? "";
  const rawConsigneeAddr = fields.consignee_address?.value ?? "";
  if (rawConsignee.includes("\n") && !rawConsigneeAddr) {
    const { name, address } = splitPartyAndAddress(rawConsignee);
    if (address) {
      fields.consignee = { ...fields.consignee, value: name };
      fields.consignee_address = { status: "present", value: address, evidence: fields.consignee?.evidence ?? [], unit: null, currency: null };
    }
  }
  if (!fields.consignee_address?.value) {
    for (const otherDoc of analysis.extractions) {
      const target: ReviewField = { document_id: otherDoc.document_id, role: otherDoc.role as ReviewField["role"], row: null, name: "consignee_address" };
      const reviewed = viewedField(target, otherDoc.fields.consignee_address ?? { status: "missing", value: "", evidence: [], unit: null, currency: null });
      if (reviewed?.value?.trim()) {
        fields.consignee_address = reviewed;
        break;
      }
    }
  }

  // Check VAT in address if not explicitly present
  if (!fields.vat?.value) {
    const combinedAddr = `${fields.consignee_address?.value ?? ""} ${rawConsignee}`;
    const vatMatch = combinedAddr.match(/VAT[:\s]*([A-Za-z0-9\-]+)/i);
    if (vatMatch) {
      fields.vat = { status: "present", value: vatMatch[1].trim(), evidence: fields.consignee?.evidence ?? [], unit: null, currency: null };
    }
  }

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
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-border/60">
        <div className="min-w-0 flex items-center gap-2">
          <DocumentIcon size={15} className="text-primary shrink-0" aria-hidden />
          <span className="font-semibold text-xs truncate text-foreground">
            {details.name} · {invoiceReference(fields[isTransport ? "bl_no" : "invoice_no"]?.value) ?? intakeReference ?? "Reference pending"}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {item.documents.length} source file{item.documents.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="px-3.5 py-2.5 space-y-4 flex-1">
        {!currentGroups.length && !document?.items.length &&
          <p className="py-2 text-xs text-muted-foreground">{document ? "No fields were extracted from this document." : "No extracted document for this tab."}</p>}
        {currentGroups.map(({ title, icon: Icon, keys }) => (
          <section key={title} aria-label={title} className="space-y-1">
            <h3 className="flex items-center gap-1.5 px-0.5 pt-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Icon size={12} className="text-primary shrink-0" aria-hidden /> {title}
            </h3>
            <div className="divide-y divide-border/50 border-y border-border/50">
              {keys.map((key) => {
                const field = fields[key];
                const target: ReviewField = { document_id: document!.document_id, role: (document?.role === "final_bl" ? "final_bl" : activeRole) as ReviewField["role"], row: null, name: key };
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

                return (
                  <div
                    key={key}
                    role={interactive ? "button" : undefined}
                    data-field-key={key}
                    data-connector-source={selected ? "true" : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    aria-pressed={interactive ? selected : undefined}
                    aria-describedby={`${descriptionId}-${id}`}
                    title={evidence ? `${reason} · ${location(evidence)}` : reason}
                    onClick={interactive ? () => {
                      onInspect(evidence, { id, name, value, target, uncertain: status === "review" || status === "problem" });
                    } : undefined}
                    onKeyDown={interactive ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onInspect(evidence, { id, name, value, target, uncertain: status === "review" || status === "problem" });
                      }
                    } : undefined}
                    className={cn(
                      "group/field relative grid w-full grid-cols-[minmax(7.5rem,1.2fr)_minmax(0,2fr)] items-center gap-3 px-2 py-2 text-left text-xs transition-colors outline-none",
                      interactive && "cursor-pointer hover:bg-muted/40",
                      selected && "bg-primary/8 dark:bg-primary/15"
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium min-w-0">
                      <IntakeStatusDot status={status} />
                      <span className="truncate">{highlightMatch(name, searchQuery)}</span>
                    </span>

                    <div className="relative flex items-center justify-end min-w-0">
                      <span className={cn(
                        "inline-block min-w-0 break-words whitespace-normal text-right font-mono text-[11px] transition-transform duration-200 ease-out will-change-transform",
                        selected && "font-bold text-primary",
                        "group-hover/field:-translate-x-20"
                      )}>
                        {renderFieldValue(visibleField, value, searchQuery, key)}
                      </span>

                      <div
                        className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 translate-x-1.5 group-hover/field:opacity-100 group-hover/field:translate-x-0 focus-within:opacity-100 focus-within:translate-x-0 transition-all duration-200 ease-out z-10 pointer-events-none group-hover/field:pointer-events-auto"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkCorrect?.(target, value);
                          }}
                          className={cn(
                            "p-1 rounded-sm hover:bg-emerald-500/15 text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer",
                            reviewed && "text-emerald-600 dark:text-emerald-400 font-semibold"
                          )}
                          title={reviewed ? "Marked as correct (click to undo)" : "Mark as correct"}
                          aria-label={`Mark ${name} as correct`}
                        >
                          <Check size={13} className={cn("stroke-[2.5]", reviewed && "stroke-[3]")} />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenVerification?.(target);
                          }}
                          className="p-1 rounded-sm hover:bg-rose-500/15 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                          title="Mark as issue & open verification"
                          aria-label={`Mark ${name} as issue and open verification`}
                        >
                          <X size={13} className="stroke-[2.5]" />
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(key, value, name);
                          }}
                          className={cn(
                            "p-1 rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
                            copiedKey === key && "text-emerald-600 dark:text-emerald-400"
                          )}
                          title={copiedKey === key ? "Copied!" : "Copy value"}
                          aria-label={`Copy ${name}`}
                        >
                          {copiedKey === key ? (
                            <Check size={13} className="stroke-[2.5]" />
                          ) : (
                            <Copy size={13} />
                          )}
                        </button>
                      </div>
                    </div>

                    <span hidden id={`${descriptionId}-${id}`}>{reason}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {document && document.items.length > 0 && <GoodsItems key={`${document.document_id}:${document.role}:${document.sheet}`}
          document={document} active={active} inspect={onInspect} names={cdcNames} candidates={candidates}
          editable={editable} viewedField={viewedField} isReviewed={isReviewed}
          searchQuery={searchQuery} />}

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
