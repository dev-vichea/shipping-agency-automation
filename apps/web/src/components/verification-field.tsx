"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Evidence, ExtractedField, ReviewCorrection, ReviewField } from "@/lib/contracts";
import { documentFieldLabel } from "@/lib/format";
import { dateFields, numericFields } from "@/lib/verification-review";
import { cn } from "@/lib/utils";

export type VerificationFieldSave = {
  value: string;
  unit: string | null;
  currency: string | null;
  confirmed: boolean;
  note: string;
  alternative_index?: number;
  suggestion_source?: ReviewField;
};

export type VerificationSourceChoice = {
  source: ReviewField;
  field: ExtractedField;
  label: string;
};

export function VerificationField({
  target,
  field,
  rawField,
  correction,
  conflict,
  suggestion,
  sourceChoices,
  autosave,
  disabled,
  compact,
  onSave,
  onUndo,
  onInspect,
  onDirtyChange,
}: {
  target: ReviewField;
  field: ExtractedField;
  rawField?: ExtractedField;
  correction?: ReviewCorrection;
  conflict?: string;
  suggestion?: { value: string; evidence: Evidence[] };
  autosave: boolean;
  disabled: boolean;
  compact?: boolean;
  sourceChoices: VerificationSourceChoice[];
  onSave: (edit: VerificationFieldSave) => Promise<void>;
  onUndo?: () => Promise<void>;
  onInspect: () => void;
  onDirtyChange: (key: string, dirty: boolean) => void;
}) {
  const [text, setText] = useState(field.value ?? "");
  const [previous, setPrevious] = useState(field.value);
  const [editingVerified, setEditingVerified] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [alternative, setAlternative] = useState<number>();
  const [suggestionSource, setSuggestionSource] = useState<ReviewField>();
  const [emptyDescAlert, setEmptyDescAlert] = useState(false);

  const money = ["unit_price", "amount"].includes(target.name);
  const hasUnit = ["gross_weight", "net_weight", "packages", "measurement"].includes(target.name);
  const dimension = money ? field.currency ?? "" : field.unit ?? "";

  const inFlight = useRef(false);
  const confirmAfterSave = useRef(false);
  const lastSubmitted = useRef<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(36, textareaRef.current.scrollHeight)}px`;
    }
  }, [text]);

  if (field.value !== previous) {
    setPrevious(field.value);
    setText(field.value ?? "");
  }

  const verified = !!correction && correction.confirmed !== false;
  const locked = verified && !editingVerified;
  const isChanged =
    Boolean(correction) ||
    (Boolean(rawField) &&
      text !== (rawField?.value ?? "") &&
      text.trim() !== (rawField?.value ?? "").trim());

  const handleUndo = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setText(rawField?.value ?? "");
    setAlternative(undefined);
    setSuggestionSource(undefined);
    setError("");
    if (onUndo) {
      await onUndo();
    }
  };

  const dirty =
    text.trim() !== (field.value ?? "") ||
    ((money || hasUnit) && dimension !== (money ? field.currency ?? "" : field.unit ?? ""));
  const fieldKey = `${target.document_id}:${target.role}:${target.row ?? 0}:${target.name}`;

  useEffect(() => {
    onDirtyChange(fieldKey, dirty);
    return () => onDirtyChange(fieldKey, false);
  }, [dirty, fieldKey, onDirtyChange]);

  const label = `${target.role === "invoice" ? "Invoice" : "Packing list"}${target.row ? ` row ${target.row}` : ""} ${documentFieldLabel(target.name)}`;
  const numeric = numericFields.has(target.name);
  const type = numeric
    ? "number"
    : dateFields.has(target.name) && (!text || /^\d{4}-\d{2}-\d{2}$/.test(text))
    ? "date"
    : "text";
  const status = dirty
    ? "Unsaved"
    : conflict
    ? "Conflict"
    : verified
    ? "Verified"
    : correction
    ? "Edited"
    : suggestion
    ? "Suggested"
    : field.status === "missing"
    ? "Missing"
    : field.status === "uncertain"
    ? "Uncertain"
    : "AI-filled";

  async function persist(confirmed: boolean) {
    if (confirmed && inFlight.current) {
      confirmAfterSave.current = true;
      return;
    }
    if (!text.trim() || disabled || (locked && !compact) || inFlight.current || (!compact && editingVerified && !note.trim())) return;
    const fingerprint = `${text.trim()}:${dimension}:${confirmed}:${alternative ?? ""}`;
    if (!confirmed && lastSubmitted.current === fingerprint) return;
    inFlight.current = true;
    lastSubmitted.current = fingerprint;
    setSaving(true);
    setError("");
    try {
      const chosenSource = sourceChoices.find(
        (entry) =>
          entry.source.document_id === suggestionSource?.document_id &&
          entry.source.role === suggestionSource?.role &&
          entry.source.row === suggestionSource?.row &&
          entry.source.name === suggestionSource?.name
      )?.field;
      await onSave({
        value: text.trim(),
        unit: chosenSource ? chosenSource.unit : hasUnit ? dimension || null : field.unit,
        currency: money ? dimension || null : chosenSource ? chosenSource.currency : field.currency,
        confirmed,
        note: note.trim() || (confirmed ? "Confirmed individually." : "Autosaved edit."),
        alternative_index: alternative,
        suggestion_source: suggestionSource,
      });
      if (confirmed) {
        setEditingVerified(false);
        setNote("");
      }
    } catch (cause) {
      confirmAfterSave.current = false;
      lastSubmitted.current = undefined;
      setError(cause instanceof Error ? cause.message : "Could not save this value.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const persistLatest = useEffectEvent((confirmed: boolean) => persist(confirmed));
  useEffect(() => {
    if (saving) return;
    if (confirmAfterSave.current) {
      confirmAfterSave.current = false;
      void persistLatest(true);
      return;
    }
    if (!autosave || !dirty || (locked && !compact) || (verified && !compact) || disabled || !text.trim()) return;
    const timer = setTimeout(() => void persistLatest(false), 650);
    return () => clearTimeout(timer);
  }, [autosave, dirty, locked, verified, disabled, text, dimension, saving, compact]);

  // Compact mode for table cells (simple, clean input, no icons, no overflow, flexible text)
  if (compact) {
    const isTotal = target.row === null;
    const unitSuffix = isTotal ? (dimension || field.currency || field.unit) : null;
    const isDescription = target.name === "description";

    return (
      <div className="w-full min-w-0" data-field-state={status}>
        {isDescription ? (
          <div className="flex items-start w-full min-w-0 gap-1">
            <textarea
              id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
              aria-label={label}
              value={text}
              readOnly={disabled}
              disabled={disabled}
              rows={1}
              placeholder={text ? undefined : "—"}
              style={{ fieldSizing: "content" } as React.CSSProperties}
              className={cn(
                "min-h-[28px] flex-1 min-w-0 resize-none overflow-hidden rounded border border-transparent bg-transparent hover:border-border/60 hover:bg-background/40 hover:shadow-2xs focus:border-primary focus:bg-background focus:ring-1 focus:ring-primary/40 focus:shadow-xs px-1.5 py-1 text-xs text-foreground outline-none transition-all duration-150 cursor-text leading-snug whitespace-pre-wrap break-words",
                error && "border-destructive bg-destructive/5"
              )}
              onFocus={() => {
                if (locked) setEditingVerified(true);
                onInspect();
              }}
              onClick={() => {
                if (locked) setEditingVerified(true);
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
              onChange={(event) => {
                setText(event.target.value);
                setAlternative(undefined);
                setSuggestionSource(undefined);
              }}
              onBlur={() => {
                if (target.name === "description" && !text.trim()) {
                  setEmptyDescAlert(true);
                  return;
                }
                if (autosave && dirty) void persist(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (target.name === "description" && !text.trim()) {
                    setEmptyDescAlert(true);
                    return;
                  }
                  void persist(true);
                }
              }}
            />
            {isChanged && onUndo && (
              <button
                type="button"
                title="Undo change (revert to original)"
                aria-label={`Undo change for ${label}`}
                onClick={handleUndo}
                className="shrink-0 mt-1 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
              >
                <RotateCcw className="size-3" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center w-full min-w-0 gap-1 justify-end">
            <input
              id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
              aria-label={label}
              value={text}
              readOnly={disabled}
              disabled={disabled}
              type={numeric ? "text" : type}
              inputMode={numeric ? "decimal" : undefined}
              step={numeric ? "any" : undefined}
              min={numeric ? "0" : undefined}
              placeholder={text ? undefined : "—"}
              list={target.name === "unit" ? "common-shipping-units" : undefined}
              className={cn(
                "h-7 flex-1 min-w-0 rounded border border-transparent bg-transparent hover:border-border/60 hover:bg-background/40 hover:shadow-2xs focus:border-primary focus:bg-background focus:ring-1 focus:ring-primary/40 focus:shadow-xs px-1.5 text-xs text-foreground outline-none transition-all duration-150 cursor-text",
                numeric ? "font-mono text-right tabular-nums" : "text-left",
                isTotal && "font-semibold",
                error && "border-destructive bg-destructive/5"
              )}
              onFocus={() => {
                if (locked) setEditingVerified(true);
                onInspect();
              }}
              onClick={() => {
                if (locked) setEditingVerified(true);
              }}
              onChange={(event) => {
                setText(event.target.value);
                setAlternative(undefined);
                setSuggestionSource(undefined);
              }}
              onBlur={() => {
                if (autosave && dirty) void persist(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void persist(true);
                }
              }}
            />
            {unitSuffix && (
              <span className="shrink-0 text-[10px] font-mono font-bold text-muted-foreground uppercase select-none px-1">
                {unitSuffix}
              </span>
            )}
            {isChanged && onUndo && (
              <button
                type="button"
                title="Undo change (revert to original)"
                aria-label={`Undo change for ${label}`}
                onClick={handleUndo}
                className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
              >
                <RotateCcw className="size-3" />
              </button>
            )}
          </div>
        )}
        {target.name === "unit" && (
          <datalist id="common-shipping-units">
            <option value="KG" />
            <option value="MTR" />
            <option value="PCS" />
            <option value="DOZ" />
            <option value="CONE" />
            <option value="SET" />
            <option value="ROLL" />
            <option value="PKG" />
            <option value="YARD" />
            <option value="PAIR" />
            <option value="BOX" />
            <option value="CTN" />
            <option value="CBM" />
          </datalist>
        )}
        {error && <p role="alert" className="text-[9px] text-destructive">{error}</p>}
      </div>
    );
  }

  // Header field mode (clean form field with label on top, flexible expanding text, subtle border & soft shadow)
  const isFlexibleText = !numeric && !dateFields.has(target.name) && !money && !hasUnit;

  return (
    <div className="group/field w-full min-w-0 space-y-1.5" data-field-state={status}>
      <div className="flex items-center justify-between">
        <label
          htmlFor={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
          className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          {documentFieldLabel(target.name)}
        </label>
        {isChanged && onUndo && (
          <button
            type="button"
            title="Undo change (revert to original)"
            aria-label={`Undo change for ${documentFieldLabel(target.name)}`}
            onClick={handleUndo}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors cursor-pointer"
          >
            <RotateCcw className="size-2.5" />
            <span>Undo</span>
          </button>
        )}
      </div>

      {isFlexibleText ? (
        <textarea
          ref={textareaRef}
          id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
          aria-label={label}
          value={text}
          readOnly={disabled}
          disabled={disabled}
          maxLength={500}
          rows={1}
          placeholder={text ? undefined : "—"}
          style={{ fieldSizing: "content" } as React.CSSProperties}
          className={cn(
            "w-full min-h-[38px] resize-none overflow-hidden rounded-md border border-border/80 bg-white dark:bg-slate-900 shadow-sm hover:border-primary/50 hover:shadow focus:border-primary focus:ring-1 focus:ring-primary/40 focus:shadow-sm px-3 py-2 text-xs text-foreground outline-none transition-all duration-150 cursor-text leading-relaxed whitespace-pre-wrap break-words",
            error && "border-destructive bg-destructive/5"
          )}
          onFocus={() => {
            if (locked) setEditingVerified(true);
            onInspect();
          }}
          onClick={() => {
            if (locked) setEditingVerified(true);
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.max(38, el.scrollHeight)}px`;
          }}
          onChange={(event) => {
            setText(event.target.value);
            setAlternative(undefined);
            setSuggestionSource(undefined);
          }}
          onBlur={() => {
            if (autosave && dirty) void persist(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void persist(true);
            }
          }}
        />
      ) : (money || hasUnit) ? (
        <div
          className={cn(
            "flex h-9 w-full items-center rounded-md border border-border/80 bg-white dark:bg-slate-900 shadow-sm hover:border-primary/50 hover:shadow focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/40 focus-within:shadow-sm transition-all duration-150",
            error && "border-destructive bg-destructive/5"
          )}
        >
          <input
            id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
            aria-label={label}
            value={text}
            readOnly={disabled}
            disabled={disabled}
            maxLength={350}
            type={type}
            step={numeric ? "any" : undefined}
            min={numeric ? "0" : undefined}
            placeholder={text ? undefined : "—"}
            className="h-full flex-1 border-0 bg-transparent px-3 text-xs text-foreground outline-none cursor-text [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            onFocus={() => {
              if (locked) setEditingVerified(true);
              onInspect();
            }}
            onClick={() => {
              if (locked) setEditingVerified(true);
            }}
            onChange={(event) => {
              setText(event.target.value);
              setAlternative(undefined);
              setSuggestionSource(undefined);
            }}
            onBlur={() => {
              if (autosave && dirty) void persist(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void persist(true);
              }
            }}
          />
          <span className="shrink-0 text-[11px] font-mono font-semibold uppercase text-muted-foreground px-2.5 select-none">
            {dimension || (money ? "USD" : "")}
          </span>
        </div>
      ) : (
        <input
          id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
          aria-label={label}
          value={text}
          readOnly={disabled}
          disabled={disabled}
          maxLength={350}
          type={type}
          step={numeric ? "any" : undefined}
          min={numeric ? "0" : undefined}
          placeholder={text ? undefined : "—"}
          className={cn(
            "h-9 w-full rounded-md border border-border/80 bg-white dark:bg-slate-900 shadow-sm hover:border-primary/50 hover:shadow focus:border-primary focus:ring-1 focus:ring-primary/40 focus:shadow-sm px-3 text-xs text-foreground outline-none transition-all duration-150 cursor-text",
            numeric ? "font-mono tabular-nums" : "text-left",
            error && "border-destructive bg-destructive/5"
          )}
          onFocus={() => {
            if (locked) setEditingVerified(true);
            onInspect();
          }}
          onClick={() => {
            if (locked) setEditingVerified(true);
          }}
          onChange={(event) => {
            setText(event.target.value);
            setAlternative(undefined);
            setSuggestionSource(undefined);
          }}
          onBlur={() => {
            if (autosave && dirty) void persist(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void persist(true);
            }
          }}
        />
      )}
      {error && <p role="alert" className="text-[10px] text-destructive">{error}</p>}

      <Dialog open={emptyDescAlert} onOpenChange={setEmptyDescAlert}>
        <DialogContent className="max-w-md p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400 shrink-0">
              <AlertTriangle className="size-5" />
            </div>
            <div className="space-y-1.5 flex-1 min-w-0">
              <DialogTitle className="text-sm font-semibold text-foreground">
                Incomplete Description
              </DialogTitle>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Item description cannot be left empty. Descriptions must be complete to verify imports and create permit drafts.
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async (e) => {
                setEmptyDescAlert(false);
                await handleUndo(e);
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Revert to original
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => {
                setEmptyDescAlert(false);
                const el = textareaRef.current || (typeof window !== "undefined" ? window.document.getElementById(`verify-${target.role}-${target.row ?? "header"}-${target.name}`) : null);
                if (el) (el as HTMLElement).focus();
              }}
              className="text-xs"
            >
              Keep editing
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

