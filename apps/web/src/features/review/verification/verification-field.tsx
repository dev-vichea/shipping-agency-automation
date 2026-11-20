"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
  const [editingVerified, setEditingVerified] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [alternative, setAlternative] = useState<number>();
  const [suggestionSource, setSuggestionSource] = useState<ReviewField>();
  const [emptyDescAlert, setEmptyDescAlert] = useState(false);
  const [lineSuggestionsOpen, setLineSuggestionsOpen] = useState(false);

  const money = ["unit_price", "amount"].includes(target.name);
  const hasUnit = ["gross_weight", "net_weight", "packages", "measurement"].includes(target.name);
  const dimension = money ? safeField.currency ?? "" : safeField.unit ?? "";

  const inFlight = useRef(false);
  const confirmAfterSave = useRef(false);
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

  const verified = !!correction && correction.confirmed !== false;
  const locked = verified && !editingVerified;
  const canAutosave = autosave && !verified;
  const isChanged =
    Boolean(correction) ||
    (Boolean(rawField) &&
      text !== (rawField?.value ?? "") &&
      text.trim() !== (rawField?.value ?? "").trim());

  const handleUndo = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setText(verified ? safeField.value ?? "" : rawField?.value ?? "");
    setAlternative(undefined);
    setSuggestionSource(undefined);
    setError("");
    if (verified) {
      setEditingVerified(false);
      setNote("");
    } else if (onUndo) {
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

  async function persist(confirmed: boolean, overrideValue?: string, overrideSource?: ReviewField) {
    const val = overrideValue !== undefined ? overrideValue : text;
    const src = overrideValue === undefined ? suggestionSource : overrideSource;
    if (!val.trim() || disabled || locked || (verified && (!confirmed || !note.trim()))) return;
    if (confirmed && inFlight.current) {
      confirmAfterSave.current = true;
      return;
    }
    if (inFlight.current) return;
    const fingerprint = JSON.stringify([val.trim(), dimension, confirmed, alternative, src]);
    if (!confirmed && lastSubmitted.current === fingerprint) return;
    inFlight.current = true;
    lastSubmitted.current = fingerprint;
    setSaving(true);
    setError("");
    try {
      const chosenSource = sourceChoices.find(
        (entry) =>
          entry.source.document_id === src?.document_id &&
          entry.source.role === src?.role &&
          entry.source.row === src?.row &&
          entry.source.name === src?.name
      )?.field;
      await onSave({
        value: val.trim(),
        unit: chosenSource ? chosenSource.unit : hasUnit ? dimension || null : field.unit,
        currency: money ? dimension || null : chosenSource ? chosenSource.currency : field.currency,
        confirmed,
        note: note.trim() || (confirmed ? "Confirmed individually." : "Autosaved edit."),
        alternative_index: alternative,
        suggestion_source: src,
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
    if (!canAutosave || !dirty || disabled || !text.trim()) return;
    const timer = setTimeout(() => void persistLatest(false), 650);
    return () => clearTimeout(timer);
  }, [canAutosave, dirty, disabled, text, dimension, saving]);

  // Header field suggestions combobox options
  const headerComboboxOptions: ComboboxOption<VerificationSourceChoice>[] = useMemo(() => {
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

    return list;
  }, [sourceChoices, suggestion, target.name]);

  function selectSource(value: string, source?: ReviewField) {
    setText(value);
    setError("");
    setAlternative(undefined);
    setSuggestionSource(source);
    if (canAutosave) void persist(false, value, source);
  }

  const reviewControls = !disabled && (locked ? (
    <Button type="button" size="xs" variant="outline"
      aria-label={`Edit verified ${label}`} onClick={() => setEditingVerified(true)}>
      Edit verified
    </Button>
  ) : (dirty || correction) && (
    <div className="flex flex-wrap items-center gap-1">
      {verified && editingVerified && (
        <Input aria-label={`Reason for ${label}`} placeholder="Reason for change"
          className="h-6 min-w-0 text-xs" maxLength={1000} value={note}
          onChange={(event) => setNote(event.target.value)} />
      )}
      {!autosave && !verified && dirty && (
        <Button type="button" size="xs" variant="outline" disabled={saving || !text.trim()}
          aria-label={`Save edit for ${label}`} onClick={() => void persist(false)}>
          Save edit
        </Button>
      )}
      <Button type="button" size="xs" variant="outline"
        disabled={saving || !text.trim() || (verified && (!dirty || !note.trim()))}
        aria-label={`Confirm ${label}`} onClick={() => void persist(true)}>
        Confirm
      </Button>
    </div>
  ));

  // Compact mode for table cells (simple, clean input, no icons, no overflow, flexible text)
  if (compact) {
    const isTotal = target.row === null;
    const unitSuffix = isTotal ? (dimension || field.currency || field.unit) : null;
    const isDescription = target.name === "description";
    const isUnit = target.name === "unit";

    return (
      <div className="w-full min-w-0" data-field-state={status}>
        {isDescription ? (
          <div className="flex items-center w-full min-w-0 gap-1">
            <textarea
              id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
              aria-label={label}
              value={text}
              readOnly={disabled || locked}
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
                setSuggestionSource(undefined);
              }}
              onBlur={() => {
                if (target.name === "description" && !text.trim()) {
                  setEmptyDescAlert(true);
                  return;
                }
                if (canAutosave && dirty) void persist(false);
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
            {isChanged && !verified && onUndo && (
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
              readOnly={disabled || locked}
              compact
              numeric={false}
              popoverWidth="w-[280px]"
              headerTitle="Select Unit"
              options={COMMON_SHIPPING_UNITS}
              onChange={(val) => {
                setText(val);
                if (error) setError("");
                setAlternative(undefined);
                setSuggestionSource(undefined);
              }}
              onSelectOption={(opt) => selectSource(opt.value)}
              onFocus={onInspect}
              onBlur={() => {
                if (canAutosave && dirty) void persist(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void persist(true);
                }
              }}
              error={error}
            />
            {isChanged && !verified && onUndo && (
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
            <input
              id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
              aria-label={label}
              value={text}
              readOnly={disabled || locked}
              disabled={disabled}
              type={numeric ? "text" : type}
              inputMode={numeric ? "decimal" : undefined}
              step={numeric ? "any" : undefined}
              min={numeric ? "0" : undefined}
              placeholder={text ? undefined : "—"}
              className={cn(
                "h-7 flex-1 min-w-0 rounded border border-transparent bg-transparent hover:border-border/60 hover:bg-background/40 hover:shadow-2xs focus:border-primary focus:bg-background focus:ring-1 focus:ring-primary/40 focus:shadow-xs px-1.5 text-xs text-foreground outline-none transition-all duration-150 cursor-text",
                numeric ? "font-mono text-right tabular-nums" : "text-left",
                isTotal && "font-semibold",
                error && "border-destructive bg-destructive/5"
              )}
              onFocus={onInspect}
              onChange={(event) => {
                setText(event.target.value);
                if (error) setError("");
                setAlternative(undefined);
                setSuggestionSource(undefined);
              }}
              onBlur={() => {
                if (canAutosave && dirty) void persist(false);
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
            {isChanged && !verified && onUndo && (
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
        {!disabled && !locked && numeric && target.row !== null && sourceChoices.length > 0 && (
          <div>
            <Button type="button" size="icon-xs" variant="ghost" aria-label={`Suggestions for ${label}`}
              aria-expanded={lineSuggestionsOpen} onClick={() => setLineSuggestionsOpen((open) => !open)}>
              <ChevronDown aria-hidden />
            </Button>
            {lineSuggestionsOpen && (
              <NativeSelect aria-label={`Source suggestions for ${label}`} className="max-w-full" value=""
                onChange={(event) => {
                  if (event.target.value === "") return;
                  const choice = sourceChoices[Number(event.target.value)];
                  if (choice?.field.value) selectSource(choice.field.value, choice.source);
                  setLineSuggestionsOpen(false);
                }}>
                <option value="">Choose cited value</option>
                {sourceChoices.map((choice, index) => (
                  <option key={index} value={index}>{choice.field.value} · {choice.label}</option>
                ))}
              </NativeSelect>
            )}
          </div>
        )}
        {reviewControls}
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
        {isChanged && !verified && onUndo && (
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

      {isAddress ? (
        <textarea
          ref={textareaRef}
          id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
          aria-label={label}
          value={text}
          readOnly={disabled || locked}
          disabled={disabled}
          maxLength={500}
          rows={1}
          placeholder={text ? undefined : "—"}
          style={{ fieldSizing: "content" } as React.CSSProperties}
          className={cn(
            "w-full min-h-[30px] resize-none overflow-hidden rounded-md border border-border/80 bg-white dark:bg-slate-900 shadow-2xs hover:border-primary/50 hover:shadow-xs focus:border-primary focus:ring-1 focus:ring-primary/40 focus:shadow-xs px-2.5 py-1.5 text-xs text-foreground outline-none transition-all duration-150 cursor-text leading-snug whitespace-pre-wrap break-words",
            error && "border-destructive bg-destructive/5"
          )}
          onFocus={onInspect}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.max(30, el.scrollHeight)}px`;
          }}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError("");
            setAlternative(undefined);
            setSuggestionSource(undefined);
          }}
          onBlur={() => {
            if (canAutosave && dirty) void persist(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void persist(true);
            }
          }}
        />
      ) : (
        <Combobox
          id={`verify-${target.role}-${target.row ?? "header"}-${target.name}`}
          ariaLabel={label}
          value={text}
          disabled={disabled}
          readOnly={disabled || locked}
          multiline={["cargo_summary", "description", "remark"].includes(target.name)}
          numeric={numeric}
          type={type}
          headerTitle={`${documentFieldLabel(target.name)} Suggestions`}
          popoverWidth="w-[380px]"
          options={headerComboboxOptions}
          showWhenEmpty={false}
          rightAdornment={
            headerComboboxOptions.length > 0 ? (
              <ChevronDown className="size-3 text-muted-foreground/40 absolute right-2 pointer-events-none" />
            ) : undefined
          }
          inputClassName={headerComboboxOptions.length > 0 ? "pr-7" : ""}
          onChange={(val) => {
            setText(val);
            if (error) setError("");
            setAlternative(undefined);
            setSuggestionSource(undefined);
          }}
          onSelectOption={(opt) => {
            setText(opt.value);
            if (error) setError("");
            const source = (opt.data as VerificationSourceChoice | undefined)?.source;
            selectSource(opt.value, source);
          }}
          onFocus={onInspect}
          onBlur={() => {
            if (canAutosave && dirty) void persist(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void persist(true);
            }
          }}
          error={error}
        />
      )}
      {reviewControls}
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
