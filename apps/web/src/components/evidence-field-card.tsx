"use client";

import { useState, type FormEvent, type MouseEvent } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import type { ConsigneeSourceRef, Evidence } from "@/lib/contracts";
import { location } from "@/lib/format";
import { cn } from "@/lib/utils";

export type FieldChoice = {
  id: string;
  label: string;
  value: string;
  unit: string | null;
  currency: string | null;
  evidence: Evidence;
  issueKey?: string;
  alternativeIndex?: number;
  consigneeSource?: ConsigneeSourceRef;
};

export type FieldEdit = {
  value: string;
  unit: string | null;
  currency: string | null;
  choice?: FieldChoice;
};

export type FieldEditor = {
  value: string;
  unit: string | null;
  currency: string | null;
  dimension?: "unit" | "currency";
  multiline: boolean;
  reviewed: boolean;
  busy: boolean;
  choices: FieldChoice[];
  onPreview: (choice?: FieldChoice) => void;
  onSave: (edit: FieldEdit) => Promise<void>;
  onUndo: () => Promise<void>;
};

export function EvidenceFieldCard({ name, value, evidence, uncertain, editor, onClose }: {
  name: string; value: string; evidence?: Evidence; uncertain?: boolean; editor?: FieldEditor; onClose: () => void;
}) {
  const [text, setText] = useState(editor?.value ?? "");
  const [dimension, setDimension] = useState(editor?.dimension ? editor[editor.dimension] ?? "" : "");
  const [chosen, setChosen] = useState<FieldChoice>();
  const [showChoices, setShowChoices] = useState(false);
  const [error, setError] = useState("");
  const ValueInput = editor?.multiline ? "textarea" : "input";
  const dirty = editor && (text.trim() !== editor.value || !!chosen ||
    (!!editor.dimension && dimension.trim() !== (editor[editor.dimension] ?? "")));

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      setShowChoices(false);
      setChosen(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this field.");
    }
  }

  function submit(event: FormEvent<HTMLElement>) {
    event.preventDefault();
    if (!editor || editor.busy || !text.trim() || (editor.reviewed && !dirty)) return;
    const unit = editor.dimension === "unit" ? dimension.trim() || null : chosen ? chosen.unit : editor.unit;
    const currency = editor.dimension === "currency" ? dimension.trim() || null : chosen ? chosen.currency : editor.currency;
    void run(() => editor.onSave({ value: text.trim(), unit, currency, choice: chosen }));
  }

  function keepChoicesOpen(event: MouseEvent<HTMLButtonElement>) {
    // WebKit can move focus to the viewer before delivering a button click.
    if (showChoices && event.button === 0) event.preventDefault();
  }

  const iconButton = "flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-40";
  const textInput = "min-w-0 appearance-none rounded-xs border-0 bg-transparent p-0 [font:inherit] outline-none focus-visible:bg-primary/5 focus-visible:outline-1 focus-visible:outline-primary/50";
  const CardContent = editor ? "form" : "div";

  return <section aria-label={editor ? `Edit ${name}` : name}
    className="rounded-lg border border-slate-200/95 bg-white p-3 text-left shadow-2xl ring-1 ring-slate-900/10 dark:border-slate-800 dark:bg-slate-900 dark:ring-white/10"
    onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setShowChoices(false);
    }} onKeyDown={(event) => {
      if (event.key === "Escape" && showChoices) {
        event.stopPropagation();
        setShowChoices(false);
      }
    }}>
    <CardContent onSubmit={editor ? submit : undefined}>
      <div className="space-y-1">
        {editor ? <div className="font-mono text-xs leading-4 font-bold text-foreground">
          <div className="flex items-baseline gap-1 px-0.5">
            <ValueInput aria-label={`${name} value`} value={text} maxLength={350} required
              disabled={editor.busy} rows={editor.multiline ? 1 : undefined} autoComplete="off"
              className={cn(textInput, "field-sizing-content block resize-none", editor.dimension ? "flex-initial min-w-[1ch]" : "w-full flex-1")}
              onFocus={() => setShowChoices(true)} onClick={() => setShowChoices(true)}
              onChange={(event) => {
                if (chosen?.consigneeSource) editor.onPreview();
                setText(event.target.value);
                setChosen(undefined);
              }} />
            {editor.dimension && (
              <>
                <span className="text-muted-foreground/40 font-mono text-xs select-none px-1" aria-hidden="true">|</span>
                <input name={editor.dimension} aria-label={editor.dimension === "unit" ? "Unit" : "Currency"}
                  disabled={editor.busy} value={dimension} maxLength={editor.dimension === "unit" ? 24 : 5}
                  placeholder={editor.dimension === "unit" ? "KG" : "USD"}
                  className={`${textInput} field-sizing-content min-w-[3ch] max-w-[12ch] uppercase font-semibold`}
                  onChange={(event) => { setDimension(event.target.value); setChosen(undefined); }} />
              </>
            )}
            {editor.dimension !== "unit" && editor.unit && (
              <>
                <span className="text-muted-foreground/40 font-mono text-xs select-none px-1" aria-hidden="true">|</span>
                <span className="text-muted-foreground font-semibold uppercase">{editor.unit}</span>
              </>
            )}
          </div>
          {showChoices && editor.choices.length > 0 && <ul aria-label="Field suggestions"
            className="mt-1 max-h-32 overflow-auto rounded-control border bg-popover p-0.5 font-sans font-normal shadow-sm">
            {editor.choices.map((choice) => <li key={choice.id}>
              <button type="button" disabled={editor.busy} className="w-full rounded-sm px-1.5 py-1 text-left text-xs hover:bg-muted focus-visible:bg-muted"
                onMouseDown={keepChoicesOpen}
                onClick={() => {
                  setChosen(choice);
                  setText(choice.value);
                  if (editor.dimension) setDimension(choice[editor.dimension] ?? "");
                  editor.onPreview(choice);
                  setShowChoices(false);
                }}>
                <span className="block break-words">{choice.value}</span>
                <span className="block text-[10px] text-muted-foreground">{choice.label}</span>
              </button>
            </li>)}
          </ul>}
        </div> : <p className="px-0.5 font-mono text-xs font-bold break-words whitespace-pre-wrap text-foreground">{value || evidence?.raw}</p>}
        <div className="flex flex-wrap items-center justify-between gap-x-2 border-t border-slate-100 px-0.5 pt-0.5 text-[11px] text-muted-foreground dark:border-slate-800">
          <span className="font-medium">{name}</span>
          {evidence && <span className="font-mono">{location(evidence)}</span>}
          {uncertain && !editor?.reviewed && <span className="text-warning">Uncertain</span>}
        </div>
      </div>

      {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}

      <div className="mt-2.5 flex items-center justify-end gap-1.5 border-t border-slate-100 pt-1.5 dark:border-slate-800">
        {editor?.reviewed && <button type="button" className={iconButton} disabled={editor.busy}
          aria-label={`Undo ${name} review`} onMouseDown={keepChoicesOpen}
          onClick={() => void run(editor.onUndo)}><RotateCcw size={13} aria-hidden /></button>}
        {editor && <button type="submit" className={cn(iconButton, "text-success hover:text-success")} aria-label={`Save ${name}`}
          onMouseDown={keepChoicesOpen}
          disabled={editor.busy || !text.trim() || (editor.reviewed && !dirty)}><Check size={15} aria-hidden /></button>}
        <button type="button" className={iconButton} aria-label="Clear evidence selection" onMouseDown={keepChoicesOpen} onClick={onClose}><X size={14} aria-hidden /></button>
      </div>
    </CardContent>
  </section>;
}
