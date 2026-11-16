"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { useEffect, useRef, useState } from "react";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Evidence } from "@/lib/contracts";

type Worksheet = { sheets: string[]; sheet: string; total: number; columns: string[]; rows: { number: number; values: string[] }[] };
const previewPageSize = 25;

export function WorkbookPreview({ id, defaultSheet, evidence }: { id: string; defaultSheet: string | null; evidence?: Evidence }) {
  const [sheet, setSheet] = useState(defaultSheet ?? "");
  const [offset, setOffset] = useState(0);
  const [prevEvidence, setPrevEvidence] = useState<{ sheet?: string | null; row?: number | null }>({
    sheet: evidence?.sheet,
    row: evidence?.row,
  });

  if (evidence && (evidence.sheet !== prevEvidence.sheet || evidence.row !== prevEvidence.row)) {
    setPrevEvidence({ sheet: evidence.sheet, row: evidence.row });
    if (evidence.sheet && evidence.sheet !== sheet) {
      setSheet(evidence.sheet);
    }
    if (evidence.row != null) {
      const targetOffset = Math.floor(Math.max(0, evidence.row - 1) / previewPageSize) * previewPageSize;
      if (targetOffset !== offset) {
        setOffset(targetOffset);
      }
    }
  }

  const [loaded, setLoaded] = useState<{ id: string; sheet: string; offset: number; data: Worksheet }>();
  const [error, setError] = useState("");
  const activeRowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const pending = new AbortController();
    const query = new URLSearchParams({ offset: String(offset) });
    if (sheet) query.set("sheet", sheet);
    fetch(`/api/v1/documents/${id}/workbook?${query}`, { signal: pending.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("This worksheet could not be previewed. Download the original to inspect it.");
        return response.json() as Promise<Worksheet>;
      })
      .then((data) => {
        if (!pending.signal.aborted) {
          setLoaded({ id, sheet, offset, data });
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (!pending.signal.aborted) setError(cause instanceof Error ? cause.message : "Worksheet unavailable.");
      });
    return () => pending.abort();
  }, [id, sheet, offset]);

  useEffect(() => {
    if (evidence?.row && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [loaded, evidence?.row]);

  if (error) return <p role="alert" className="field-error m-3">{error}</p>;
  if (!loaded || loaded.id !== id) return <p role="status" className="p-4 text-muted-foreground">Loading worksheet…</p>;
  const { data, offset: loadedOffset } = loaded;
  const pending = loaded.sheet !== sheet || loadedOffset !== offset;
  return <div className="min-w-0" aria-busy={pending}>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2.5">
      <label className="flex min-w-0 items-center gap-2 text-xs">Worksheet
        <NativeSelect className="control max-w-40" value={sheet || data.sheet} onChange={(event) => { setSheet(event.target.value); setOffset(0); }}>
          {data.sheets.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </NativeSelect>
      </label>
      {pending && <span role="status" className="text-xs text-muted-foreground">Loading rows…</span>}
      {evidence?.row && <span className="text-xs font-mono text-intelligence">Target: Row {evidence.row}</span>}
    </div>
    <Pagination label="Worksheet rows" offset={loadedOffset} count={data.rows.length} total={data.total} pending={pending}
      previous={loadedOffset > 0 ? () => setOffset(loadedOffset - previewPageSize) : undefined}
      next={loadedOffset + previewPageSize < data.total ? () => setOffset(loadedOffset + previewPageSize) : undefined} />
    <div className="max-h-[48vh] overflow-y-auto">
      <Table className="text-xs">
        <TableHeader><TableRow><TableHead>Row</TableHead>{data.columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{data.rows.map((row) => {
          const isTarget = evidence?.row === row.number;
          return <TableRow key={row.number} ref={isTarget ? activeRowRef : undefined}
            className={isTarget ? "bg-intelligence-fill border-l-4 border-l-primary font-medium" : undefined}>
            <TableCell className={isTarget ? "font-bold text-primary font-mono" : "text-muted-foreground"}>{row.number}</TableCell>
            {data.columns.map((column, index) => <TableCell key={column} className="max-w-44 truncate" title={row.values[index]}>{row.values[index]}</TableCell>)}
          </TableRow>;
        })}</TableBody>
      </Table>
    </div>
  </div>;
}
