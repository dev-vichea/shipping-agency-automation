"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { write } from "@/lib/client-api";

const columns = ["description", "unit", "approved_quantity", "serial", "item_code", "hs_code", "specification", "unit_price", "approved_value", "remaining_quantity", "remaining_value"];
type Sheet = { name: string; rows: { row: number; cells: string[] }[] };
export type WorkbookSelection = { sheet: string; header_row: number; columns: Record<string, number>; currency?: string };

export function CdcWorkbookMapping({ workbook, onChange }: {
  workbook: File; onChange: (selection: WorkbookSelection | undefined, invalid: boolean) => void;
}) {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [selection, setSelection] = useState<WorkbookSelection>({ sheet: "", header_row: 1, columns: {} });
  useEffect(() => {
    const controller = new AbortController();
    const data = new FormData(); data.set("file", workbook);
    void write<Sheet[]>("/cdc/versions/worksheets", data, controller.signal).then((result) => {
      if (!controller.signal.aborted) setSheets(result);
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [workbook]);
  function update(next: WorkbookSelection, active = enabled) {
    setSelection(next);
    const valid = !!next.sheet && ["description", "unit", "approved_quantity"].every((key) => !!next.columns[key]) &&
      new Set(Object.values(next.columns)).size === Object.keys(next.columns).length;
    onChange(active && valid ? next : undefined, active && !valid);
  }
  const sheet = sheets.find((entry) => entry.name === selection.sheet);
  const header = sheet?.rows.find((entry) => entry.row === selection.header_row);
  const width = Math.max(0, ...(sheet?.rows.map((entry) => entry.cells.length) ?? []));
  return <section className="space-y-3 rounded-lg border p-3 text-xs" aria-label="Worksheet and column mapping">
    <label className="flex gap-2 font-medium"><input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); update(selection, event.target.checked); }} />Choose worksheet and map columns</label>
    <p className="text-muted-foreground">Leave off to use the existing CDC template reader. Mapped imports save the exact worksheet, columns, and original file as a separate version.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {enabled && <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1">CDC worksheet<NativeSelect value={selection.sheet} onChange={(event) => update({ ...selection, sheet: event.target.value, columns: {} })}><option value="">Choose worksheet</option>{sheets.map((entry) => <option key={entry.name}>{entry.name}</option>)}</NativeSelect></label>
      <label className="grid gap-1">Header row<Input type="number" min={1} max={4999} value={selection.header_row} onChange={(event) => update({ ...selection, header_row: Number(event.target.value) })} /></label>
      {columns.map((key) => <label className="grid gap-1" key={key}>{key.replaceAll("_", " ")}{["description", "unit", "approved_quantity"].includes(key) ? " *" : ""}
        <NativeSelect value={selection.columns[key] ?? ""} onChange={(event) => { const mapped = { ...selection.columns }; if (event.target.value) mapped[key] = Number(event.target.value); else delete mapped[key]; update({ ...selection, columns: mapped }); }}>
          <option value="">Not mapped</option>{Array.from({ length: width }, (_, index) => <option key={index} value={index + 1}>Column {index + 1} · {header?.cells[index] || "(no heading)"}</option>)}
        </NativeSelect>
      </label>)}
      <label className="grid gap-1">Price / value currency<NativeSelect value={selection.currency ?? ""} onChange={(event) => update({ ...selection, currency: event.target.value || undefined })}><option value="">Read from headings; unknown if absent</option>{["USD", "CNY", "KHR", "EUR", "THB", "JPY", "GBP"].map((code) => <option key={code}>{code}</option>)}</NativeSelect></label>
      {!!sheet && <details className="sm:col-span-2"><summary className="cursor-pointer">Preview original worksheet rows</summary><div className="max-h-40 overflow-auto"><table><tbody>{sheet.rows.slice(selection.header_row - 1, selection.header_row + 5).map((row) => <tr key={row.row}><th className="p-1">{row.row}</th>{row.cells.map((cell, index) => <td key={index} className="max-w-48 truncate border p-1" title={cell}>{cell}</td>)}</tr>)}</tbody></table></div></details>}
    </div>}
  </section>;
}
