import { NativeSelect } from "@/components/ui/native-select";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, HelpCircle, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";
import { Empty, Status } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Evidence, ExtractedField, Finding, LineComparison, ReviewAnalysis } from "@/lib/contracts";
import { label, location } from "@/lib/format";
import { lastPageOffset, pageSize } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type InspectProps = { names: Map<string, string>; onInspect: (evidence: Evidence) => void; activeEvidence?: Evidence };
type ReviewProps = InspectProps & { analysis: ReviewAnalysis };

export function sourceKey(item: Evidence) {
  return [item.document_id, item.sheet, item.cell, item.page, item.line, item.row].join(":");
}

function EvidenceLinks({ items, names, onInspect }: InspectProps & { items: Evidence[] }) {
  const unique = [...new Map(items.map((item) => [sourceKey(item), item])).values()];
  return <div className="space-y-1">{unique.map((item) =>
    <button type="button" onClick={() => onInspect(item)} key={sourceKey(item)}
      className="data-link block max-w-full cursor-pointer break-words text-left text-body-sm">
      {names.get(item.document_id) ?? "Source"} · {location(item)}
    </button>)}</div>;
}

const groups: Record<string, string> = {
  extraction: "Document coverage",
  invoice_packing: "Invoice vs packing list",
  transport: "Draft B/L checks",
  validation: "Validation rules",
  cdc: "CDC Master List checks",
};
const priority: Record<Finding["outcome"], number> = { MISMATCH: 0, NEEDS_REVIEW: 1, WARNING: 2, PASS: 3 };

function comparisonLabels(item: Finding) {
  if (item.field === "invoice_subtotal") return ["Declared", "Line sum"];
  if (item.field === "container_check_digit") return ["Reported", "Expected"];
  if (item.group === "invoice_packing" && item.right !== null) return ["Invoice", "Packing list"];
  if (item.group === "transport" && item.right !== null) {
    return [item.key.endsWith(".packing_list") ? "Packing list" : "Invoice", "Draft B/L"];
  }
  return null;
}

