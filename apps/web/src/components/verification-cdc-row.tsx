"use client";

import { useState } from "react";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { ReviewAnalysis, StaffReview } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export interface VerificationCdcCleanOptionsProps {
  row: number;
  candidates: ReviewAnalysis["candidates"];
  review: StaffReview | null;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectCandidate: (candidate: ReviewAnalysis["candidates"][number]) => Promise<void>;
  onClearMapping?: () => Promise<void>;
  children: React.ReactNode;
}

export function VerificationCdcCleanOptions({
  row,
  candidates,
  review,
  disabled,
  open,
  onOpenChange,
  onSelectCandidate,
  onClearMapping,
  children,
}: VerificationCdcCleanOptionsProps) {
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const mapping = review?.mappings.find((entry) => entry.invoice_row === row);
  const selected = mapping?.master_row;

  async function handleSelect(entry: ReviewAnalysis["candidates"][number] | null) {
    if (disabled || saving) return;
    setSaving(true);
    try {
      if (entry) {
        await onSelectCandidate(entry);
      } else if (onClearMapping) {
        await onClearMapping();
      }
      onOpenChange(false);
    } catch {
      // Handled by review state
    } finally {
      setSaving(false);
    }
  }

  const filtered = search.trim()
    ? candidates.filter(
        (c) =>
          c.description.toLowerCase().includes(search.toLowerCase()) ||
          (c.serial && c.serial.toLowerCase().includes(search.toLowerCase())) ||
          String(c.master_row).includes(search)
      )
    : candidates;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[360px] p-0 shadow-xl border border-border/70 rounded-lg text-xs"
        role="region"
        aria-label={`CDC options for row ${row}`}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest?.(`[data-cdc-anchor="${row}"]`)) {
            e.preventDefault();
          }
        }}
      >
        <div className="p-2.5 border-b border-border/50 bg-muted/15 flex items-center justify-between">
          <span className="font-semibold text-xs text-foreground">Approved material candidates</span>
          <span className="text-[10px] text-muted-foreground font-mono">Row {row}</span>
        </div>

        {candidates.length > 3 && (
          <div className="p-2 border-b border-border/40">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 size-3 text-muted-foreground" />
              <Input
                placeholder="Filter candidates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 pl-7 text-xs bg-background border-border/70"
              />
            </div>
          </div>
        )}

        <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5">
          {filtered.length === 0 ? (
            <p className="p-3 text-center text-xs text-muted-foreground">
              {candidates.length === 0
                ? "No CDC candidates found."
                : "No matching candidate for search filter."}
            </p>
          ) : (
            filtered.map((entry) => {
              const isSelected = selected === entry.master_row;
              return (
                <button
                  key={entry.master_row}
                  type="button"
                  disabled={saving || disabled}
                  onClick={() => void handleSelect(entry)}
                  className={cn(
                    "w-full flex items-start gap-2 p-2 rounded-md text-left transition-colors cursor-pointer outline-none",
                    isSelected
                      ? "bg-primary/10 text-primary border border-primary/30"
                      : "hover:bg-muted/60 text-foreground border border-transparent"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium text-[11px] truncate">
                        {entry.serial ? `${entry.serial} · ${entry.description}` : entry.description}
                      </span>
                      {isSelected ? (
                        <Check className="size-3.5 text-primary shrink-0" />
                      ) : (
                        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                          {entry.score.toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <span className="block text-[10px] text-muted-foreground mt-0.5">
                      {entry.unit ?? "Unknown unit"} · balance {entry.remaining_quantity ?? "unknown"} · {entry.unit_price ?? "unknown price"} {entry.currency ?? ""}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {selected !== undefined && (
          <div className="p-1.5 border-t border-border/40 bg-muted/10 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={saving || disabled}
              className="text-[11px] h-6 text-muted-foreground hover:text-destructive"
              onClick={() => void handleSelect(null)}
            >
              Clear selection
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
