import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lastPageOffset, maxOffset, pageHref, pageSize } from "@/lib/pagination";

type Target = string | (() => void);
type Range = { offset: number; count: number; total?: number; label?: string };

function PageControl({ target, disabled, children }: {
  target?: Target; disabled?: boolean; children: ReactNode;
}) {
  if (typeof target === "string" && !disabled) {
    return <Button asChild size="sm" variant="outline"><Link href={target} prefetch={false}>{children}</Link></Button>;
  }
  return <Button type="button" size="sm" variant="outline" disabled={!target || disabled}
    onClick={typeof target === "function" ? target : undefined}>{children}</Button>;
}

export function Pagination({ offset, count, total, label, previous, next, pending }: Range & {
  previous?: Target; next?: Target; pending?: boolean;
}) {
  if (!previous && !next) return null;
  const start = offset + 1;
  const end = offset + count;
  const range = start === end ? String(start) : `${start}–${end}`;
  return (
    <nav aria-label={label ? `${label} pagination` : "Pagination"}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t px-3 py-2 text-body-sm text-muted-foreground">
      {count > 0 && <span aria-live="polite" className="tabular-nums">
        {total === undefined ? range : `${range} of ${total}`}
      </span>}
      <div className="ml-auto flex items-center gap-1.5">
        <PageControl target={previous} disabled={pending}><ChevronLeft aria-hidden /> Previous</PageControl>
        <PageControl target={next} disabled={pending}>Next <ChevronRight aria-hidden /></PageControl>
      </div>
    </nav>
  );
}

export function ListPagination({ path, offset, count, total, label, hasNext }: Range & {
  path: string; hasNext?: boolean;
}) {
  const previous = Math.max(0, offset - pageSize);
  const previousOffset = total === undefined ? previous : Math.min(previous, lastPageOffset(total));
  const canAdvance = hasNext ?? (total !== undefined && offset + count < total);
  return <Pagination offset={offset} count={count} total={total} label={label}
    previous={offset > 0 ? pageHref(path, previousOffset) : undefined}
    next={canAdvance && offset + pageSize <= maxOffset ? pageHref(path, offset + pageSize) : undefined} />;
}