export function Findings({ analysis, names, onInspect, auditFilter, activeEvidence }: ReviewProps & { auditFilter?: "All" | "Blockers" | "Warnings" | "Passed" }) {
  if (!analysis.outcome) return <div className="p-3"><Empty>{analysis.state === "failed" ? "Analysis failed. Open Automation to retry." : "Document analysis is pending. Refresh to check for findings."}</Empty></div>;
  const findings = analysis.findings.filter((item) => {
    if (auditFilter === "Blockers") return item.outcome === "MISMATCH";
    if (auditFilter === "Warnings") return item.outcome === "WARNING" || item.outcome === "NEEDS_REVIEW";
    if (auditFilter === "Passed") return item.outcome === "PASS";
    return true;
  })
    .sort((left, right) => priority[left.outcome] - priority[right.outcome]);
  return <div className="space-y-2 p-3">
    {!auditFilter && <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-headline-sm">Comparison findings</h2><Status value={analysis.outcome} />
    </div>}
    {findings.length === 0 && <Empty>No checks match this filter.</Empty>}
    {Object.entries(groups).map(([key, title]) => {
      const rows = findings.filter((item) => item.group === key);
      if (!rows.length) return null;
      const mismatches = rows.filter((item) => item.outcome === "MISMATCH").length;
      return <details key={`${key}:${auditFilter ?? "comparison"}`} open={mismatches > 0 || key === "validation" || (auditFilter !== undefined && auditFilter !== "All") || (key === "extraction" && analysis.state === "failed")} className="group overflow-hidden rounded-lg border">
        <summary className="flex items-center gap-2 bg-muted px-3 py-2 text-label-md focus-visible:outline-offset-[-2px]">
          <ChevronDown size={14} className="-rotate-90 group-open:rotate-0" aria-hidden /> {title}
          <span className="ml-auto font-mono text-code-tabular text-muted-foreground">{mismatches > 0 ? `${mismatches} mismatch${mismatches > 1 ? "es" : ""}` : `${rows.length} checks`}</span>
        </summary>
        <Table className="text-body-sm">
          <TableHeader><TableRow><TableHead>Check</TableHead><TableHead>Outcome</TableHead><TableHead>Values and evidence</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map((item) => {
            const columns = comparisonLabels(item);
            const isRowActive = activeEvidence && item.evidence.some((e) => sourceKey(e) === sourceKey(activeEvidence));
            return <TableRow
              key={item.key}
              data-connector-source={isRowActive ? "true" : undefined}
              className={cn(
                "relative transition-colors",
                isRowActive ? "bg-primary/8 dark:bg-primary/15 font-medium" : item.outcome === "MISMATCH" ? "bg-danger-fill hover:bg-danger-fill" : undefined
              )}
            >
            <TableCell className="whitespace-normal align-top font-medium capitalize">{label(item.field)}</TableCell>
            <TableCell className="align-top"><Status value={item.outcome} /></TableCell>
            <TableCell className="min-w-40 max-w-md space-y-1 whitespace-normal break-words align-top relative">
              {(item.left || item.right) && <div className={item.right || columns ? "grid grid-cols-2 gap-1.5" : undefined}>
                {[item.left, ...(item.right || columns ? [item.right] : [])].map((value, index) =>
                  <div key={index} className="rounded-control border bg-card p-1.5">
                    {columns && <span className="block text-label-sm text-muted-foreground">{columns[index]}</span>}
                    <span className="font-mono text-code-tabular">{value ?? "—"}</span>
                  </div>)}
              </div>}
              <p className="text-muted-foreground">{item.explanation}</p>
              <EvidenceLinks items={item.evidence} names={names} onInspect={onInspect} />
              {isRowActive && (
                <span aria-hidden className="pointer-events-none absolute -right-1.5 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center">
                  <span className="size-3 rounded-full bg-primary ring-4 ring-primary/20 animate-pulse" />
                  <span className="absolute size-1.5 rounded-full bg-white dark:bg-slate-900" />
                </span>
              )}
            </TableCell>
          </TableRow>})}</TableBody>
        </Table>
      </details>;
    })}
  </div>;
}

function FieldTable({ fields, names, onInspect, activeEvidence }: InspectProps & { fields: Record<string, ExtractedField> }) {
  return <Table className="text-body-sm">
    <TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Value</TableHead><TableHead>Status</TableHead><TableHead>Evidence</TableHead></TableRow></TableHeader>
    <TableBody>{Object.entries(fields).map(([key, value]) => {
      const isRowActive = activeEvidence && value.evidence.some((e) => sourceKey(e) === sourceKey(activeEvidence));
      return (
        <TableRow
          key={key}
          data-connector-source={isRowActive ? "true" : undefined}
          className={cn("relative transition-colors", isRowActive && "bg-primary/8 dark:bg-primary/15 font-medium")}
        >
          <TableCell className="capitalize">{label(key)}</TableCell>
          <TableCell className="max-w-52 whitespace-normal break-words font-mono text-code-tabular data-[extracted=true]:border-l-2 data-[extracted=true]:border-l-tertiary" data-extracted={value.value !== null || undefined}>{[value.value, value.currency, value.unit].filter(Boolean).join(" ") || "—"}</TableCell>
          <TableCell><Status value={value.status} /></TableCell>
          <TableCell className="min-w-32 max-w-56 whitespace-normal relative">
            <EvidenceLinks items={value.evidence.slice(0, 6)} names={names} onInspect={onInspect} />
            {isRowActive && (
              <span aria-hidden className="pointer-events-none absolute -right-1.5 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center">
                <span className="size-3 rounded-full bg-primary ring-4 ring-primary/20 animate-pulse" />
                <span className="absolute size-1.5 rounded-full bg-white dark:bg-slate-900" />
              </span>
            )}
          </TableCell>
        </TableRow>
      );
    })}</TableBody>
  </Table>;
}

