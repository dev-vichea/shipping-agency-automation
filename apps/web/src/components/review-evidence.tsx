import { Empty, Section, Status } from "@/components/workspace";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Document, Evidence, ExtractedField, Finding, ReviewAnalysis } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";

export function location(item: Evidence) {
  if (item.sheet) return [item.sheet, item.cell || (item.row && `Row ${item.row}`)].filter(Boolean).join(" · ");
  return [item.page && `Page ${item.page}`, item.line && `Line ${item.line}`].filter(Boolean).join(" · ") || "Source";
}

function sourceKey(item: Evidence) {
  return [item.document_id, item.sheet, item.cell, item.page, item.line, item.row].join(":");
}

function evidenceList(items: Evidence[], names: Map<string, string>) {
  return [...new Map(items.map((item) => [sourceKey(item), item])).values()].map((item) =>
    <div className="break-words text-xs text-muted-foreground" key={sourceKey(item)}>
      <a href={`#source-${item.document_id}`} className="font-medium text-primary hover:underline">{names.get(item.document_id) ?? "Source"} · {location(item)}</a>
      {item.raw && <p className="whitespace-pre-wrap">{item.raw}</p>}
    </div>
  );
}

function fieldValue(item: ExtractedField) {
  return [item.value, item.currency, item.unit].filter(Boolean).join(" ") || "—";
}

function FieldTable({ fields, names }: { fields: Record<string, ExtractedField>; names: Map<string, string> }) {
  return <Table>
    <TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Value</TableHead><TableHead>Status</TableHead><TableHead>Evidence</TableHead></TableRow></TableHeader>
    <TableBody>{Object.entries(fields).map(([key, value]) => <TableRow key={key}>
      <TableCell className="capitalize">{label(key)}</TableCell>
      <TableCell className="max-w-52 whitespace-normal break-words">{fieldValue(value)}</TableCell>
      <TableCell><Status value={value.status} /></TableCell>
      <TableCell className="min-w-36 max-w-52 space-y-1 whitespace-normal">{evidenceList(value.evidence.slice(0, 6), names)}</TableCell>
    </TableRow>)}</TableBody>
  </Table>;
}

const groups: Record<string, string> = {
  extraction: "Document coverage",
  invoice_packing: "Invoice vs packing list",
  transport: "Draft B/L checks",
  cdc: "CDC Master List checks",
};
const priority: Record<Finding["outcome"], number> = { MISMATCH: 0, NEEDS_REVIEW: 1, WARNING: 2, PASS: 3 };

