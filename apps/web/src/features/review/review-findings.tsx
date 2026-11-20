import { ChevronDown, Sparkles } from "lucide-react";
import { Empty, Status } from "@/components/ui/page-layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Evidence, Finding, ReviewAnalysis } from "@/lib/contracts";
import { label, location } from "@/lib/format";
import { cn } from "@/lib/utils";

type InspectProps = { names: Map<string, string>; onInspect: (evidence: Evidence) => void; activeEvidence?: Evidence };
type ReviewProps = InspectProps & { analysis: ReviewAnalysis };

export function sourceKey(item: Evidence) {
  return [item.document_id, item.sheet, item.cell, item.page, item.line, item.row, item.bbox?.join(",")].join(":");
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