export function ExtractedFields({ analysis, names, onInspect, activeEvidence }: ReviewProps) {
  const extractions = analysis.extractions;
  if (!extractions.length) return <div className="p-3"><Empty>No extracted fields yet.</Empty></div>;
  return <div className="divide-y">{extractions.map((item) => <details key={`${item.document_id}-${item.role}`} open>
    <summary className="bg-muted px-3 py-2 text-label-md focus-visible:outline-offset-[-2px]">{label(item.role)} · {item.sheet ?? names.get(item.document_id)}{" "}<Status value={item.status} /></summary>
    {item.error && <p className="px-3 py-2 text-body-sm text-muted-foreground">{label(item.error)}</p>}
    <FieldTable fields={item.fields} names={names} onInspect={onInspect} activeEvidence={activeEvidence} />
  </details>)}</div>;
}

const documentRoles = ["invoice", "packing_list", "draft_bl"] as const;
const headerFields = [
  ["invoice_no", "Invoice no."], ["bl_no", "B/L no."], ["supplier", "Supplier"], ["shipper", "Shipper"],
  ["consignee", "Consignee"], ["vessel", "Vessel"], ["voyage", "Voyage"], ["container", "Container"],
  ["seal", "Seal"], ["origin", "Port of loading"], ["destination", "Port of discharge"],
  ["packages", "Packages"], ["gross_weight", "Gross weight"], ["net_weight", "Net weight"],
  ["amount", "Amount"], ["etd", "ETD"], ["eta", "ETA"],
] as const;

export function HeaderMatrix({ analysis, onInspect, activeEvidence }: Pick<ReviewProps, "analysis" | "onInspect" | "activeEvidence">) {
  const documents = documentRoles.map((role) => {
    const matches = analysis.extractions.filter((item) => item.role === role);
    return matches.length === 1 ? matches[0] : undefined;
  });
  if (!documents.some(Boolean)) return null;
  return <section aria-label="Header comparison" className="border-b">
    <div className="panel-heading"><h2 className="text-headline-sm">Header comparison</h2></div>
    <Table className="min-w-[540px] table-fixed text-body-sm">
      <colgroup><col className="w-28" /><col /><col /><col /><col className="w-26" /></colgroup>
      <TableHeader><TableRow><TableHead>Attribute</TableHead><TableHead>Invoice</TableHead><TableHead>Packing list</TableHead><TableHead>Draft B/L</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody>{headerFields.map(([key, title]) => {
        const fields = documents.map((document) => document?.fields[key]);
        if (!fields.some((field) => field?.value != null)) return null;
        const checks = analysis.findings.filter((item) => item.field === key &&
          (item.group === "transport" || item.key === `invoice_packing.${key}`));
        const outcome = checks.reduce<Finding["outcome"] | undefined>((worst, check) =>
          !worst || priority[check.outcome] < priority[worst] ? check.outcome : worst, undefined);
        const hasAnyValue = fields.some((f) => f?.value != null);
        const isRowActive = activeEvidence && fields.some(
          (field) => field?.evidence.some((e) => sourceKey(e) === sourceKey(activeEvidence))
        );
        return <TableRow
          key={key}
          data-connector-source={isRowActive ? "true" : undefined}
          className={cn(
            "relative transition-colors",
            isRowActive ? "bg-primary/8 dark:bg-primary/15 font-medium" : outcome === "MISMATCH" ? "bg-danger-fill/80 hover:bg-danger-fill" : outcome === "WARNING" ? "hover:bg-warning-fill/30" : undefined
          )}
        >
          <TableCell className="whitespace-normal font-medium">
            <span className="inline-flex items-center gap-1.5">
              {outcome === "PASS" && <CheckCircle2 size={13} className="text-success shrink-0" aria-hidden />}
              {outcome === "WARNING" && <AlertTriangle size={13} className="text-warning shrink-0" aria-hidden />}
              {outcome === "MISMATCH" && <XCircle size={13} className="text-danger shrink-0" aria-hidden />}
              {(!outcome || outcome === "NEEDS_REVIEW") && <HelpCircle size={13} className="text-muted-foreground shrink-0" aria-hidden />}
              <span>{title}</span>
            </span>
          </TableCell>
          {fields.map((field, index) => {
            const isFieldActive = activeEvidence && field?.evidence.some((e) => sourceKey(e) === sourceKey(activeEvidence));
            return (
              <TableCell key={documentRoles[index]} className="overflow-hidden font-mono text-code-tabular">
                {sourceCell(field, onInspect, undefined, hasAnyValue && !field?.value, isFieldActive)}
              </TableCell>
            );
          })}
          <TableCell className="relative">
            {outcome ? <Status value={outcome} /> : <span className="text-muted-foreground">—</span>}
            {isRowActive && (
              <span aria-hidden className="pointer-events-none absolute -right-1.5 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center">
                <span className="size-3 rounded-full bg-primary ring-4 ring-primary/20 animate-pulse" />
                <span className="absolute size-1.5 rounded-full bg-white dark:bg-slate-900" />
              </span>
            )}
          </TableCell>
        </TableRow>;
      })}</TableBody>
    </Table>
  </section>;
}

