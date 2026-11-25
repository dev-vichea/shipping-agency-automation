"use client";

import Image from "next/image";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DocumentCanvasControls, DocumentCanvasSurface, documentCanvasPaper } from "@/features/review/document-canvas-surface";
import type { FieldEditor } from "@/features/review/field-editor-types";
import { sourceKey } from "@/features/review/review-findings";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Evidence } from "@/lib/contracts";
import { location } from "@/lib/format";
import { cn } from "@/lib/utils";

type PageInfo = { pages: number; width: number; height: number; box: [number, number, number, number] | null };
type Box = NonNullable<PageInfo["box"]>;
type Worksheet = {
  sheets: string[];
  sheet: string;
  total: number;
  columns: string[];
  rows: { number: number; values: string[] }[];
};

function revealCitation(target: HTMLElement, viewport: HTMLElement) {
  function scrollDelta(start: number, end: number, size: number) {
    const inset = 12;
    return start < inset ? start - inset : Math.max(0, Math.min(end - size + inset, start - inset));
  }

  for (let parent = target.parentElement; parent && viewport.contains(parent); parent = parent.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(parent);
    const horizontal = /auto|scroll/.test(overflowX) && parent.scrollWidth > parent.clientWidth;
    const vertical = /auto|scroll/.test(overflowY) && parent.scrollHeight > parent.clientHeight;
    if (!horizontal && !vertical) continue;

    const item = target.getBoundingClientRect();
    const bounds = parent.getBoundingClientRect();
    const left = bounds.left + parent.clientLeft;
    const top = bounds.top + parent.clientTop;
    parent.scrollBy({
      left: horizontal ? scrollDelta(item.left - left, item.right - left, parent.clientWidth) : 0,
      top: vertical ? scrollDelta(item.top - top, item.bottom - top, parent.clientHeight) : 0,
      behavior: "instant",
    });
  }
}

function rotateBox([x, y, width, height]: Box, rotation: number): Box {
  switch (rotation) {
    case 90: return [1 - y - height, x, height, width];
    case 180: return [1 - x - width, 1 - y - height, width, height];
    case 270: return [y, 1 - x - width, height, width];
    default: return [x, y, width, height];
  }
}

export type DocumentSourceOption = {
  key: string;
  id: string;
  title: string;
  sheet: string | null;
  fileType: "PDF" | "Excel" | "CDC";
  name: string;
  url: string;
  lines: Evidence[];
  version_number?: number;
  classification?: string;
};