export function ReviewEvidence({ analysis, documents }: { analysis: ReviewAnalysis; documents: Document[] }) {
  const names = new Map(documents.map((document) => [document.id, document.original_filename]));
  if (analysis.analyzed_master) names.set(analysis.analyzed_master.source_id, analysis.analyzed_master.original_filename);
  const findings = [...analysis.findings].sort((left, right) => priority[left.outcome] - priority[right.outcome]);
  const master = analysis.analyzed_master;
  return <>
    <section aria-label="Document evidence and comparisons" className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Section title="Source documents">
        {documents.length === 0 && <Empty>No attachments on this intake.</Empty>}
        <div className="divide-y">
          {documents.map((document) => {
            const views = analysis.extractions.filter((item) => item.document_id === document.id);
            return <div id={`source-${document.id}`} key={document.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="break-all text-sm font-medium">{document.original_filename}</p>
                <a className="text-xs font-medium text-primary hover:underline" aria-label={`Download ${document.original_filename}`}
                  href={`/api/v1/documents/${document.id}/download`}>Download original</a>
              </div>
              {document.parent_version_id && <a href={`#source-${document.parent_version_id}`} className="text-xs text-primary hover:underline">View previous version</a>}
              {views.length === 0 && <p className="text-xs text-muted-foreground">No extraction in this analysis.</p>}
              {views.map((view) => <details key={view.role} className="rounded-md border">
                <summary className="cursor-pointer px-3 py-2 text-sm">{label(view.role)} source excerpt</summary>
                <div className="max-h-80 overflow-auto border-t p-3 text-xs">
                  {view.source_excerpt.length ? view.source_excerpt.map((item) => <p className="mb-2 break-words" key={sourceKey(item)}>
                    <strong>{location(item)}</strong> {item.raw}
                  </p>) : <p>No readable source excerpt.</p>}
                </div>
              </details>)}
            </div>;
          })}
          {master && <div id={`source-${master.source_id}`} className="p-4 text-sm">
            <p className="font-medium">CDC workbook · {master.approval_ref}</p>
            <p className="my-1 break-all text-xs text-muted-foreground">{master.original_filename}</p>
            <a className="text-xs font-medium text-primary hover:underline" href={`/api/v1/cdc/versions/${master.id}/download`}>Download CDC original</a>
          </div>}
        </div>
      </Section>
      <div className="min-w-0 space-y-5">
        <Section title="Comparison findings">
          {analysis.outcome ? <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Status value={analysis.outcome} />
              <span className="text-xs text-muted-foreground">Rules {analysis.rules_version} · {timestamp(analysis.extracted_at)}</span>
              {analysis.analysis_revision !== analysis.revision && <Status value="previous_analysis" />}
            </div>
            {Object.entries(groups).map(([key, title]) => {
              const rows = findings.filter((item) => item.group === key);
              return rows.length > 0 && <details key={key} open={rows.some((item) => item.outcome === "MISMATCH")} className="rounded-md border">
                <summary className="cursor-pointer p-3 text-sm font-medium">{title} <span className="ml-1 text-xs text-muted-foreground">({rows.length})</span></summary>
                <Table>
                  <TableHeader><TableRow><TableHead>Check</TableHead><TableHead>Outcome</TableHead><TableHead>Values and evidence</TableHead></TableRow></TableHeader>
                  <TableBody>{rows.map((item) => <TableRow key={item.key}>
                    <TableCell className="capitalize">{label(item.field)}</TableCell>
                    <TableCell><Status value={item.outcome} /></TableCell>
                    <TableCell className="min-w-44 max-w-md space-y-1 whitespace-normal break-words">
                      <p>{item.explanation}</p>
                      {(item.left || item.right) && <p className="font-medium">{item.left ?? "—"} / {item.right ?? "—"}</p>}
                      {evidenceList(item.evidence, names)}
                    </TableCell>
                  </TableRow>)}</TableBody>
                </Table>
              </details>;
            })}
          </div> : <Empty>{analysis.state === "failed" ? "Analysis failed. Open Automation to retry." : "Analysis is queued. Refresh to check for findings."}</Empty>}
        </Section>
        <Section title="Extracted fields">
          {analysis.extractions.length ? <div className="divide-y">{analysis.extractions.map((item) =>
            <details key={`${item.document_id}-${item.role}`}>
              <summary className="cursor-pointer p-4 text-sm font-medium">
                {label(item.role)} · {item.sheet ?? names.get(item.document_id)}{" "}<Status value={item.status} />
              </summary>
              {item.error && <p className="px-4 py-2 text-sm text-muted-foreground">{label(item.error)}</p>}
              <FieldTable fields={item.fields} names={names} />
              {item.items.length > 0 && <div className="divide-y border-t">
                {item.items.map((row) => <details key={row.row}>
                  <summary className="cursor-pointer px-4 py-2 text-sm">Row {row.row} · {row.fields.description?.value ?? "Missing description"}</summary>
                  <FieldTable fields={row.fields} names={names} />
                </details>)}
              </div>}
            </details>)}</div> : <Empty>No extracted values yet.</Empty>}
        </Section>
      </div>
    </section>
    {analysis.candidates.length > 0 && <Section title="CDC candidates">
      <Table>
        <TableHeader><TableRow><TableHead>Invoice row</TableHead><TableHead>CDC description</TableHead><TableHead>Similarity</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
        <TableBody>{analysis.candidates.map((item) => <TableRow key={`${item.invoice_document_id}-${item.invoice_row}-${item.master_row}`}>
          <TableCell>{item.invoice_row}</TableCell><TableCell className="whitespace-normal">{item.description}</TableCell>
          <TableCell>{item.score.toFixed(1)}%</TableCell><TableCell>{evidenceList([item.evidence], names)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </Section>}
    {analysis.ai_state && <Section title="AI suggestions">
      <div className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap gap-2"><Status value={analysis.ai_state} />
          {analysis.ai_model && <span className="text-muted-foreground">{analysis.ai_model} · {analysis.ai_prompt_version}</span>}
        </div>
        {analysis.ai_state === "unavailable" || analysis.ai_state === "invalid_output"
          ? <p>AI suggestions are unavailable. Review the deterministic findings or retry the AI run in Automation.</p> : null}
        {analysis.ai_state === "pending" && <p>AI suggestions are queued. Document findings are available now.</p>}
        {analysis.ai_suggestions.length > 0 && <ul className="space-y-3">{analysis.ai_suggestions.map((item) => <li key={item.finding_key} className="rounded-md border p-3">
          <p className="font-medium capitalize">{label(item.suggested_action)} · {label(item.relationship)}</p>
          <p className="mt-1 break-words">{item.explanation}</p>
          <p className="mt-1 text-xs text-muted-foreground">Finding: {item.finding_key}</p>
        </li>)}</ul>}
      </div>
    </Section>}
  </>;
}