export function ExtractedLineDetails({ analysis, names, onInspect, activeEvidence }: ReviewProps) {
  const [open, setOpen] = useState(false);
  const sources = analysis.extractions.filter((doc) => doc.items.length > 0);
  if (!sources.length) return null;
  return <details className="border-t" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="panel-trigger text-primary">Extracted line details</summary>
    {open && sources.map((doc) => <div key={`${doc.document_id}:${doc.role}`} className="divide-y border-t">
      <h3 className="bg-muted px-3 py-2 text-label-md">{label(doc.role)} · {doc.sheet ?? names.get(doc.document_id)}</h3>
      {doc.items.map((item) => <LineDetails key={item.row} row={item.row} fields={item.fields} names={names} onInspect={onInspect} activeEvidence={activeEvidence} />)}
    </div>)}
  </details>;
}

function LineDetails({ row, fields, names, onInspect, activeEvidence }: InspectProps & { row: number; fields: Record<string, ExtractedField> }) {
  const [open, setOpen] = useState(false);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="panel-trigger break-words">Row {row} · {fields.description?.value ?? "Missing description"}</summary>
    {open && <FieldTable fields={fields} names={names} onInspect={onInspect} activeEvidence={activeEvidence} />}
  </details>;
}

const matrixColumns = ["Rows", "HS code / description", "Invoice qty", "Packing qty", "Delta", "Unit price", "Amount", "Status"];
const compactColumns = ["Rows", "HS / item", "Inv qty", "PL qty", "Delta", "Price", "Amount", "Status"];

function showField(value?: ExtractedField) {
  if (!value || value.value === null) return "—";
  const text = [value.value, value.currency, value.unit].filter(Boolean).join(" ");
  return value.status === "uncertain" ? `${text} (uncertain)` : text;
}

function sourceCell(field: ExtractedField | undefined, onInspect: InspectProps["onInspect"], shortValue?: string, otherPresent?: boolean, active?: boolean) {
  if (!field || field.value === null) {
    if (otherPresent) {
      return <span className="text-muted-foreground/60 italic text-xs">Not in doc</span>;
    }
    return <span className="text-muted-foreground">—</span>;
  }
  const fullValue = showField(field);
  const value = shortValue ?? fullValue;
  const evidence = field?.evidence[0];
  if (!evidence) return <span title={value} className="block truncate">{value}</span>;
  return <button type="button" onClick={() => onInspect(evidence)}
    className={cn(
      "data-link inline-block max-w-full cursor-pointer truncate rounded px-1 py-0.5 align-middle focus-visible:outline-offset-0 transition-colors",
      active ? "bg-primary/20 text-primary font-semibold ring-1 ring-primary/50" : "hover:bg-intelligence-fill hover:text-intelligence"
    )}
    title={`${shortValue && shortValue !== fullValue ? `${shortValue} (${fullValue})` : value} · ${location(evidence)} (Click to view source)`}>{value}</button>;
}

