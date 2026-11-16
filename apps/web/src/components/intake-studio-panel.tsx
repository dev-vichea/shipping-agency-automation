"use client";

import { useState } from "react";
import { Anchor, Box, CheckCircle2, ChevronLeft, ChevronRight, DollarSign, Eye, FileText, Package, ShieldCheck, SkipForward, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sourceKey } from "@/components/review-evidence";
import type { CaseDetail, CdcItemName, Evidence, ExtractedField, Extraction, ReviewAnalysis } from "@/lib/contracts";
import { documentFieldLabel, intakeField, invoiceReference, location, sourceValue } from "@/lib/format";
import { lastPageOffset, pageSize } from "@/lib/pagination";
import { cn } from "@/lib/utils";

export type InspectedField = {
  name: string;
  value: string;
  id?: string;
  uncertain?: boolean;
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
  invoice: { name: "Commercial Invoice", icon: FileText },
  packing_list: { name: "Packing List", icon: Package },
};

const languageNames: Record<string, string> = { en: "English", km: "Khmer", zh: "Chinese", und: "Unidentified" };

function GoodsItems({ document, active, inspect, names, candidates }: {
  names: CdcItemName[];
  candidates: ReviewAnalysis["candidates"];
  document: Extraction;
  active: (id: string, evidence?: Evidence) => boolean;
  inspect: (evidence: Evidence, meta: InspectedField) => void;
}) {
  const [requestedOffset, setOffset] = useState(0);
  const { items } = document;
  const offset = Math.min(requestedOffset, lastPageOffset(items.length));
  const displayed = items.slice(offset, offset + pageSize);
  const optionalColumns = document.role === "invoice" ? ["hs_code", "unit_price", "amount"] : ["hs_code", "gross_weight", "net_weight"];
  const columns = ["description", "quantity", ...optionalColumns.filter((key) => items.some(({ fields }) => fields[key]?.value))];

  function itemCell(field: ExtractedField | undefined, key: string, row: number) {
    const id = `item:${row}:${key}`;
    const name = key === "description" ? names.find((entry) => document.role === "invoice"
      ? entry.invoice_document_id === document.document_id && entry.invoice_row === row
      : entry.packing_document_id === document.document_id && entry.packing_row === row) : undefined;
    const suggestion = key === "description" && !name && document.role === "invoice"
      ? candidates.find((entry) => entry.invoice_document_id === document.document_id && entry.invoice_row === row)
      : undefined;
    const text = intakeField(field);
    const evidence = name?.evidence[0] ?? text.evidence;
    const value = name?.description ?? text.value;
    const selected = active(id, evidence);
    const original = name ? sourceValue(field) : text.original;
    const originalEvidence = field?.evidence[0];
    const uncertainty = !name && (field?.status === "uncertain" || text.label === "English proposal");

    return <>
      {evidence ? <button type="button" data-connector-source={selected ? "true" : undefined}
        aria-pressed={selected} title={location(evidence)}
        onClick={() => inspect(evidence, { name: name ? "Verified CDC description" : documentFieldLabel(key), value, id, uncertain: uncertainty })}
        className={cn("data-link block rounded-sm text-left tabular-nums", selected && "bg-primary/10")}>{value}</button> : value}
      {name && <span className="block text-muted-foreground">Verified CDC description · Row {name.master_row}</span>}
      {!name && text.label && <span className="block text-muted-foreground">{text.label}</span>}
      {field?.status === "uncertain" && <span className="block text-warning">Uncertain</span>}
      {original && originalEvidence ? <button type="button"
        data-connector-source={active(`${id}:original`, originalEvidence) ? "true" : undefined}
        title={location(originalEvidence)}
        onClick={() => inspect(originalEvidence, { name: "Original goods description", value: original, id: `${id}:original`, uncertain: field?.status === "uncertain" })}
        className="block text-left text-muted-foreground underline-offset-2 hover:underline">Original · {original}</button>
        : original && <span className="block text-muted-foreground">Original · {original}</span>}
      {suggestion && <button type="button" onClick={() => inspect(suggestion.evidence, {
        name: "Suggested CDC description", value: suggestion.description, id: `${id}:cdc`, uncertain: true,
      })} title={location(suggestion.evidence)}
        data-connector-source={active(`${id}:cdc`, suggestion.evidence) ? "true" : undefined}
        className="data-link mt-1 block text-left">CDC suggestion · {suggestion.description}</button>}
    </>;
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
  </section>;
}

export function IntakeStudioPanel({
  item, analysis, document, activeEvidence, activeField, activeRole, onInspect, onApprove, onReject,
  cdcNames, cdcControls, intakeReference,
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
  onInspect: (evidence: Evidence, meta?: InspectedField) => void;
  onApprove: () => void;
  onReject?: () => void;
}) {
  const candidates = analysis.candidates.filter((candidate) => candidate.invoice_document_id === document?.document_id);
  const cdcIssue = analysis.findings.find((finding) =>
    ["cdc.company", "cdc.version"].includes(finding.key) && finding.outcome !== "PASS");
  const details = roleDetails[activeRole];
  const DocumentIcon = details.icon;
  const fields = document?.fields ?? {};
  const extraKeys = Object.keys(fields).filter((key) => !knownFields.has(key)).sort();
  const currentGroups = groups.map((group, index) => ({
    ...group, keys: (index === 0 ? [...group.keys, ...extraKeys] : group.keys).filter((key) => fields[key]?.value),
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
            {details.name} · {invoiceReference(fields[activeRole === "draft_bl" ? "bl_no" : "invoice_no"]?.value) ?? intakeReference ?? "Reference pending"}
          </span>
        </div>
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
              const text = intakeField(field);
              const evidence = text.evidence;
              const id = `field:${key}`;
              const selected = active(id, evidence);
              const name = documentFieldLabel(key);
              const value = key === "invoice_no" && !invoiceReference(field.value) ? "Needs verification" : text.value;
              const flag = analysis.findings.find((finding) => finding.field === key && finding.evidence.some((entry) =>
                field.evidence.some((citation) => sourceKey(entry) === sourceKey(citation))) &&
                ["MISMATCH", "WARNING"].includes(finding.outcome));
              const Row = evidence ? "button" : "div";
              return <Row key={key} type={evidence ? "button" : undefined} data-connector-source={selected ? "true" : undefined}
                aria-pressed={evidence ? selected : undefined} title={evidence ? location(evidence) : undefined}
                onClick={evidence ? () => onInspect(evidence, { id, name, value: sourceValue(field), uncertain: field.status === "uncertain" || text.label === "English proposal" }) : undefined}
                className={cn("relative grid w-full grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)] items-center gap-2 px-2 py-2 text-left text-xs transition-colors",
                  evidence && "cursor-pointer hover:bg-muted/40", selected && "bg-primary/10 dark:bg-primary/20",
                  flag?.outcome === "MISMATCH" && !selected && "bg-danger-fill/30")}>
                <span className="flex items-center gap-2 font-medium">
                  {evidence && <Eye size={12} className="shrink-0 text-primary" aria-hidden />}{name}
                </span>
                <span className="min-w-0 text-right">
                  {flag && <span className="mr-1.5 rounded bg-warning-fill px-1.5 text-[10px] font-semibold text-warning"
                    title={flag.explanation}>{flag.outcome === "MISMATCH" ? "Diff" : "Warning"}</span>}
                  {field.status === "uncertain" && <span className="mr-1.5 text-[10px] text-warning">Uncertain</span>}
                  <span className={cn("break-words whitespace-normal font-mono text-[11px]", selected && "font-bold text-primary")}>{value}</span>
                  {text.label && <span className="block text-muted-foreground">{text.label}</span>}
                  {text.original && <span className="block text-muted-foreground">Original · {text.original}</span>}
                </span>
              </Row>;
            })}
          </div>
        </section>)}
        {!!document?.source_languages?.length && <p className="px-2 text-xs text-muted-foreground">
          Source languages · {document.source_languages.map((code) => languageNames[code] ?? code).join(", ")}
        </p>}
        {document && document.items.length > 0 && <GoodsItems key={`${document.document_id}:${document.role}:${document.sheet}`}
          document={document} active={active} inspect={onInspect} names={cdcNames} candidates={candidates} />}

        {/* CDC Quota Summary Section (on Invoice tab) */}
        {activeRole === "invoice" && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 px-0.5 pt-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <ShieldCheck size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>CDC Master List Quota</span>
            </div>

            <div className="space-y-1 border-y border-border/60 px-2 py-2 text-xs text-muted-foreground">
              {analysis.analyzed_master && <p>{analysis.analyzed_master.year} · {analysis.analyzed_master.approval_ref}</p>}
              {analysis.comparison_master && <p>English workbook comparison · {analysis.comparison_master.year} · {analysis.comparison_master.approval_ref}</p>}
              {cdcIssue && <p>{cdcIssue.explanation}</p>}
              {candidates.length > 0
                ? <p>Check the suggested CDC descriptions against the shipment before confirming a match.</p>
                : !cdcIssue && <p>No CDC description matches for these items.</p>}
              {cdcControls}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Sticky Intake Workflow Dock */}
      <div className="sticky bottom-0 z-20 flex items-center justify-between border-t border-border/80 bg-white/95 px-3.5 py-2.5 backdrop-blur-md dark:bg-slate-900/95 shadow-xs">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onApprove}
            className="bg-primary text-primary-foreground font-semibold gap-1.5 shadow-sm hover:bg-primary/90 cursor-pointer h-8 text-xs"
          >
            <CheckCircle2 size={14} /> Add to Processed
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground h-8 w-8"
            title="Skip to Next Case"
          >
            <SkipForward size={14} />
          </Button>
        </div>

        {/* Stepper Navigation */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
          <Button variant="ghost" size="icon-xs" className="h-7 w-7 text-muted-foreground">
            <ChevronLeft size={13} />
          </Button>
          <span className="font-semibold text-foreground px-1">1 of 1</span>
          <Button variant="ghost" size="icon-xs" className="h-7 w-7 text-muted-foreground">
            <ChevronRight size={13} />
          </Button>
        </div>

        {onReject && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onReject}
            className="text-muted-foreground hover:text-destructive h-8 w-8"
            title="Reject / Discard Intake"
          >
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}
