"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, Maximize, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogCloseButton, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Evidence } from "@/lib/contracts";

type PageInfo = { pages: number; width: number; height: number; box: [number, number, number, number] | null };

export function PdfPreview({ id, name, evidence, zoom = 100, onZoomChange }: {
  id: string; name: string; evidence?: Evidence; zoom?: number; onZoomChange?: (zoom: number) => void;
}) {
  const [page, setPage] = useState(evidence?.page ?? 1);
  const [rotation, setRotation] = useState(0);
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const [prevEvidence, setPrevEvidence] = useState<{ page?: number | null; docId?: string }>({
    page: evidence?.page,
    docId: evidence?.document_id,
  });
  const [prevZoom, setPrevZoom] = useState(zoom);

  if (evidence && (evidence.page !== prevEvidence.page || evidence.document_id !== prevEvidence.docId)) {
    setPrevEvidence({ page: evidence.page, docId: evidence.document_id });
    if (evidence.page) {
      setPage(evidence.page);
    }
  }

  if (zoom !== prevZoom) {
    setPrevZoom(zoom);
    setCurrentZoom(zoom);
  }

  const [response, setResponse] = useState<{ url: string; info?: PageInfo }>();
  const [brokenImage, setBrokenImage] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const highlight = useRef<HTMLDivElement>(null);
  const selection = page === evidence?.page ? evidence.line : null;
  const resource = `/api/v1/documents/${id}/pages/${page}`;
  const image = `${resource}/image?rotation=${rotation}`;
  const infoUrl = `${resource}?rotation=${rotation}${selection ? `&line=${selection}` : ""}`;
  const current = response?.url === infoUrl ? response : undefined;
  const info = current?.info;

  function handleZoom(nextZoom: number) {
    const clamped = Math.max(50, Math.min(250, nextZoom));
    setCurrentZoom(clamped);
    onZoomChange?.(clamped);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(infoUrl, { signal: controller.signal })
      .then(async (result) => {
        if (!result.ok) throw new Error("Page unavailable");
        const info = await result.json() as PageInfo;
        if (!controller.signal.aborted) setResponse({ url: infoUrl, info });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResponse({ url: infoUrl });
      });
    return () => controller.abort();
  }, [infoUrl]);

  useEffect(() => {
    highlight.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [info?.box, expanded]);

  const surface = (fullScreen: boolean) => {
    if (!current) return <p role="status" className="p-3 text-body-sm text-muted-foreground">Loading PDF page…</p>;
    if (!info || brokenImage === image) return <p role="status" className="p-3 text-body-sm">Preview unavailable. Use the original or source excerpt.</p>;
    const box = info.box;
    return <div className="mx-auto w-full min-w-0" style={{ width: `${currentZoom}%` }}>
      <div className="relative mx-auto border border-input bg-card shadow-sm" style={{ maxWidth: fullScreen ? undefined : (info.width * currentZoom) / 100 }}>
        <Image src={image} alt={`${name}, page ${page}`} width={Math.ceil(info.width)} height={Math.ceil(info.height)}
          unoptimized loading="eager" className="h-auto w-full" onError={() => setBrokenImage(image)} />
        {box && <div ref={highlight} aria-label={`Source highlight, line ${selection}`} role="img"
          className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/25 shadow-sm ring-2 ring-primary/40 ring-offset-1 transition-all"
          style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%` }}>
          {evidence?.raw && <span className="absolute -top-7 left-0 max-w-[280px] truncate rounded bg-slate-900/90 px-2 py-0.5 text-[11px] font-mono text-white shadow-md backdrop-blur-sm">
            {evidence.raw}
          </span>}
        </div>}
      </div>
    </div>;
  };

  const controls = <div className="flex flex-wrap items-center gap-1.5">
    <div className="flex items-center gap-0.5">
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} aria-hidden /></Button>
      <span className="font-mono text-xs tabular-nums text-muted-foreground px-1" aria-live="polite">Page {page}{info ? ` / ${info.pages}` : ""}</span>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Next page" disabled={!info || page >= info.pages} onClick={() => setPage(page + 1)}><ChevronRight size={14} aria-hidden /></Button>
    </div>
    <span className="h-3.5 w-px bg-border" aria-hidden />
    <div className="flex items-center gap-1">
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Zoom out" disabled={currentZoom <= 50} onClick={() => handleZoom(currentZoom - 15)}><ZoomOut size={13} aria-hidden /></Button>
      <input type="range" min="50" max="200" step="5" value={currentZoom} aria-label="Zoom level"
        onChange={(event) => handleZoom(Number(event.target.value))}
        className="h-1.5 w-16 cursor-pointer accent-primary" />
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Zoom in" disabled={currentZoom >= 200} onClick={() => handleZoom(currentZoom + 15)}><ZoomIn size={13} aria-hidden /></Button>
      <span className="font-mono text-xs tabular-nums text-muted-foreground w-9 text-right">{currentZoom}%</span>
    </div>
    <span className="h-3.5 w-px bg-border" aria-hidden />
    <Button type="button" variant="ghost" size="icon-xs" aria-label="Rotate page" title="Rotate 90°" onClick={() => setRotation((rotation + 90) % 360)}><RotateCw size={13} aria-hidden /></Button>
    {rotation !== 0 && <Button type="button" variant="ghost" size="xs" aria-label="Reset page rotation" onClick={() => setRotation(0)}>Reset</Button>}
  </div>;

  return <Dialog open={expanded} onOpenChange={setExpanded}>
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-2.5 py-1">
      {controls}
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Expand PDF preview" title="Expand preview"><Maximize size={13} aria-hidden /></Button>
      </DialogTrigger>
    </div>
    <div tabIndex={0} aria-label="Scroll PDF page" className="max-h-[min(55vh,38rem)] overflow-auto bg-muted/60 p-3 focus-visible:outline-offset-[-2px]">
      {!expanded && surface(false)}
    </div>
    <DialogContent aria-describedby={undefined} className="h-[90dvh] w-[96vw] max-w-5xl overflow-hidden">
      <DialogTitle className="sr-only">Expanded PDF preview</DialogTitle>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
          <p className="truncate text-headline-sm" title={name}>{name}</p>
          <div className="flex shrink-0 items-center gap-1">
            {expanded && controls}
            <DialogCloseButton label="Close expanded preview" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-muted p-4 focus-visible:outline-offset-[-2px]" tabIndex={0} aria-label="Scroll expanded PDF page">
          {expanded && surface(true)}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
