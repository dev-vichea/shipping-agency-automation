"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import {
  COMMON_COUNTRIES,
  COMMON_DESTINATIONS,
  COMMON_ORIGINS,
  COMMON_PORTS,
  COMMON_SHIPPING_UNITS,
  COMMON_TRANSPORT_MODES,
} from "@/features/review/verification/shipping-units";
import type { Evidence, ExtractedField, ReviewCorrection, ReviewField } from "@/lib/contracts";
import { documentFieldLabel } from "@/lib/format";
import { dateFields, numericFields } from "@/features/review/verification/verification-review";
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
  const safeField = field ?? rawField ?? { status: "missing" as const, value: "", confidence: 1, evidence: [] };
  const [text, setText] = useState(safeField.value ?? "");
  const [previous, setPrevious] = useState(safeField.value);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [alternative, setAlternative] = useState<number>();
  const [emptyDescAlert, setEmptyDescAlert] = useState(false);

  const money = ["unit_price", "amount"].includes(target.name);
  const hasUnit = ["gross_weight", "net_weight", "packages", "measurement"].includes(target.name);
  const dimension = money ? safeField.currency ?? "" : safeField.unit ?? "";

  const inFlight = useRef(false);
  const lastSubmitted = useRef<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.max(30, textareaRef.current.scrollHeight)}px`;
    }
  }, [text]);

  if (safeField.value !== previous) {
    setPrevious(safeField.value);
    setText(safeField.value ?? "");
  }

  const verified = !compact && !!correction;
  const canAutosave = autosave;
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
    setError("");
    if (onUndo) {
      await onUndo();
    }
  };

  const dirty =
    text.trim() !== (safeField.value ?? "").trim() ||
    ((money || hasUnit) && dimension !== (money ? safeField.currency ?? "" : safeField.unit ?? ""));
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

  async function persist(overrideValue?: string) {
    const val = overrideValue !== undefined ? overrideValue : text;
    if (!val.trim() || disabled) return;
    if (inFlight.current) return;
    const fingerprint = JSON.stringify([val.trim(), dimension, alternative]);
    if (lastSubmitted.current === fingerprint) return;
    inFlight.current = true;
    lastSubmitted.current = fingerprint;
    setSaving(true);
    setError("");
    try {
      const chosenSource = sourceChoices.find((entry) => entry.field?.value === val.trim())?.field;
      await onSave({
        value: val.trim(),
        unit: chosenSource ? chosenSource.unit : hasUnit ? dimension || null : field.unit,
        currency: money ? dimension || null : chosenSource ? chosenSource.currency : field.currency,
        confirmed: true,
        note: "Staff edit.",
        alternative_index: alternative,
      });
    } catch (cause) {
      lastSubmitted.current = undefined;
      setError(cause instanceof Error ? cause.message : "Could not save this value.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const persistLatest = useEffectEvent(() => persist());
  useEffect(() => {
    if (saving) return;
    if (!canAutosave || !dirty || disabled || !text.trim()) return;
    const timer = setTimeout(() => void persistLatest(), 650);
    return () => clearTimeout(timer);
  }, [canAutosave, dirty, disabled, text, dimension, saving]);

  // Combobox options for source choices and suggestions
  const comboboxOptions: ComboboxOption<VerificationSourceChoice>[] = useMemo(() => {
    const list: ComboboxOption<VerificationSourceChoice>[] = [];

    if (sourceChoices.length > 0) {
      for (const sc of sourceChoices) {
        list.push({
          value: sc.field?.value ?? "",
          label: sc.field?.value ?? "",
          description: sc.label,
          badge: sc.source.role.replaceAll("_", " "),
          category: "Document Sources",
          data: sc,
        });
      }
    }

    if (suggestion?.value && !list.some((opt) => opt.value === suggestion.value)) {
      list.push({
        value: suggestion.value,
        label: suggestion.value,
        description: "Rule / AI extraction suggestion",
        badge: "Suggested",
        badgeVariant: "warning",
        category: "Suggestions",
      });
    }

    if (target.row === null) {
      if (target.name === "transport_mode" || target.name === "shipping_mode") {
        list.push(...(COMMON_TRANSPORT_MODES as ComboboxOption<VerificationSourceChoice>[]));
      } else if (target.name === "origin") {
        list.push(...(COMMON_ORIGINS as ComboboxOption<VerificationSourceChoice>[]));
      } else if (target.name === "destination") {
        list.push(...(COMMON_DESTINATIONS as ComboboxOption<VerificationSourceChoice>[]));
      } else if (target.name === "port") {
        list.push(...(COMMON_PORTS as ComboboxOption<VerificationSourceChoice>[]));
      } else if (target.name === "country_of_origin") {
        list.push(...(COMMON_COUNTRIES as ComboboxOption<VerificationSourceChoice>[]));
      }
    }

    return list;
  }, [sourceChoices, suggestion, target.name, target.row]);

  function selectSource(value: string) {
    setText(value);
    setError("");
    setAlternative(undefined);
    if (canAutosave) void persist(value);
  }

  // Compact mode for table cells (simple, clean input, no icons, no overflow, flexible text)
  if (compact) {
    const isTotal = target.row === null;
    const unitSuffix = isTotal ? (dimension || field.currency || field.unit) : null;
    const isDescription = target.name === "description";
    const isUnit = target.name === "unit";
    const isAmount = target.name === "amount";

    return (
      <div className="w-full min-w-0" data-field-state={status}>
        {isDescription ? (
          <div className="flex items-center w-full min-w-0 gap-1">
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
              onFocus={onInspect}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${el.scrollHeight}px`;
              }}
              onChange={(event) => {
                setText(event.target.value);
                if (error) setError("");
                setAlternative(undefined);
              }}
              onBlur={() => {
                if (target.name === "description" && !text.trim()) {
                  setEmptyDescAlert(true);
                  return;
                }
                if (canAutosave && dirty) void persist();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (target.name === "description" && !text.trim()) {
                    setEmptyDescAlert(true);
                    return;
                  }
                  void persist();
                }
              }}
            />
            {isChanged && onUndo && (
              <button
                type="button"
                title="Undo change (revert to original)"
                aria-label={`Undo change for ${label}`}
                onClick={handleUndo}
                className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer flex items-center"
              >
                <RotateCcw className="size-3" />
              </button>
            )}
          </div>
        ) : isUnit ? (
          <div className="flex items-center w-full min-w-0 gap-1 justify-end">
            <Combobox
              id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
              ariaLabel={label}
              value={text}
              disabled={disabled}
              readOnly={disabled}
              compact
              numeric={false}
              popoverWidth="w-[280px]"
              headerTitle="Select Unit"
              options={COMMON_SHIPPING_UNITS}
              onChange={(val) => {
                setText(val);
                if (error) setError("");
                setAlternative(undefined);
              }}
              onSelectOption={(opt) => selectSource(opt.value)}
              onFocus={onInspect}
              onBlur={() => {
                if (canAutosave && dirty) void persist();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void persist();
                }
              }}
              error={error}
            />
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
        ) : isAmount ? (
          <div className="flex items-center w-full min-w-0 gap-1 justify-end">
            <input
              id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
              aria-label={label}
              value={text}
              readOnly={disabled}
              disabled={disabled}
              type="text"
              inputMode="decimal"
              placeholder={text ? undefined : "—"}
              className={cn(
                "h-7 flex-1 min-w-0 rounded border border-transparent bg-transparent hover:border-border/60 hover:bg-background/40 hover:shadow-2xs focus:border-primary focus:bg-background focus:ring-1 focus:ring-primary/40 focus:shadow-xs px-1.5 text-xs text-foreground outline-none transition-all duration-150 cursor-text font-mono text-right tabular-nums",
                isTotal && "font-semibold",
                error && "border-destructive bg-destructive/5"
              )}
              onFocus={onInspect}
              onChange={(event) => {
                setText(event.target.value);
                if (error) setError("");
                setAlternative(undefined);
              }}
              onBlur={() => {
                if (canAutosave && dirty) void persist();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void persist();
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
        ) : (
          <div className="flex items-center w-full min-w-0 gap-1 justify-end">
            <Combobox
              id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
              ariaLabel={label}
              value={text}
              disabled={disabled}
              readOnly={disabled}
              compact
              numeric={numeric}
              type={numeric ? "text" : type}
              inputMode={numeric ? "decimal" : undefined}
              popoverWidth="w-[280px]"
              align={numeric ? "end" : "start"}
              headerTitle={comboboxOptions.length > 0 ? `${documentFieldLabel(target.name)} Suggestions` : undefined}
              options={comboboxOptions}
              filterOptions={false}
              showWhenEmpty={false}
              placeholder={text ? undefined : "—"}
              inputClassName={cn(isTotal && "font-semibold")}
              onChange={(val) => {
                setText(val);
                if (error) setError("");
                setAlternative(undefined);
              }}
              onSelectOption={(opt) => {
                selectSource(opt.value);
              }}
              onFocus={onInspect}
              onBlur={() => {
                if (canAutosave && dirty) void persist();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void persist();
                }
              }}
              error={error}
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
        {error && <p role="alert" className="text-[9px] text-destructive">{error}</p>}
      </div>
    );
  }

  // Header field mode (clean form field with label on top, flexible expanding text, subtle border & soft shadow)
  const isAddress = target.name.endsWith("address") || target.name === "address";

  return (
    <div className="group/field w-full min-w-0 space-y-1" data-field-state={status}>
      <div className="flex items-center justify-between">
        <label
          htmlFor={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
          className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {documentFieldLabel(target.name)}
        </label>
      </div>

      {dateFields.has(target.name) ? (
        <DatePicker
          id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
          ariaLabel={label}
          value={text}
          disabled={disabled}
          readOnly={disabled}
          placeholder="DD/MM/YYYY"
          sourceOptions={sourceChoices.map((sc) => ({
            value: sc.field?.value ?? "",
            label: sc.label,
            badge: sc.source.role.replaceAll("_", " "),
          }))}
          onChange={(val) => {
            setText(val);
            if (error) setError("");
            setAlternative(undefined);
            if (canAutosave) void persist(val);
          }}
          onFocus={onInspect}
          onBlur={() => {
            if (canAutosave && dirty) void persist();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void persist();
            }
          }}
          error={error}
        />
      ) : (
        <Combobox
          id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
          ariaLabel={label}
          value={text}
          disabled={disabled}
          readOnly={disabled}
          multiline={isAddress || ["cargo_summary", "description", "remark"].includes(target.name)}
          numeric={numeric}
          type={type}
          headerTitle={comboboxOptions.length > 0 ? `${documentFieldLabel(target.name)} Suggestions` : undefined}
          popoverWidth={isAddress ? "w-[420px]" : "w-[380px]"}
          options={comboboxOptions}
          showWhenEmpty={false}
          autoOpenOnFocus={true}
          rightAdornment={
            comboboxOptions.length > 0 ? (
              <ChevronDown className="size-3 text-muted-foreground/40 absolute right-2 pointer-events-none" />
            ) : undefined
          }
          inputClassName={comboboxOptions.length > 0 && !isAddress ? "pr-7" : ""}
          onChange={(val) => {
            setText(val);
            if (error) setError("");
            setAlternative(undefined);
          }}
          onSelectOption={(opt) => {
            selectSource(opt.value);
          }}
          onFocus={onInspect}
          onBlur={() => {
            if (canAutosave && dirty) void persist();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void persist();
            }
          }}
          error={error}
        />
      )}

      {(error || (isChanged && onUndo)) && (
        <div className="flex items-center justify-between text-[10px] min-h-[16px] px-0.5">
          {error ? (
            <p role="alert" className="text-destructive leading-tight">{error}</p>
          ) : <span />}
          {isChanged && onUndo && (
            <button
              type="button"
              title="Undo change (revert to original)"
              aria-label={`Undo change for ${documentFieldLabel(target.name)}`}
              onClick={handleUndo}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors cursor-pointer ml-auto"
            >
              <RotateCcw className="size-2.5" />
              <span>Undo</span>
            </button>
          )}
        </div>
      )}

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
