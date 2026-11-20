"use client";

import { useState } from "react";
import { Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { MasterVersion, ReviewAnalysis, StaffReview } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export interface VerificationCdcCleanOptionsProps {
  row: number;
  candidates: ReviewAnalysis["candidates"];
  otherCandidates?: ReviewAnalysis["candidates"];
  master?: MasterVersion | null;
  review: StaffReview | null;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectCandidate: (candidate: ReviewAnalysis["candidates"][number], reason?: string) => Promise<void>;
  onClearMapping?: () => Promise<void>;
  children: React.ReactNode;
}

export function VerificationCdcCleanOptions({
  row,
  candidates,
  otherCandidates = [],
  master,
  review,
  disabled,
  open,
  onOpenChange,
  onSelectCandidate,
  onClearMapping,
  children,
}: VerificationCdcCleanOptionsProps) {
  const [saving, setSaving] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<ReviewAnalysis["candidates"][number] | null>(null);

  const mapping = review?.mappings.find((entry) => entry.invoice_row === row);
  const selectedMasterRow = selectedCandidate?.master_row ?? mapping?.master_row;

  async function handleSelect(entry: ReviewAnalysis["candidates"][number] | null) {
    if (disabled || saving) return;
    setSaving(true);
    try {
      if (entry) {
        setSelectedCandidate(entry);
        await onSelectCandidate(entry);
      } else if (onClearMapping) {
        setSelectedCandidate(null);
        await onClearMapping();
      }
      onOpenChange(false);
    } catch {
      // Handled by review state
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-[360px] p-0 shadow-xl border border-border/70 rounded-lg text-xs z-60 bg-popover overflow-hidden"
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
        {/* Notice if no master list selected */}
        {!master && (
          <div className="p-2.5 bg-amber-500/5 text-amber-700 dark:text-amber-400 text-[10px] leading-tight flex items-start gap-1.5 border-b border-border/40">
            <Info className="size-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <span>No CDC Master List selected. Choose a CDC Master List above to see approved materials.</span>
          </div>
        )}

        {/* Candidates List */}
        <div className="max-h-64 overflow-y-auto p-1.5 space-y-1">
          {candidates.length === 0 && otherCandidates.length === 0 ? (
            <div className="p-3 text-center text-xs text-muted-foreground space-y-1">
              <p>No CDC candidates found.</p>
              <p className="text-[10px] text-muted-foreground/80">
                You can type freely in the table cell to keep custom description.
              </p>
            </div>
          ) : (
            <>
              {candidates.length > 0 && (
                <div className="space-y-0.5">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Best Matches ({candidates.length})
                  </div>
                  {candidates.map((entry) => {
                    const isSelected = selectedMasterRow === entry.master_row;
                    return (
                      <button
                        key={entry.master_row}
                        type="button"
                        disabled={saving || disabled}
                        onClick={() => void handleSelect(entry)}
                        className={cn(
                          "w-full flex items-start gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors cursor-pointer outline-none",
                          isSelected
                            ? "bg-primary/10 text-primary border border-primary/30"
                            : "hover:bg-muted/70 text-foreground border border-transparent"
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
                            {entry.unit ?? "Unit"} · balance {entry.remaining_quantity ?? "unknown"} · {entry.unit_price ? `$${entry.unit_price}` : "no price"} {entry.currency ?? ""}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {otherCandidates.length > 0 && (
                <div className={cn("space-y-0.5", candidates.length > 0 && "pt-1 border-t border-border/30 mt-1")}>
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Other Master Items ({otherCandidates.length})
                  </div>
                  {otherCandidates.map((entry) => {
                    const isSelected = selectedMasterRow === entry.master_row;
                    return (
                      <button
                        key={`other-${entry.master_row}`}
                        type="button"
                        disabled={saving || disabled}
                        onClick={() => void handleSelect(entry)}
                        className={cn(
                          "w-full flex items-start gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors cursor-pointer outline-none",
                          isSelected
                            ? "bg-primary/10 text-primary border border-primary/30"
                            : "hover:bg-muted/70 text-foreground border border-transparent"
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium text-[11px] truncate">
                              {entry.serial ? `${entry.serial} · ${entry.description}` : entry.description}
                            </span>
                            {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
                          </div>
                          <span className="block text-[10px] text-muted-foreground mt-0.5">
                            {entry.unit ?? "Unit"} · balance {entry.remaining_quantity ?? "unknown"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Clear selection button */}
        {selectedMasterRow !== undefined && (
          <div className="p-1.5 border-t border-border/40 bg-muted/10 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={saving || disabled}
              className="text-[11px] h-6 text-muted-foreground hover:text-destructive cursor-pointer"
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