export function DocumentCanvas({
  file,
  options,
  currentKey,
  evidence,
  activeFieldInfo,
  editor,
  className,
  lockedSheet = false,
  embedded = false,
  showBadges = true,
  hideExcerptToggle = false,
  headerActions,
}: {
  file?: {
    id: string;
    name: string;
    fileType: "PDF" | "Excel" | "CDC";
    url: string;
    version_number?: number;
    classification?: string;
  };
  options: DocumentSourceOption[];
  currentKey?: string;
  onChooseSource?: (key: string) => void;
  evidence?: Evidence;
  editor?: FieldEditor;
  editorKey?: string;
  activeFieldInfo?: { name: string; value: string; uncertain?: boolean };
  onDismissField?: () => void;
  className?: string;
  lockedSheet?: boolean;
  embedded?: boolean;
  showBadges?: boolean;
  hideExcerptToggle?: boolean;
  headerActions?: ReactNode;
}) {
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [page, setPage] = useState(evidence?.page ?? 1);
  const [viewMode, setViewMode] = useState<"document" | "excerpt">("document");
  const [isExpanded, setIsExpanded] = useState(false);
  const previewPageSize = 25;
  const currentOption = options.find((opt) => opt.key === currentKey);
  const documentId = file?.id;

  // PDF state derived from response cache to prevent synchronous effect re-renders
  const [pdfResponse, setPdfResponse] = useState<{ url: string; info?: PageInfo; error?: boolean }>();
  const [brokenPdfImage, setBrokenPdfImage] = useState<string>();
  const isPdf = file?.fileType === "PDF";
  const isExcel = file?.fileType === "Excel" || file?.fileType === "CDC";

  // Excel state derived from response cache
  const [sheet, setSheet] = useState(evidence?.sheet ?? currentOption?.sheet ?? "");
  const [excelOffset, setExcelOffset] = useState(
    Math.floor(Math.max(0, (evidence?.row ?? 1) - 1) / previewPageSize) * previewPageSize,
  );
  const [excelResponse, setExcelResponse] = useState<{ key: string; data?: Worksheet; error?: string }>();

  const canvasRef = useRef<HTMLDivElement>(null);
  const [selectedCell, setSelectedCell] = useState<{ col: string; row: number; value: string } | null>(null);

  const [previousEvidence, setPreviousEvidence] = useState(evidence);
  if (evidence !== previousEvidence) {
    setPreviousEvidence(evidence);
    if (evidence?.page && isPdf) {
      setPage(evidence.page);
    }
    if (evidence?.sheet && isExcel) {
      setSheet(evidence.sheet);
    }
    if (evidence?.row != null && isExcel) {
      setExcelOffset(Math.floor(Math.max(0, evidence.row - 1) / previewPageSize) * previewPageSize);
    }
  }

  const selection = page === evidence?.page && !evidence.bbox ? evidence.line : null;
  const pdfPageUrl = file && isPdf ? `/api/v1/documents/${file.id}/pages/${page}?rotation=${rotation}` : "";
  const pdfInfoUrl = selection ? `${pdfPageUrl}&line=${selection}` : pdfPageUrl;
  const currentPdf = pdfResponse?.url === pdfInfoUrl ? pdfResponse : undefined;
  // Keep the same page visible while the next highlight is being resolved.
  const pdfInfo = pdfResponse?.url.split("&line=")[0] === pdfPageUrl ? pdfResponse?.info : undefined;
  const pdfError = currentPdf?.error ?? false;

  const excelKey = file && isExcel ? `${file.id}:${sheet}:${excelOffset}` : "";
  const currentExcel = excelResponse?.key === excelKey ? excelResponse : undefined;
  const worksheet = currentExcel?.data ?? null;
  const excelError = currentExcel?.error ?? "";
  const excelLoading = isExcel && !currentExcel && !excelError;

  // Load PDF metadata
  useEffect(() => {
    if (!isPdf || !pdfInfoUrl) return;

    const controller = new AbortController();

    fetch(pdfInfoUrl, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Page unavailable");
        const data = (await res.json()) as PageInfo;
        if (!controller.signal.aborted) {
          setPdfResponse({ url: pdfInfoUrl, info: data, error: false });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPdfResponse({ url: pdfInfoUrl, error: true });
        }
      });

    return () => controller.abort();
  }, [isPdf, pdfInfoUrl]);

  // Load Excel workbook data
  useEffect(() => {
    if (!documentId || !isExcel || !excelKey) return;

    const controller = new AbortController();
    const query = new URLSearchParams({ offset: String(excelOffset) });
    if (sheet) query.set("sheet", sheet);

    fetch(`/api/v1/documents/${documentId}/workbook?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Worksheet preview unavailable.");
        const data = (await res.json()) as Worksheet;
        if (!controller.signal.aborted) {
          setExcelResponse({ key: excelKey, data, error: "" });
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setExcelResponse({ key: excelKey, error: err instanceof Error ? err.message : "Worksheet error" });
        }
      });

    return () => controller.abort();
  }, [documentId, isExcel, excelKey, sheet, excelOffset]);

  function handleZoom(next: number) {
    setZoom(Math.max(40, Math.min(250, Math.round(next * 10) / 10)));
  }

  const handleZoomDelta = useCallback((delta: number) => {
    setZoom((prev) => Math.max(40, Math.min(250, Math.round((prev + delta) * 10) / 10)));
  }, []);

  const pdfImageUrl = file && isPdf ? `/api/v1/documents/${file.id}/pages/${page}/image?rotation=${rotation}` : null;
  const hasPdfError = pdfError || (pdfImageUrl ? brokenPdfImage === pdfImageUrl : false);
  const pdfLoading = isPdf && !pdfInfo && !hasPdfError;
  const citedBox = page === evidence?.page ? evidence.bbox : undefined;
  const fallbackBox = currentPdf?.info?.box;
  const box = useMemo(() => citedBox ? rotateBox(citedBox, rotation) : fallbackBox,
    [citedBox, rotation, fallbackBox]);
  const segments = citedBox && evidence?.boxes?.length ? evidence.boxes.map((span) => rotateBox(span, rotation)) : [];
  const totalPages = isPdf ? pdfInfo?.pages ?? 1 : worksheet?.total ?? 1;
  const citationKey = evidence && sourceKey(evidence);
  const excerptLines = currentOption?.lines ?? [];
  const showExcerpt = viewMode === "excerpt";
  const locationUnavailable = isPdf && !showExcerpt && evidence && !box
    && (!evidence.page || (page === evidence.page && currentPdf));
  const excerptMatch = showExcerpt && evidence ? (
    excerptLines.find((line) => sourceKey(line) === citationKey)
    ?? excerptLines.find((line) => line.sheet && line.sheet === evidence.sheet && line.row === evidence.row)
  ) : undefined;
  const lines = showExcerpt && evidence?.raw
    ? excerptMatch ? excerptLines.map((line) => line === excerptMatch ? evidence : line) : [...excerptLines, evidence]
    : excerptLines;

  useEffect(() => {
    const viewport = canvasRef.current;
    const target = viewport?.querySelector<HTMLElement>("[data-connector-target]");
    if (viewport && target) revealCitation(target, viewport);
  }, [evidence, box, pdfInfo, worksheet, showExcerpt, zoom, isExpanded, hasPdfError]);

  useEffect(() => {
    if (!isExpanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isExpanded]);

  const canvas = (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden bg-white dark:bg-slate-950",
        isExpanded
          ? "fixed inset-0 z-[100] h-screen w-screen rounded-none border-none bg-background shadow-none"
          : embedded
          ? "h-full min-h-0 w-full rounded-none border-0 shadow-none"
          : "h-[min(82vh,880px)] w-full rounded-lg border border-slate-200 shadow-xs dark:border-slate-800",
        className
      )}
    >
      {/* Top Header Bar: Document Filename on Left, View Mode & Actions on Right */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-white/95 px-3 py-2 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 z-20">
        {/* Document Filename & Type Indicator */}
        <div className="flex items-center gap-2 min-w-0">
          <FileTypeIcon
            filename={file?.name ?? currentOption?.title}
            type={file?.fileType === "CDC" ? "excel" : file?.fileType}
            badge={file?.fileType === "CDC" ? "CDC" : undefined}
            size="sm"
          />
          <span className="truncate text-xs font-semibold text-foreground">
            {file?.name ?? currentOption?.title ?? "Document"}
          </span>
          {showBadges && file?.fileType && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground uppercase">
              {file.fileType}
            </span>
          )}
          {showBadges && file?.version_number != null && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold",
                file.classification === "final_bl"
                  ? "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
              )}
            >
              {file.classification === "final_bl" ? "Final B/L" : `v${file.version_number}`}
            </span>
          )}
        </div>

        {/* View Mode & Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {headerActions}
          {!hideExcerptToggle && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="h-7 border-slate-200 bg-white text-xs dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
              onClick={() => setViewMode(showExcerpt ? "document" : "excerpt")}
            >
              {showExcerpt ? "Document Canvas" : "Raw Excerpt"}
            </Button>
          )}

          {file && (
            <Button
              asChild
              size="icon-xs"
              variant="outline"
              className="h-7 w-7 border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
            >
              <a href={file.url} title={`Download original ${file.name}`}>
                <ArrowDownToLine size={13} />
              </a>
            </Button>
          )}

          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            className="h-7 w-7 border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Exit expanded canvas" : "Expand canvas"}
          >
            {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </Button>
        </div>
      </div>

      {locationUnavailable && <p role="status" className="border-b bg-card px-3 py-2 text-xs text-muted-foreground">
        PDF highlight unavailable for this field. Its source text is in Raw Excerpt.
      </p>}

      <DocumentCanvasSurface
        viewportRef={canvasRef}
        connectorViewport
        onWheelZoom={handleZoomDelta}
        controls={
          <DocumentCanvasControls
            zoom={zoom}
            expanded={isExpanded}
            onExpand={() => setIsExpanded(!isExpanded)}
            onZoomIn={() => handleZoom(zoom + 15)}
            onZoomOut={() => handleZoom(zoom - 15)}
            zoomInDisabled={zoom >= 220}
            zoomOutDisabled={zoom <= 40}
            onRotate={() => setRotation((value) => (value + 90) % 360)}
            onReset={() => handleZoom(100)}
          />
        } overlay={<>
        {/* Floating Top Page Indicator & Navigation (PDF) */}
        {isPdf && totalPages > 1 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-1 shadow-md backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={14} />
            </Button>
            <span className="font-mono text-xs tabular-nums text-foreground font-semibold px-1">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Next page"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        )}

        {/* Close Button when Expanded */}
        {isExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="absolute top-3 right-3 z-30 flex size-8 items-center justify-center rounded-control bg-slate-900/80 text-white shadow-xl hover:bg-slate-900 backdrop-blur-md cursor-pointer transition-colors"
            title="Close expanded view"
          >
            ✕
          </button>
        )}

      </>}>
        {showExcerpt ? (
          /* Text Excerpt fallback */
          <div
            className="mx-auto w-full max-w-3xl rounded-sm border border-slate-200/90 bg-white p-6 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.12),0_2px_8px_-2px_rgba(0,0,0,0.06)] ring-1 ring-slate-900/5 transition-all dark:border-slate-800 dark:bg-card dark:ring-white/5"
            style={{ fontSize: `${(13 * zoom) / 100}px` }}
          >
            <div className="mb-4 border-b pb-2 flex items-center justify-between">
              <span className="font-semibold text-foreground">
                {currentOption?.sheet ?? file?.name ?? "Document excerpt"}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{lines.length} lines</span>
            </div>
            {lines.length ? (
              <ol className="divide-y divide-border/60">
                {lines.map((line, idx) => {
                  const isTarget = line === evidence || line === excerptMatch;
                  return (
                    <li
                      key={idx}
                      data-connector-target={isTarget ? "true" : undefined}
                      className={cn(
                        "whitespace-pre-wrap break-words px-2 py-1.5 font-mono text-xs leading-relaxed transition-colors relative",
                        isTarget && "border-l-4 border-l-primary bg-intelligence-fill text-intelligence font-medium"
                      )}
                    >
                      {isTarget && (
                        <span className="absolute -left-1 top-1/2 -translate-y-1/2 size-2 rounded-full bg-primary" />
                      )}
                      <strong className="mr-2 text-muted-foreground">{location(line)}</strong>
                      {line.raw}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="p-4 text-center text-sm text-muted-foreground">No source excerpt recorded.</p>
            )}
          </div>
        ) : isPdf ? (
          /* PDF CANVAS SHEET */
          <div
            className={cn(documentCanvasPaper, "relative mx-auto dark:bg-card")}
            style={{
              width: pdfInfo ? `${(pdfInfo.width * zoom) / 100}px` : "680px",
              minHeight: pdfInfo ? `${(pdfInfo.height * zoom) / 100}px` : "900px",
              flexShrink: zoom > 100 ? 0 : undefined,
            }}
          >
            {pdfLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-xs">
                <span className="font-mono text-xs text-muted-foreground">Rendering PDF page {page}…</span>
              </div>
            )}
            {hasPdfError && (
              <div className="flex h-96 flex-col items-center justify-center p-8 text-center">
                <p className="text-sm font-medium text-destructive">PDF page preview unavailable.</p>
                <p className="mt-1 text-xs text-muted-foreground">Switch to Raw Excerpt or download original.</p>
              </div>
            )}
            {pdfImageUrl && !hasPdfError && pdfInfo && (
              <div className="relative w-full h-auto">
                <Image
                  src={pdfImageUrl}
                  alt={`${file.name}, page ${page}`}
                  width={Math.ceil(pdfInfo.width)}
                  height={Math.ceil(pdfInfo.height)}
                  unoptimized
                  loading="eager"
                  className="h-auto w-full select-none"
                  onError={() => pdfImageUrl && setBrokenPdfImage(pdfImageUrl)}
                />

                {/* Targeted Grounding Bounding Box */}
                {box && (
                  <div
                    data-connector-target="true"
                    className="pointer-events-none absolute"
                    style={{
                      left: `max(0px, calc(${box[0] * 100}% - 4px))`,
                      top: `max(0px, calc(${box[1] * 100}% - 3px))`,
                      right: `max(0px, calc(${(1 - box[0] - box[2]) * 100}% - 4px))`,
                      bottom: `max(0px, calc(${(1 - box[1] - box[3]) * 100}% - 3px))`,
                    }}
                  >
                    {!segments.length && <span role="img" aria-label="Source citation bounding box"
                      className="absolute inset-0 rounded-xs border-2 border-primary bg-primary/20" />}

                  </div>
                )}
                {segments.map(([x, y, width, height], index) => (
                  <span key={index} role="img" aria-label="Source citation bounding box"
                    className="pointer-events-none absolute rounded-xs border-2 border-primary bg-primary/20"
                    style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }} />
                ))}
              </div>
            )}
          </div>
        ) : isExcel ? (
          /* EXCEL CANVAS SHEET */
          <div
            className="relative mx-auto rounded-xs border border-slate-200/90 bg-white p-4 sm:p-6 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.14),0_2px_8px_-2px_rgba(0,0,0,0.06)] ring-1 ring-slate-900/5 transition-all duration-100 dark:border-slate-800 dark:bg-card dark:ring-white/5 w-full"
            style={zoom !== 100 ? { width: `${Math.max(600, (880 * zoom) / 100)}px` } : undefined}
          >
            {/* Sheet Tabs Header */}
            {worksheet && worksheet.sheets.length > 1 && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Worksheet:</span>
                  <NativeSelect
                    aria-label="Worksheet" className="h-7 text-xs font-medium"
                    disabled={lockedSheet}
                    value={sheet || worksheet.sheet}
                    onChange={(e) => {
                      setSheet(e.target.value);
                      setExcelOffset(0);
                    }}
                  >
                    {worksheet.sheets.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                {evidence?.row && evidence.sheet === worksheet.sheet && (
                  <span className="rounded bg-intelligence-fill px-2 py-0.5 font-mono text-xs font-medium text-intelligence">
                    Target: Row {evidence.row}
                  </span>
                )}
              </div>
            )}

            {excelLoading && (
              <p className="p-8 text-center text-xs text-muted-foreground font-mono">Loading worksheet rows…</p>
            )}
            {excelError && <p className="p-4 text-center text-xs text-destructive">{excelError}</p>}

            {worksheet && !excelLoading && (
              <div className="space-y-3">
                {selectedCell && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-mono font-bold text-primary">{selectedCell.col}{selectedCell.row}:</span>
                      <span className="truncate max-w-[260px] sm:max-w-[340px] font-mono font-medium text-foreground" title={selectedCell.value}>
                        &ldquo;{selectedCell.value}&rdquo;
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {editor ? (
                        <Button
                          size="xs"
                          type="button"
                          disabled={editor.busy}
                          onClick={() => {
                            void editor.onSave({
                              value: selectedCell.value,
                              unit: editor.unit,
                              currency: editor.currency,
                            });
                            setSelectedCell(null);
                          }}
                          className="h-6 px-2.5 text-xs font-semibold shadow-xs"
                        >
                          <Check size={12} className="mr-1" /> Use for {activeFieldInfo?.name ?? "field"}
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground italic">
                          Select a field on the left to assign
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedCell(null)}
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Dismiss selection"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto rounded border border-border/80">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow className="bg-muted/70">
                        <TableHead className="w-12 text-center font-mono">#</TableHead>
                        {worksheet.columns.map((col) => (
                          <TableHead key={col} className="font-semibold text-foreground whitespace-nowrap">
                            {col}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {worksheet.rows.map((row) => {
                        const isTarget = evidence?.sheet === worksheet.sheet && evidence?.row === row.number;
                        const targetCell = isTarget && evidence?.cell ? evidence.cell.toUpperCase() : null;
                        return (
                          <TableRow
                            key={row.number}
                            data-connector-target={isTarget && !targetCell ? "true" : undefined}
                            className={cn(
                              "transition-colors relative",
                              isTarget && "bg-intelligence-fill/90 font-medium border-l-4 border-l-primary"
                            )}
                          >
                            <TableCell
                              className={cn(
                                "text-center font-mono text-[11px] relative",
                                isTarget ? "font-bold text-primary" : "text-muted-foreground"
                              )}
                            >
                              {isTarget && (
                                <span className="absolute -left-1 top-1/2 -translate-y-1/2 size-2 rounded-full bg-primary" />
                              )}
                              {row.number}
                            </TableCell>
                            {worksheet.columns.map((col, cIdx) => {
                              const selected = targetCell === `${col}${row.number}`;
                              const isClicked = selectedCell?.col === col && selectedCell?.row === row.number;
                              const val = row.values[cIdx];
                              return (
                                <TableCell
                                  key={col}
                                  data-connector-target={selected ? "true" : undefined}
                                  onClick={() => {
                                    if (val && val.trim() !== "" && val !== "—") {
                                      setSelectedCell({ col, row: row.number, value: val.trim() });
                                    }
                                  }}
                                  className={cn(
                                    "max-w-[220px] truncate py-1.5 font-mono text-[11px] cursor-pointer transition-colors hover:bg-primary/10",
                                    selected && "bg-primary/15 font-bold ring-2 ring-inset ring-primary",
                                    isClicked && "bg-primary/25 font-bold ring-2 ring-inset ring-primary"
                                  )}
                                  title={val ? `${col}${row.number}: ${val}` : undefined}
                                >
                                  {val || "—"}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <Pagination
                  label="Rows"
                  offset={excelOffset}
                  count={worksheet.rows.length}
                  total={worksheet.total}
                  previous={excelOffset > 0 ? () => setExcelOffset(excelOffset - previewPageSize) : undefined}
                  next={
                    excelOffset + previewPageSize < worksheet.total
                      ? () => setExcelOffset(excelOffset + previewPageSize)
                      : undefined
                  }
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            No preview available for this document format.
          </div>
        )}
      </DocumentCanvasSurface>
    </div>
  );

  return isExpanded && typeof document !== "undefined" ? createPortal(canvas, document.body) : canvas;
}
