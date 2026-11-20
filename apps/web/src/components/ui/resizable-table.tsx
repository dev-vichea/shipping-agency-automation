"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";

export interface ResizableColumn<T> {
  id: string;
  header: React.ReactNode;
  defaultWidth: number;
  minWidth?: number;
  align?: "left" | "center" | "right";
  className?: string;
  headerClassName?: string;
  cell: (row: T, index: number) => React.ReactNode;
}

export interface ResizableTableProps<T> {
  columns: ResizableColumn<T>[];
  data: T[];
  storageKey?: string;
  rowKey?: (row: T, index: number) => string;
  emptyState?: React.ReactNode;
  containerClassName?: string;
  className?: string;
  headerClassName?: string;
  onRowClick?: (row: T) => void;
}

export function ResizableTable<T>({
  columns,
  data,
  storageKey,
  rowKey,
  emptyState,
  containerClassName,
  className,
  headerClassName,
  onRowClick,
}: ResizableTableProps<T>) {
  // Read initial saved widths from localStorage
  const [savedWidths, setSavedWidths] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined" || !storageKey) return {};
    try {
      const raw = localStorage.getItem(`shipping_col_widths_${storageKey}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const [dragOverride, setDragOverride] = useState<{ col: string; width: number } | null>(null);
  const [resizing, setResizing] = useState<{
    col: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  // Sync with storage changes
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    const handleStorage = () => {
      try {
        const raw = localStorage.getItem(`shipping_col_widths_${storageKey}`);
        if (raw) setSavedWidths(JSON.parse(raw));
      } catch {}
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [storageKey]);

  const minColWidth = useCallback(
    (colId: string) => {
      const col = columns.find((c) => c.id === colId);
      return col?.minWidth ?? 48;
    },
    [columns]
  );

  const getColWidth = useCallback(
    (colId: string): number => {
      if (dragOverride && dragOverride.col === colId) {
        return dragOverride.width;
      }
      if (savedWidths[colId] !== undefined) {
        return savedWidths[colId];
      }
      const col = columns.find((c) => c.id === colId);
      return col?.defaultWidth ?? 120;
    },
    [dragOverride, savedWidths, columns]
  );

  const totalTableWidth = useMemo(() => {
    return columns.reduce((acc, col) => acc + getColWidth(col.id), 0);
  }, [columns, getColWidth]);

  const handlePointerDown = (colId: string, e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = getColWidth(colId);
    setResizing({
      col: colId,
      startX: e.clientX,
      startWidth: startW,
    });
  };

  useEffect(() => {
    if (!resizing) return;

    const handleGlobalPointerMove = (e: PointerEvent) => {
      const { col, startX, startWidth } = resizing;
      const deltaX = e.clientX - startX;
      const minW = minColWidth(col);
      const newWidth = Math.max(minW, Math.round(startWidth + deltaX));
      setDragOverride({ col, width: newWidth });
    };

    const handleGlobalPointerUp = (e: PointerEvent) => {
      const { col, startX, startWidth } = resizing;
      const deltaX = e.clientX - startX;
      const minW = minColWidth(col);
      const finalWidth = Math.max(minW, Math.round(startWidth + deltaX));
      const didChange = Math.abs(finalWidth - startWidth) > 1;

      setResizing(null);
      setDragOverride(null);

      if (storageKey && typeof window !== "undefined") {
        try {
          const next = { ...savedWidths, [col]: finalWidth };
          setSavedWidths(next);
          localStorage.setItem(`shipping_col_widths_${storageKey}`, JSON.stringify(next));
          window.dispatchEvent(new Event("storage"));
        } catch {}
      }

      if (didChange) {
        toast.saved("Column width saved!");
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
  }, [resizing, minColWidth, savedWidths, storageKey]);

  const handleResetColWidth = (colId: string) => {
    if (storageKey && typeof window !== "undefined") {
      try {
        const next = { ...savedWidths };
        delete next[colId];
        setSavedWidths(next);
        localStorage.setItem(`shipping_col_widths_${storageKey}`, JSON.stringify(next));
        window.dispatchEvent(new Event("storage"));
        toast.saved("Column reset to default");
      } catch {}
    }
  };

  return (
    <div
      className={cn(
        "relative w-full overflow-x-auto select-auto",
        containerClassName
      )}
    >
      <Table
        style={{
          width: `${totalTableWidth}px`,
          minWidth: "100%",
          tableLayout: "fixed",
        }}
        className={cn("w-full border-collapse text-xs", className)}
      >
        <colgroup>
          {columns.map((col) => (
            <col key={col.id} style={{ width: `${getColWidth(col.id)}px` }} />
          ))}
        </colgroup>
        <TableHeader
          className={cn(
            "bg-muted/40 dark:bg-muted/20 border-b border-border/80 sticky top-0 z-10",
            headerClassName
          )}
        >
          <TableRow className="hover:bg-transparent border-b border-border/80">
            {columns.map((col) => {
              const isColResizing = resizing?.col === col.id;
              const colW = getColWidth(col.id);
              const align = col.align ?? "left";

              return (
                <TableHead
                  key={col.id}
                  style={{ width: `${colW}px` }}
                  className={cn(
                    "relative h-9 px-3 text-[11px] font-semibold uppercase text-muted-foreground tracking-wider select-none align-middle",
                    align === "right" && "text-right",
                    align === "center" && "text-center",
                    align === "left" && "text-left",
                    col.headerClassName
                  )}
                >
                  <span className="truncate block pr-2.5">{col.header}</span>
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    title="Drag to resize column · Double-click to reset"
                    onPointerDown={(e) => handlePointerDown(col.id, e)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleResetColWidth(col.id);
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
          {data.length > 0 ? (
            data.map((row, index) => {
              const key = rowKey ? rowKey(row, index) : index;
              return (
                <TableRow
                  key={key}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "border-b border-border/50 transition-colors hover:bg-accent/40",
                    onRowClick && "cursor-pointer"
                  )}
                >
                  {columns.map((col) => {
                    const align = col.align ?? "left";
                    return (
                      <TableCell
                        key={col.id}
                        className={cn(
                          "px-3 py-2.5 align-middle truncate",
                          align === "right" && "text-right",
                          align === "center" && "text-center",
                          align === "left" && "text-left",
                          col.className
                        )}
                      >
                        {col.cell(row, index)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-32 text-center text-muted-foreground"
              >
                {emptyState ?? "No records found."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
