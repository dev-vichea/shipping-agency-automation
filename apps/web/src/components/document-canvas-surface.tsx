"use client";

import type { ReactNode, Ref } from "react";
import { Maximize2, Minimize2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const documentCanvasPaper = "rounded-xs border border-slate-200/90 bg-white shadow-[0_4px_24px_-4px_rgba(0,0,0,0.14),0_2px_8px_-2px_rgba(0,0,0,0.06)] ring-1 ring-slate-900/5 dark:border-slate-800 dark:ring-white/5";

/** Shared canvas chrome; source rendering and printable templates stay separate. */
export function DocumentCanvasSurface({ children, controls, overlay, viewportRef, viewportLabel = "Document canvas viewport", viewportClassName, connectorViewport = false }: {
  children: ReactNode; controls: ReactNode; overlay?: ReactNode; viewportRef?: Ref<HTMLDivElement>;
  viewportLabel?: string; viewportClassName?: string; connectorViewport?: boolean;
}) {
  return <div data-document-canvas className="relative h-full min-h-0 w-full flex-1 overflow-hidden bg-white [background-image:radial-gradient(#cbd5e1_1.25px,transparent_1.25px)] [background-size:24px_24px] dark:bg-slate-950 dark:[background-image:radial-gradient(#334155_1.25px,transparent_1.25px)]">
    {controls}
    {overlay}
    <div ref={viewportRef} tabIndex={0} aria-label={viewportLabel} data-connector-viewport={connectorViewport ? "" : undefined}
      className={cn("flex h-full w-full items-start overflow-auto p-6 pt-16 focus-visible:outline-hidden md:p-12", viewportClassName)}>
      {children}
    </div>
  </div>;
}

export function DocumentCanvasControls({ zoom, expanded, onExpand, onZoomIn, onZoomOut, zoomInDisabled, zoomOutDisabled, onRotate, onReset }: {
  zoom: number; expanded: boolean; onExpand: () => void; onZoomIn: () => void; onZoomOut: () => void;
  zoomInDisabled?: boolean; zoomOutDisabled?: boolean; onRotate?: () => void; onReset?: () => void;
}) {
  const buttonClass = "size-7 cursor-pointer rounded-control text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800";
  const divider = <span className="h-px w-5 bg-slate-200 dark:bg-slate-700" />;
  return <div aria-label="Canvas controls" role="group" className="absolute right-3.5 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white/95 p-1 shadow-lg backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95 print:hidden">
    <Button type="button" variant="ghost" size="icon-xs" className={buttonClass} onClick={onExpand} title={expanded ? "Collapse canvas" : "Expand canvas"}>{expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</Button>
    {divider}
    <Button type="button" variant="ghost" size="icon-xs" className={buttonClass} onClick={onZoomIn} disabled={zoomInDisabled} title="Zoom In"><ZoomIn size={14} /></Button>
    <span className="select-none font-mono text-[10px] font-bold tabular-nums text-slate-700 dark:text-slate-300">{Math.round(zoom)}%</span>
    <Button type="button" variant="ghost" size="icon-xs" className={buttonClass} onClick={onZoomOut} disabled={zoomOutDisabled} title="Zoom Out"><ZoomOut size={14} /></Button>
    {(onRotate || onReset) && divider}
    {onRotate && <Button type="button" variant="ghost" size="icon-xs" className={buttonClass} onClick={onRotate} title="Rotate Page"><RotateCw size={13} /></Button>}
    {onReset && <Button type="button" variant="ghost" size="icon-xs" className={buttonClass} onClick={onReset} title="Reset zoom"><RotateCcw size={13} /></Button>}
  </div>;
}
