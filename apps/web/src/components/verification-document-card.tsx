"use client";

import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CheckCheck, ChevronDown, FileText, History } from "lucide-react";
import { ReviewActions } from "@/components/review-actions";
import { VerificationCardSkeleton } from "@/components/verification-skeleton";
import { VerificationCdcCleanOptions } from "@/components/verification-cdc-row";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/lib/toast";
import type {
  CaseDetail,
  ExtractedField,
  Extraction,
  Finding,
  MasterVersion,
  ReviewAnalysis,
  ReviewField,
  StaffReview,
} from "@/lib/contracts";
import { documentFieldLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const fullWidthHeaderFields = new Set([
  "supplier",
  "supplier_address",
  "consignee",
  "consignee_address",
  "origin",
  "destination",
  "delivery",
  "discharge",
  "description",
  "cargo_summary",
  "remark",
]);

const editableTotals = new Set(["amount", "packages", "net_weight", "gross_weight", "measurement"]);

function columnPixelWidth(name: string): number {
  switch (name) {
    case "#":
      return 48;
    case "description":
      return 320;
    case "english_description":
      return 220;
    case "specification":
      return 180;
    case "item_code":
      return 110;
    case "hs_code":
      return 110;
    case "unit":
      return 80;
    case "packages":
      return 130;
    case "quantity":
      return 135;
    case "unit_price":
      return 125;
    case "amount":
      return 160;
    case "net_weight":
      return 145;
    case "gross_weight":
      return 145;
    case "measurement":
      return 130;
    default:
      return 110;
  }
}

function minColumnPixelWidth(name: string): number {
  if (name === "#") return 36;
  if (name === "unit") return 50;
  if (name === "description") return 120;
  return 60;
}

function tableColumnLabel(name: string, role?: string) {
  switch (name) {
    case "item_code":
      return "Code";
    case "hs_code":
      return "HS Code";
    case "description":
      return role === "invoice" ? "No. & Description" : "Description";
    case "english_description":
      return "English Description";
    case "specification":
      return "Specification";
    case "quantity":
      return "Quantity";
    case "unit":
      return "Unit";
    case "unit_price":
      return "Unit Price";
    case "amount":
      return "Amount";
    case "packages":
      return "Packages";
    case "net_weight":
      return "Net Wt";
    case "gross_weight":
      return "Gross Wt";
    case "measurement":
      return "CBM";
    default:
      return documentFieldLabel(name);
  }
}

function VerificationDescriptionWithCdc({
  line,
  document,
  role,
  options,
  otherCandidates,
  master,
  review,
  disabled,
  fieldEditor,
  onSelectCandidate,
  onClearCandidate,
}: {
  line: Extraction["items"][number];
  document: Extraction;
  role: "invoice" | "packing_list";
  options: ReviewAnalysis["candidates"];
  otherCandidates?: ReviewAnalysis["candidates"];
  master?: MasterVersion | null;
  review: StaffReview | null;
  disabled: boolean;
  fieldEditor: (ref: ReviewField, raw: ExtractedField, compact?: boolean) => React.ReactNode;
  onSelectCandidate: (row: number, candidate: ReviewAnalysis["candidates"][number], reason?: string) => Promise<void>;
  onClearCandidate: (row: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const rawField = line.fields.description ?? {
    status: "missing",
    value: "",
    confidence: 1,
    evidence: [],
  };

  const mapping = review?.mappings.find((m) => m.invoice_row === line.row);
  const selectedCandidate = mapping
    ? options.find((c) => c.master_row === mapping.master_row)
    : options[0];
  const cdcSerial = selectedCandidate?.serial ?? mapping?.master_row;

  return (
    <VerificationCdcCleanOptions
      row={line.row}
      candidates={options}
      otherCandidates={otherCandidates}
      master={master}
      review={review}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
      onSelectCandidate={async (candidate, reason) => {
        if (typeof window !== "undefined") {
          const el = window.document.getElementById(
            `verify-${role}-${line.row}-description`
          ) as HTMLTextAreaElement | HTMLInputElement | null;
          if (el) {
            el.value = candidate.description;
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
        await onSelectCandidate(line.row, candidate, reason);
      }}
      onClearMapping={async () => {
        await onClearCandidate(line.row);
      }}
    >
      <div
        data-cdc-anchor={line.row}
        className="w-full min-w-0 relative flex items-center gap-1.5"
        onFocus={() => {
          setOpen(true);
        }}
        onClick={() => {
          setOpen(true);
        }}
      >
        {cdcSerial ? (
          <button
            type="button"
            title={`CDC Item #${cdcSerial} (${selectedCandidate?.description ?? "Mapped"}) · Click to change`}
            onClick={(e) => {
              e.stopPropagation();
              if (options.length > 0) setOpen((prev) => !prev);
            }}
            className="shrink-0 flex items-center justify-center px-1 text-xs text-foreground hover:text-primary transition-colors select-none cursor-pointer leading-snug"
          >
            {cdcSerial}
          </button>
        ) : null}
        <div className="flex-1 min-w-0">
          {fieldEditor(
            { document_id: document.document_id, role, row: line.row, name: "description" },
            rawField,
            true
          )}
        </div>
        <button
          type="button"
          aria-label="Review CDC material"
          title="Review CDC material"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
          className={cn(
            "shrink-0 p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-muted/60 transition-colors cursor-pointer flex items-center",
            options.length > 0 ? "text-primary/70" : "opacity-40 hover:opacity-100"
          )}
        >
          <ChevronDown className="size-3" />
        </button>
      </div>
    </VerificationCdcCleanOptions>
  );
}

export interface VerificationDocumentCardProps {
  role: "invoice" | "packing_list";
  onRoleChange: (role: "invoice" | "packing_list") => void;
  document?: Extraction;
  documents: Extraction[];
  original?: CaseDetail["documents"][number];
  chosenDocument?: string;
  onSelectDocument: (docKey: string) => void;
  analysis: ReviewAnalysis;
  item: CaseDetail;
  review: StaffReview | null;
  master?: MasterVersion | null;
  versions: MasterVersion[];
  admin: boolean;
  disabled: boolean;
  pending: number;
  error?: string;
  dirtyCount: number;
  autosave: boolean;
  onAutosaveChange: (val: boolean) => void;
  suggestions: boolean;
  onSuggestionsChange: (val: boolean) => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  activeField?: ReviewField;
  onInspect: (ref: ReviewField) => void;
  fields: string[];
  columns: string[];
  columnWeight?: (name: string) => number;
  columnWeights?: number;
  fieldEditor: (ref: ReviewField, raw: ExtractedField, compact?: boolean) => React.ReactNode;
  total: (key: string) => string;
  quotaChecks: Finding[];
  blockerCount: number;
  onSelectCandidate: (row: number, candidate: ReviewAnalysis["candidates"][number], reason?: string) => Promise<void>;
  onClearCandidate: (row: number) => Promise<void>;
}

function subscribeColWidths(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getColWidthsSnapshot(): string {
  try {
    const inv = localStorage.getItem("shipping_col_widths_invoice") ?? "{}";
    const pl = localStorage.getItem("shipping_col_widths_packing_list") ?? "{}";
    return `${inv}|${pl}`;
  } catch {
    return "{}|{}";
  }
}

function getColWidthsServerSnapshot(): string {
  return "{}|{}";
}

export function VerificationDocumentCard({
  role,
  onRoleChange,
  document,
  documents,
  original,
  onSelectDocument,
  analysis,
  item,
  review,
  master,
  versions,
  admin,
  disabled,
  pending,
  error,
  dirtyCount,
  autosave,
  onAutosaveChange,
  suggestions,
  onSuggestionsChange,
  historyOpen,
  onToggleHistory,
  activeField,
  onInspect,
  fields,
  columns,
  fieldEditor,
  total,
  quotaChecks,
  blockerCount,
  onSelectCandidate,
  onClearCandidate,
}: VerificationDocumentCardProps) {
  const invoiceNo =
    analysis.extractions.find((e) => e.role === "invoice")?.fields.invoice_no?.value ??
    document?.fields.invoice_no?.value;

  const candidates = review?.candidates ?? analysis.candidates;

  const widthsSnapshot = useSyncExternalStore(
    subscribeColWidths,
    getColWidthsSnapshot,
    getColWidthsServerSnapshot
  );

  const savedColWidthsByRole = useMemo(() => {
    const [invStr, plStr] = widthsSnapshot.split("|");
    const result: Record<string, Record<string, number>> = { invoice: {}, packing_list: {} };
    try {
      if (invStr) result.invoice = JSON.parse(invStr);
    } catch {}
    try {
      if (plStr) result.packing_list = JSON.parse(plStr);
    } catch {}
    return result;
  }, [widthsSnapshot]);

  const [dragOverride, setDragOverride] = useState<{ col: string; width: number } | null>(null);

  const colWidths = useMemo(() => {
    const base = savedColWidthsByRole[role] ?? {};
    if (dragOverride) {
      return { ...base, [dragOverride.col]: dragOverride.width };
    }
    return base;
  }, [savedColWidthsByRole, role, dragOverride]);


  const [resizing, setResizing] = useState<{
    col: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const getColWidth = (name: string): number => {
    return colWidths[name] ?? columnPixelWidth(name);
  };

  const totalTableWidth = useMemo(() => {
    const hashWidth = colWidths["#"] ?? columnPixelWidth("#");
    const colsWidth = columns.reduce(
      (acc, col) => acc + (colWidths[col] ?? columnPixelWidth(col)),
      0
    );
    return hashWidth + colsWidth;
  }, [columns, colWidths]);

  const handlePointerDown = (col: string, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = getColWidth(col);
    setResizing({
      col,
      startX: e.clientX,
      startWidth: startW,
    });
  };

  useEffect(() => {
    if (!resizing) return;

    const handleGlobalPointerMove = (e: PointerEvent) => {
      const { col, startX, startWidth } = resizing;
      const deltaX = e.clientX - startX;
      const minWidth = minColumnPixelWidth(col);
      const newWidth = Math.max(minWidth, Math.round(startWidth + deltaX));
      setDragOverride({ col, width: newWidth });
    };

    const handleGlobalPointerUp = (e: PointerEvent) => {
      const { col, startX, startWidth } = resizing;
      const deltaX = e.clientX - startX;
      const minWidth = minColumnPixelWidth(col);
      const finalWidth = Math.max(minWidth, Math.round(startWidth + deltaX));
      const didChange = Math.abs(finalWidth - startWidth) > 1;

      setResizing(null);
      setDragOverride(null);

      if (typeof window !== "undefined") {
        try {
          const currentRole = { ...(savedColWidthsByRole[role] ?? {}) };
          currentRole[col] = finalWidth;
          localStorage.setItem(`shipping_col_widths_${role}`, JSON.stringify(currentRole));
          window.dispatchEvent(new Event("storage"));
        } catch {}
      }

      if (didChange) {
        toast.saved("Saved!");
      }
    };

    const domBody = typeof window !== "undefined" ? window.document.body : null;
    const prevCursor = domBody?.style.cursor;
    const prevSelect = domBody?.style.userSelect;
    if (domBody) {
      domBody.style.cursor = "col-resize";
      domBody.style.userSelect = "none";
    }

    window.addEventListener("pointermove", handleGlobalPointerMove);
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);

    return () => {
      if (domBody) {
        domBody.style.cursor = prevCursor ?? "";
        domBody.style.userSelect = prevSelect ?? "";
      }
      window.removeEventListener("pointermove", handleGlobalPointerMove);
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, [resizing, role, savedColWidthsByRole]);

  const handleResetColWidth = (col: string) => {
    if (typeof window !== "undefined") {
      try {
        const currentRole = { ...(savedColWidthsByRole[role] ?? {}) };
        delete currentRole[col];
        localStorage.setItem(`shipping_col_widths_${role}`, JSON.stringify(currentRole));
        window.dispatchEvent(new Event("storage"));
      } catch {}
    }
    toast.updated(`Column "${tableColumnLabel(col, role)}" reset`);
  };

  const handleResetAllColWidths = () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(`shipping_col_widths_${role}`);
        window.dispatchEvent(new Event("storage"));
      } catch {}
    }
    toast.updated("Column widths reset to default");
  };

  return (
    <div
      className="panel overflow-hidden bg-card rounded-card border shadow-2xs flex flex-col min-w-0"
      role="region"
      aria-label="Editable document data"
    >
      {/* Top Document Tabs matching the Document Intake Tab style */}
      <nav className="flex border-b bg-background px-2" aria-label="Verification documents">
        {(["invoice", "packing_list"] as const).map((entry) => {
          const active = role === entry;
          const count = analysis.extractions
            .filter((doc) => doc.role === entry)
            .reduce((sum, doc) => sum + doc.items.length, 0);
          return (
            <button
              key={entry}
              type="button"
              disabled={pending > 0 || dirtyCount > 0}
              onClick={() => onRoleChange(entry)}
              aria-pressed={active}
              className={cn(
                "cursor-pointer border-b-2 px-4 py-2 text-xs font-semibold transition-all focus-visible:outline-offset-[-2px] flex items-center gap-1.5",
                active
                  ? "border-primary text-primary font-bold"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              <span>{entry === "invoice" ? "Commercial Invoice" : "Packing List"}</span>
              {count > 0 && (
                <span
                  className={cn(
                    "rounded-control px-1.5 py-0.2 text-[10px] font-mono",
                    active
                      ? "bg-primary/10 text-primary font-bold"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Card Sub-Header: Title, Version, Lines, Sheet Switcher, Autosave Status */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5 bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="size-4 text-primary shrink-0" aria-hidden />
          <h2 className="font-semibold text-xs truncate text-foreground">
            {role === "invoice" ? "Commercial Invoice" : "Packing List"}
            {invoiceNo && <span className="text-muted-foreground font-normal"> · {invoiceNo}</span>}
          </h2>
          <span className="font-mono text-[11px] text-muted-foreground shrink-0">
            v{original?.version_number ?? 1} · {document?.items.length ?? 0} lines
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {documents.length > 1 && (
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>Sheet</span>
              <select
                aria-label="Editor source document"
                disabled={pending > 0 || dirtyCount > 0}
                className="rounded border border-border/70 bg-background px-2 py-0.5 text-xs text-foreground"
                value={document ? `${document.document_id}:${document.sheet ?? ""}` : ""}
                onChange={(event) => onSelectDocument(event.target.value)}
              >
                {documents.map((doc) => (
                  <option key={`${doc.document_id}:${doc.sheet}`} value={`${doc.document_id}:${doc.sheet ?? ""}`}>
                    {item.documents.find((entry) => entry.id === doc.document_id)?.original_filename} ·{" "}
                    {doc.sheet ?? doc.role}
                  </option>
                ))}
              </select>
            </label>
          )}

          {Object.keys(colWidths).length > 0 && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={handleResetAllColWidths}
              className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              title="Reset all column widths to default"
            >
              Reset widths
            </Button>
          )}

          <span role="status" className="text-muted-foreground text-[11px] font-medium min-w-16 text-right">
            {pending > 0
              ? `Saving ${pending}…`
              : error
              ? "Save failed"
              : dirtyCount > 0
              ? `${dirtyCount} unsaved`
              : "Saved"}
          </span>

          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={onToggleHistory}
            aria-expanded={historyOpen}
            className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <History className="size-3 mr-1" />
            History
          </Button>
        </div>
      </div>

      {document && document.status !== "extracted" && (
        <p className="border-b bg-amber-500/5 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          This extraction is incomplete or uncertain. Check the original document and unresolved findings before approval.
        </p>
      )}

      {document ? (
        <>
          {/* Header Fields Form: Clean 2-column grid with full-width long text fields */}
          <div className="grid grid-cols-2 gap-3.5 border-b border-border/60 p-4" aria-label="Document header fields">
            {fields.map((name) => (
              <div
                key={name}
                className={cn(fullWidthHeaderFields.has(name) ? "col-span-2" : "col-span-1")}
              >
                {fieldEditor(
                  { document_id: document.document_id, role, row: null, name },
                  document.fields[name] ?? { status: "missing", value: "", confidence: 1, evidence: [] }
                )}
              </div>
            ))}
          </div>

          {/* CDC Master List selector (for invoice tab) */}
          {role === "invoice" && (
            <div className="border-b border-border/60 px-4 py-2 text-xs bg-muted/10">
              <details className="group">
                <summary className="flex cursor-pointer items-center justify-between gap-2 font-medium text-foreground hover:text-primary py-1">
                  <span>
                    <span className="text-muted-foreground">CDC Master List · </span>
                    {master ? `${master.approval_ref} (${master.year})` : "Choose a verified company list"}
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="pt-2 pb-1 border-t border-border/50 mt-1">
                  <ReviewActions
                    caseId={item.id}
                    revision={analysis.revision}
                    selected={analysis.selected_master ?? master ?? undefined}
                    versions={versions}
                    companyId={item.company_id ?? undefined}
                    canRegister={admin}
                    pending={pending > 0 || analysis.state === "pending"}
                    showReprocess={false}
                  />
                </div>
              </details>
            </div>
          )}

          {/* Line Items Table: Columns match the preview document */}
          <div aria-label="Editable line items" className="p-3">
            <Table
              containerClassName="overflow-x-auto"
              style={{
                width: `${totalTableWidth}px`,
                minWidth: `${totalTableWidth}px`,
                tableLayout: "fixed",
              }}
              className="border-collapse text-xs select-auto"
            >
              <colgroup>
                <col style={{ width: `${getColWidth("#")}px` }} />
                {columns.map((name) => (
                  <col key={name} style={{ width: `${getColWidth(name)}px` }} />
                ))}
              </colgroup>
              <TableHeader className="bg-muted/15 border-b border-border/70">
                <TableRow className="hover:bg-transparent">
                  <TableHead
                    style={{ width: `${getColWidth("#")}px` }}
                    className="relative h-8 px-2 text-center text-[10px] font-semibold uppercase text-muted-foreground select-none"
                  >
                    <span>#</span>
                    <div
                      role="separator"
                      aria-orientation="vertical"
                      title="Drag to resize column · Double-click to reset"
                      onPointerDown={(e) => handlePointerDown("#", e)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleResetColWidth("#");
                      }}
                      className={cn(
                        "absolute -right-1.5 top-0 bottom-0 w-3.5 cursor-col-resize select-none touch-none flex items-center justify-center group/resize z-20",
                        resizing?.col === "#" && "z-30"
                      )}
                    >
                      <div
                        className={cn(
                          "w-[1.5px] rounded-full transition-colors",
                          resizing?.col === "#"
                            ? "bg-primary w-[2px] h-full"
                            : "h-3.5 bg-border/60 group-hover/resize:bg-primary group-hover/resize:h-full"
                        )}
                      />
                    </div>
                  </TableHead>
                  {columns.map((name) => {
                    const isColResizing = resizing?.col === name;
                    const colW = getColWidth(name);
                    return (
                      <TableHead
                        key={name}
                        style={{ width: `${colW}px` }}
                        className={cn(
                          "relative h-8 px-2 text-[10px] font-semibold uppercase text-muted-foreground leading-4 select-none",
                          name !== "description" && name !== "unit" ? "text-right" : "text-left"
                        )}
                      >
                        <span className="truncate block pr-2.5">{tableColumnLabel(name, role)}</span>
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          title="Drag to resize column · Double-click to reset"
                          onPointerDown={(e) => handlePointerDown(name, e)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            handleResetColWidth(name);
                          }}
                          className={cn(
                            "absolute -right-1.5 top-0 bottom-0 w-3.5 cursor-col-resize select-none touch-none flex items-center justify-center group/resize z-20",
                            isColResizing && "z-30"
                          )}
                        >
                          <div
                            className={cn(
                              "w-[1.5px] rounded-full transition-colors",
                              isColResizing
                                ? "bg-primary w-[2px] h-full"
                                : "h-3.5 bg-border/60 group-hover/resize:bg-primary group-hover/resize:h-full"
                            )}
                          />
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {document.items.map((line, index) => {
                  const rowCandidates = suggestions
                    ? candidates.filter(
                        (entry) =>
                          (!entry.invoice_document_id || entry.invoice_document_id === document.document_id) &&
                          entry.invoice_row === line.row
                      )
                    : [];
                  const otherCandidates = suggestions
                    ? candidates.filter((entry) => entry.invoice_row !== line.row)
                    : [];

                  return (
                    <TableRow
                      key={line.row}
                      data-active={activeField?.row === line.row}
                      className="align-middle hover:bg-muted/15 transition-colors border-b border-border/60"
                      onClick={() => {
                        if (line.fields.description) {
                          onInspect({
                            document_id: document.document_id,
                            role,
                            row: line.row,
                            name: "description",
                          });
                        }
                      }}
                    >
                      <TableCell
                        style={{ width: `${getColWidth("#")}px` }}
                        className="px-2 py-1.5 align-middle font-mono text-[10px] text-muted-foreground text-center"
                        title={`Original document row ${line.row}`}
                      >
                        {index + 1}
                      </TableCell>
                      {columns.map((name) => {
                        const colW = getColWidth(name);
                        if (name === "description" && role === "invoice") {
                          return (
                            <TableCell
                              key={name}
                              style={{ width: `${colW}px` }}
                              className="whitespace-normal px-1 py-1 align-middle cursor-text overflow-hidden"
                            >
                              <VerificationDescriptionWithCdc
                                line={line}
                                document={document}
                                role={role}
                                options={rowCandidates}
                                otherCandidates={otherCandidates}
                                master={master}
                                review={review}
                                disabled={disabled}
                                fieldEditor={fieldEditor}
                                onSelectCandidate={onSelectCandidate}
                                onClearCandidate={onClearCandidate}
                              />
                            </TableCell>
                          );
                        }

                        const rawField = line.fields[name] ?? {
                          status: "missing",
                          value: "",
                          confidence: 1,
                          evidence: [],
                        };

                        return (
                          <TableCell
                            key={name}
                            style={{ width: `${colW}px` }}
                            className="whitespace-normal px-1 py-1 align-middle cursor-text overflow-hidden"
                            onClick={(event) => {
                              event.stopPropagation();
                              const input = event.currentTarget.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
                              if (input) input.focus();
                            }}
                          >
                            {fieldEditor(
                              { document_id: document.document_id, role, row: line.row, name },
                              rawField,
                              true
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>

              <TableFooter className="border-t border-border/80 bg-muted/20 text-xs font-semibold">
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    style={{ width: `${getColWidth("#")}px` }}
                    className="px-2 py-2 font-mono text-center text-muted-foreground"
                  >
                    Σ
                  </TableCell>
                  {columns.map((name) => {
                    const isEditableTotal = editableTotals.has(name);
                    const colW = getColWidth(name);

                    if (isEditableTotal) {
                      const calculated = total(name);
                      const numMatch =
                        calculated && calculated !== "Incomplete" && calculated !== "Mixed units"
                          ? calculated.match(/^([\d.]+)/)?.[1]
                          : null;
                      const unitMatch =
                        calculated && calculated !== "Incomplete" && calculated !== "Mixed units"
                          ? calculated.match(/^[^\s]+\s+(.+)$/)?.[1]
                          : null;

                      const defaultUnit =
                        name === "amount"
                          ? "USD"
                          : name === "packages"
                          ? "PKG"
                          : name === "measurement"
                          ? "CBM"
                          : "KG";

                      const rawField = document.fields[name];
                      const docTotalField: ExtractedField =
                        rawField && (rawField.value !== null || rawField.evidence?.length > 0)
                          ? {
                              ...rawField,
                              value: rawField.value ?? numMatch ?? null,
                              unit: rawField.unit ?? unitMatch ?? defaultUnit,
                              currency: name === "amount" ? (rawField.currency ?? unitMatch ?? "USD") : null,
                            }
                          : {
                              value: numMatch ?? null,
                              unit: unitMatch ?? defaultUnit,
                              currency: name === "amount" ? (unitMatch ?? "USD") : null,
                              status: numMatch ? "present" : "missing",
                              evidence: [],
                            };

                      return (
                        <TableCell
                          key={name}
                          style={{ width: `${colW}px` }}
                          className="whitespace-normal px-1 py-1 align-middle cursor-text overflow-hidden"
                          onClick={(event) => {
                            event.stopPropagation();
                            const input = event.currentTarget.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
                            if (input) input.focus();
                          }}
                        >
                          {fieldEditor(
                            { document_id: document.document_id, role, row: null, name },
                            docTotalField,
                            true
                          )}
                        </TableCell>
                      );
                    }

                    if (name === "description") {
                      return (
                        <TableCell
                          key={name}
                          style={{ width: `${colW}px` }}
                          className="px-2 py-1.5 align-middle font-mono text-[11px] font-semibold text-muted-foreground uppercase tracking-wider overflow-hidden"
                        >
                          Total
                        </TableCell>
                      );
                    }

                    if (name === "quantity") {
                      return (
                        <TableCell
                          key={name}
                          style={{ width: `${colW}px` }}
                          className="whitespace-normal px-2 py-1.5 align-middle font-mono text-xs text-right font-semibold text-muted-foreground overflow-hidden"
                        >
                          {document.fields.quantity &&
                          (document.fields.quantity.value !== null ||
                            document.fields.quantity.evidence?.length > 0)
                            ? fieldEditor(
                                { document_id: document.document_id, role, row: null, name: "quantity" },
                                document.fields.quantity,
                                true
                              )
                            : total("quantity") || "—"}
                        </TableCell>
                      );
                    }

                    return (
                      <TableCell
                        key={name}
                        style={{ width: `${colW}px` }}
                        className="whitespace-normal px-1 py-1 align-middle font-mono text-xs text-muted-foreground text-center overflow-hidden"
                      >
                        —
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableFooter>
            </Table>

            {!document.items.length && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No line items were extracted. Review the source or reprocess the current document.
              </p>
            )}
          </div>

          {/* CDC Validation Warnings */}
          {role === "invoice" && quotaChecks.length > 0 && (
            <div className="space-y-1 border-t bg-amber-500/5 px-4 py-2 text-[10px] text-amber-700 dark:text-amber-300" aria-label="CDC validation warnings">
              {quotaChecks.map((check) => (
                <p key={check.key}>
                  {documentFieldLabel(check.field)} · {check.explanation}
                  {check.left ? ` (${check.left} / ${check.right ?? "Unknown"})` : ""}
                </p>
              ))}
            </div>
          )}

          {/* Card Footer: Status & Settings */}
          <div className="flex items-center justify-between border-t border-border/60 bg-muted/10 px-4 py-2 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CheckCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>{blockerCount === 0 ? "Ready for approval" : `${blockerCount} review items`}</span>
              <span>·</span>
              <span>{review?.cdc_ready ? "CDC verified" : "CDC review separate"}</span>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autosave}
                  onChange={(event) => onAutosaveChange(event.target.checked)}
                  className="size-3 rounded border-border"
                />
                <span>Autosave</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={suggestions}
                  onChange={(event) => onSuggestionsChange(event.target.checked)}
                  className="size-3 rounded border-border"
                />
                <span>AI suggestions</span>
              </label>
            </div>
          </div>
        </>
      ) : (
        <VerificationCardSkeleton />
      )}
    </div>
  );
}