function formatDelta(line: LineComparison) {
  if (line.quantity_delta === null) return "—";
  const plus = line.quantity_delta === "0" || line.quantity_delta.startsWith("-") ? "" : "+";
  return `${plus}${line.quantity_delta} ${line.delta_unit ?? ""}`.trim();
}

export function CargoMatrix({ analysis, onInspect, onHover, activeEvidence }: {
  analysis: ReviewAnalysis;
  onInspect: InspectProps["onInspect"];
  onHover: (evidence?: Evidence) => void;
  activeEvidence?: Evidence;
}) {
  const [filter, setFilter] = useState("all");
  const [requestedOffset, setOffset] = useState(0);
  const invoice = new Map(analysis.extractions.find((doc) => doc.role === "invoice")?.items.map((item) => [item.row, item.fields]));
  const packing = new Map(analysis.extractions.find((doc) => doc.role === "packing_list")?.items.map((item) => [item.row, item.fields]));
  const allLines = analysis.line_items ?? [];
  const rows = allLines.filter((line) => filter === "all" || line.outcome !== "PASS").map((line) => {
    const inv = invoice.get(line.invoice_row ?? 0);
    const pkg = packing.get(line.packing_row ?? 0);
    const description = inv?.english_description?.value ? inv.english_description : inv?.description ?? pkg?.description;
    const hsCode = inv?.hs_code?.value ?? pkg?.hs_code?.value;
    const title = [hsCode, description?.value ?? "Missing description"].filter(Boolean).join(" · ");
    const numbers = [inv?.quantity, pkg?.quantity, inv?.unit_price, inv?.amount];
    const source = `${line.invoice_row ?? "—"} / ${line.packing_row ?? "—"}`;
    const delta = formatDelta(line);
    return { line, description, title, numbers, source, delta };
  });
  const offset = Math.min(requestedOffset, lastPageOffset(rows.length));
  const visibleRows = rows.slice(offset, offset + pageSize);

  function exportRows() {
    const safeCell = (value: string) => {
      // Treat source strings as text when a spreadsheet opens the export.
      const text = /^[\s\uFEFF]*[=+@-]/.test(value) ? `'${value}` : value;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const values = rows.map(({ line, source, title, numbers, delta }) => [
      source, title, showField(numbers[0]), showField(numbers[1]), delta, showField(numbers[2]),
      showField(numbers[3]), label(line.outcome),
    ]);
    const url = URL.createObjectURL(new Blob(
      ["\uFEFF", [matrixColumns, ...values].map((row) => row.map(safeCell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ));
    const link = document.createElement("a");
    link.href = url;
    link.download = "cargo-comparison.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section aria-label="Cargo line items">
    <div className="panel-heading">
      <div>
        <h2 className="text-headline-sm">Cargo line items</h2>
        <p className="text-body-sm text-muted-foreground">Delta = packing − invoice.</p>
      </div>
      <div className="flex items-center gap-2">
        <NativeSelect aria-label="Filter cargo rows" value={filter} onChange={(event) => { setFilter(event.target.value); setOffset(0); }}>
          <option value="all">All lines</option>
          <option value="issues">Issues only</option>
        </NativeSelect>
        <Button type="button" size="sm" variant="outline" onClick={exportRows} disabled={!rows.length}>
          <Download aria-hidden /> Export CSV
        </Button>
      </div>
    </div>
    {rows.length ? <Table className="min-w-[550px] table-fixed text-body-sm [&_td]:px-1.5 [&_th]:px-1.5">
      <colgroup>
        <col className="w-14" /><col /><col className="w-14" /><col className="w-14" />
        <col className="w-14" /><col className="w-21" /><col className="w-21" /><col className="w-21" />
      </colgroup>
      <TableHeader className="bg-background"><TableRow>
        {matrixColumns.map((column, index) => <TableHead key={column} title={column} aria-label={column}
          className={index > 1 && index < 7 ? "text-right" : undefined}>{compactColumns[index]}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>{visibleRows.map(({ line, source, description, title, numbers, delta }) => {
        const isRowActive = Boolean(
          activeEvidence && (
            (line.invoice_row != null && activeEvidence.row === line.invoice_row) ||
            (line.packing_row != null && activeEvidence.row === line.packing_row) ||
            [description, ...numbers].some((f) => f?.evidence.some((e) => sourceKey(e) === sourceKey(activeEvidence)))
          )
        );
        return (
          <TableRow
            key={source}
            data-connector-source={isRowActive ? "true" : undefined}
            onMouseEnter={() => onHover(description?.evidence[0])}
            onMouseLeave={() => onHover()}
            className={cn(
              "relative transition-colors",
              isRowActive
                ? "bg-primary/8 dark:bg-primary/15 font-medium"
                : line.outcome === "MISMATCH"
                ? "bg-danger-fill hover:bg-danger-fill"
                : undefined
            )}
          >
            <TableCell className="truncate font-mono text-code-tabular text-muted-foreground" title={source}>{source.replace(" / ", "/")}</TableCell>
            <TableCell className="max-w-40 font-mono text-code-tabular">
              {sourceCell(
                description,
                onInspect,
                title,
                undefined,
                activeEvidence && description?.evidence.some((e) => sourceKey(e) === sourceKey(activeEvidence))
              )}
            </TableCell>
            <TableCell className="max-w-24 text-right font-mono text-code-tabular">
              {sourceCell(
                numbers[0],
                onInspect,
                undefined,
                undefined,
                activeEvidence && numbers[0]?.evidence.some((e) => sourceKey(e) === sourceKey(activeEvidence))
              )}
            </TableCell>
            <TableCell className="max-w-24 text-right font-mono text-code-tabular">
              {sourceCell(
                numbers[1],
                onInspect,
                undefined,
                undefined,
                activeEvidence && numbers[1]?.evidence.some((e) => sourceKey(e) === sourceKey(activeEvidence))
              )}
            </TableCell>
            <TableCell className="truncate text-right font-mono text-code-tabular" title={delta}>{delta}</TableCell>
            <TableCell className="max-w-28 text-right font-mono text-code-tabular">
              {sourceCell(
                numbers[2],
                onInspect,
                numbers[2]?.status === "present" && numbers[2].value
                  ? [numbers[2].value, numbers[2].currency].filter(Boolean).join(" ")
                  : undefined,
                undefined,
                activeEvidence && numbers[2]?.evidence.some((e) => sourceKey(e) === sourceKey(activeEvidence))
              )}
            </TableCell>
            <TableCell className="max-w-28 text-right font-mono text-code-tabular">
              {sourceCell(
                numbers[3],
                onInspect,
                undefined,
                undefined,
                activeEvidence && numbers[3]?.evidence.some((e) => sourceKey(e) === sourceKey(activeEvidence))
              )}
            </TableCell>
            <TableCell className="relative [&_svg]:hidden">
              <Status value={line.outcome} />
              {isRowActive && (
                <span aria-hidden className="pointer-events-none absolute -right-1.5 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center">
                  <span className="size-3 rounded-full bg-primary ring-4 ring-primary/20 animate-pulse" />
                  <span className="absolute size-1.5 rounded-full bg-white dark:bg-slate-900" />
                </span>
              )}
            </TableCell>
          </TableRow>
        );
      })}</TableBody>
    </Table> : <div className="p-3"><Empty>{allLines.length ? "No cargo rows match this filter." : "No unambiguous line comparison is available. Check the extracted fields and source documents."}</Empty></div>}
    <Pagination label="Cargo lines" offset={offset} count={visibleRows.length} total={rows.length}
      previous={offset > 0 ? () => { onHover(); setOffset(offset - pageSize); } : undefined}
      next={offset + pageSize < rows.length ? () => { onHover(); setOffset(offset + pageSize); } : undefined} />
  </section>;
}

export function CandidateTable({ analysis, names, onInspect, activeEvidence }: ReviewProps) {
  const [requestedOffset, setOffset] = useState(0);
  const total = analysis.candidates.length;
  const offset = Math.min(requestedOffset, lastPageOffset(total));
  const candidates = analysis.candidates.slice(offset, offset + pageSize);
  return <section className="border-t">
    <div className="panel-heading">
      <h2 className="text-headline-sm">CDC candidates</h2>
      {analysis.analyzed_master && <a className="data-link text-label-md"
        href={`/api/v1/cdc/versions/${analysis.analyzed_master.id}/download`}>Download CDC original</a>}
    </div>
    {candidates.length ? <Table className="text-body-sm">
      <TableHeader><TableRow><TableHead>Invoice row</TableHead><TableHead>CDC description</TableHead><TableHead>Similarity</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
      <TableBody>{candidates.map((item) => {
        const isRowActive = activeEvidence && sourceKey(item.evidence) === sourceKey(activeEvidence);
        return (
          <TableRow
            key={`${item.invoice_document_id}-${item.invoice_row}-${item.master_row}`}
            data-connector-source={isRowActive ? "true" : undefined}
            className={cn("relative transition-colors", isRowActive && "bg-primary/8 dark:bg-primary/15 font-medium")}
          >
            <TableCell>{item.invoice_row}</TableCell>
            <TableCell className="whitespace-normal">{item.description}</TableCell>
            <TableCell className="font-mono text-code-tabular text-intelligence">{item.score.toFixed(1)}%</TableCell>
            <TableCell className="whitespace-normal relative">
              <EvidenceLinks items={[item.evidence]} names={names} onInspect={onInspect} />
              {isRowActive && (
                <span aria-hidden className="pointer-events-none absolute -right-1.5 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center">
                  <span className="size-3 rounded-full bg-primary ring-4 ring-primary/20 animate-pulse" />
                  <span className="absolute size-1.5 rounded-full bg-white dark:bg-slate-900" />
                </span>
              )}
              {analysis.analyzed_master && <Link
                href={`/cdc?version=${analysis.analyzed_master.id}&q=${item.master_row}`}
                className="mt-1 block text-body-sm text-muted-foreground hover:text-primary hover:underline">
                View workbook limits
              </Link>}
            </TableCell>
          </TableRow>
        );
      })}</TableBody>
    </Table> : <div className="p-3"><Empty>No candidates in this analysis.</Empty></div>}
    <Pagination label="CDC candidates" offset={offset} count={candidates.length} total={total}
      previous={offset > 0 ? () => setOffset(offset - pageSize) : undefined}
      next={offset + pageSize < total ? () => setOffset(offset + pageSize) : undefined} />
  </section>;
}

export function AdvisoryPanel({ analysis }: { analysis: ReviewAnalysis }) {
  return <div className="space-y-2 p-3 text-xs">
    <div className="flex flex-wrap items-center gap-2"><Sparkles size={14} className="text-tertiary" aria-hidden />
      {analysis.ai_state ? <Status value={analysis.ai_state} /> : <span>Pending analysis</span>}
      {analysis.ai_model && <span className="font-mono text-muted-foreground">{analysis.ai_model}</span>}
    </div>
    {(analysis.ai_state === "unavailable" || analysis.ai_state === "invalid_output") && <p>Review the comparison findings or retry the AI run in Automation.</p>}
    {analysis.ai_suggestions.length > 0 && <ul className="space-y-2">{analysis.ai_suggestions.map((item) => <li key={item.finding_key} className="rounded-control border border-intelligence-border border-l-2 border-l-tertiary bg-intelligence-fill p-2.5">
      <p className="font-semibold capitalize">{label(item.suggested_action)} · {label(item.relationship)}</p>
      <p className="mt-1 break-words">{item.explanation}</p>
      <p className="mt-1 break-all font-mono text-muted-foreground">{item.finding_key}</p>
    </li>)}</ul>}
  </div>;
}
