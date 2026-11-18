"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, FileSpreadsheet, ScanSearch } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useWrite } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogCloseButton, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { write } from "@/lib/client-api";
import type { Company, MasterVersion } from "@/lib/contracts";
import { label } from "@/lib/format";
import { scopedPath } from "@/lib/scope";

const fields = [
  { key: "company", name: "Company on approval", type: "text", maxLength: 254 },
  { key: "approval_ref", name: "Approval reference", type: "text", maxLength: 160 },
  { key: "year", name: "Approval year", type: "number" },
  { key: "balance_as_of", name: "Balance as of (optional)", type: "date" },
] as const;

type FieldName = typeof fields[number]["key"];
type Values = Record<FieldName, string>;
type Source = "workbook" | "pdf" | "ocr" | "filename";
type Suggestion = {
  value: string;
  method: "detected" | "ai";
  evidence: { source: Source; location: string; text: string };
};
type Preview = {
  fields: Partial<Record<FieldName, Suggestion>>;
  company_id: string | null;
  item_count: number;
  layout: string;
  warnings: string[];
  ai_state: "disabled" | "not_needed" | "reviewed" | "unavailable";
};
type Inspection = {
  workbook: File;
  approval: File | undefined;
  revision: number;
  result?: Preview;
  error?: string;
};

const emptyValues: Values = { company: "", approval_ref: "", year: "", balance_as_of: "" };
const sourceLabels: Record<Source, string> = { workbook: "Workbook", pdf: "PDF text", ocr: "OCR", filename: "Filename" };

export function RegisterMasterDialog({ companyId, companies, openVersion, outline, trigger }: {
  companyId?: string;
  companies?: Company[];
  openVersion?: boolean;
  outline?: boolean;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  function registered(version: MasterVersion) {
    setOpen(false);
    setSaved(true);
    toast.saved("Master List registered!");
    if (openVersion) router.replace(scopedPath(`/cdc?version=${version.id}`, companyId));
    router.refresh();
  }

  return <div className="flex flex-wrap items-center gap-2">
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setSaved(false); }}>
      <DialogTrigger asChild><Button type="button" variant={outline ? "outline" : "default"}>{trigger}</Button></DialogTrigger>
      <DialogContent className="max-w-2xl" aria-describedby={undefined}>
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-card px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-primary"><FileSpreadsheet size={18} aria-hidden /></span>
          <DialogTitle className="flex-1 text-headline-lg">Register Master List</DialogTitle>
          <DialogCloseButton />
        </div>
        <RegisterMasterForm companyId={companyId} companies={companies} onRegistered={registered} />
      </DialogContent>
    </Dialog>
    {saved && <span role="status" className="inline-flex items-center gap-1 text-xs font-medium text-success"><Check size={14} aria-hidden /> Master List registered.</span>}
  </div>;
}

function RegisterMasterForm({ companyId, companies, onRegistered }: {
  companyId?: string;
  companies?: Company[];
  onRegistered: (version: MasterVersion) => void;
}) {
  const prefix = useId();
  const [workbook, setWorkbook] = useState<File>();
  const [approval, setApproval] = useState<File>();
  const [revision, setRevision] = useState(0);
  const [inspection, setInspection] = useState<Inspection>();
  const [values, setValues] = useState(emptyValues);
  const [company, setCompany] = useState("");
  const [verified, setVerified] = useState(false);
  const { busy, error, submit } = useWrite();
  const current = inspection?.workbook === workbook && inspection?.approval === approval && inspection?.revision === revision ? inspection : undefined;
  const pending = !!workbook && !current;
  const result = current?.result;
  const suggestedCompany = !companyId && !company && companies?.some((entry) => entry.id === result?.company_id)
    ? result?.company_id : undefined;
  const canApply = !!suggestedCompany || fields.some(({ key }) => !values[key].trim() && result?.fields[key]);

  useEffect(() => {
    if (!workbook) return;
    const controller = new AbortController();
    const data = new FormData();
    data.set("file", workbook);
    if (approval) data.set("approval_pdf", approval);
    void write<Preview>("/cdc/versions/preview", data, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setInspection({ workbook, approval, revision, result });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setInspection({ workbook, approval, revision, error: cause instanceof Error ? cause.message : "Could not inspect this workbook." });
      });
    return () => controller.abort();
  }, [workbook, approval, revision]);

  function applySuggestions() {
    if (!result) return;
    setValues((previous) => {
      const next = { ...previous };
      for (const { key } of fields) {
        if (!next[key].trim()) next[key] = result.fields[key]?.value ?? "";
      }
      return next;
    });
    if (suggestedCompany) setCompany(suggestedCompany);
    setVerified(false);
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.delete("approval_pdf");
    if (!form.get("balance_as_of")) form.delete("balance_as_of");
    void submit(async () => {
      const version = await write<MasterVersion>("/cdc/versions", form);
      onRegistered(version);
    });
  }

  return <form method="post" encType="multipart/form-data" onSubmit={register}>
    <div className="space-y-5 px-5 py-4">
      <div className="grid items-start gap-3 rounded-lg border border-dashed border-input bg-background p-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${prefix}-workbook`}>Master List workbook</Label>
          <Input id={`${prefix}-workbook`} name="file" type="file" accept=".xls,.xlsx" required onChange={(event) => {
            setWorkbook(event.target.files?.[0]);
            setValues(emptyValues);
            setCompany("");
            setVerified(false);
            setRevision((previous) => previous + 1);
          }} />
          <p className="text-xs text-muted-foreground">XLS or XLSX</p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${prefix}-approval`}>Approval PDF <span className="text-muted-foreground">(optional)</span></Label>
          <Input id={`${prefix}-approval`} name="approval_pdf" type="file" accept=".pdf,application/pdf" onChange={(event) => {
            setApproval(event.target.files?.[0]);
            setVerified(false);
            setRevision((previous) => previous + 1);
          }} />
          <p className="text-xs text-muted-foreground">For suggestions. Scanned pages use OCR.</p>
        </div>
      </div>

      {pending && <div role="status" className="flex items-center gap-2 rounded-lg border bg-accent px-3 py-2 text-sm text-primary">
        <ScanSearch size={16} aria-hidden className="motion-safe:animate-pulse" /> Reading the workbook and looking for approval details…
      </div>}
      {current?.error && <div role="alert" className="field-error flex flex-wrap items-center justify-between gap-2">
        <span>{current.error}</span>
        <Button type="button" size="xs" variant="outline" onClick={() => setRevision((previous) => previous + 1)}>Try again</Button>
      </div>}
      {result && <section aria-label="Workbook findings" className="space-y-1.5 rounded-lg border bg-accent px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="status"><p className="font-medium">{result.item_count} {result.item_count === 1 ? "item" : "items"} detected</p><p className="text-xs text-muted-foreground">{label(result.layout)}</p></div>
          {(Object.keys(result.fields).length > 0 || result.company_id) && <Button type="button" size="sm" variant="outline" className="bg-card" disabled={!canApply} onClick={applySuggestions}><ScanSearch aria-hidden /> Apply suggestions</Button>}
        </div>
        {result.ai_state === "unavailable" && <p className="text-xs text-muted-foreground">AI suggestions are temporarily unavailable. Workbook and OCR findings are shown below.</p>}
        {result.warnings.map((warning) => <p key={warning} className="text-xs text-warning">{warning}</p>)}
      </section>}

      {companyId && <input type="hidden" name="company_id" value={companyId} />}
      {!!companies?.length && !companyId && <label className="grid gap-1.5 font-medium">Linked company
        <NativeSelect name="company_id" value={company} required onChange={(event) => { setCompany(event.target.value); setVerified(false); }}>
          <option value="">Choose company</option>
          {companies.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
        </NativeSelect>
      </label>}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ key, name, type, ...options }) => {
          const suggestion = result?.fields[key];
          const id = `${prefix}-${key}`;
          return <div key={key} className="min-w-0 space-y-1.5">
            <Label htmlFor={id}>{name}</Label>
            <Input id={id} name={key} type={type} value={values[key]} required={key !== "balance_as_of"}
              {...options} {...(key === "year" ? { min: 2000, max: 2100 } : {})}
              aria-describedby={suggestion ? `${id}-evidence` : undefined}
              onChange={(event) => { setValues((previous) => ({ ...previous, [key]: event.target.value })); setVerified(false); }} />
            {suggestion && <div id={`${id}-evidence`} className="space-y-0.5 break-words text-xs text-muted-foreground">
              <p className="font-medium">{suggestion.method === "ai" ? "AI suggestion" : sourceLabels[suggestion.evidence.source]} · {suggestion.evidence.location}</p>
              <p className="line-clamp-2" title={suggestion.evidence.text}>{suggestion.evidence.text}</p>
              {values[key] !== suggestion.value && <button type="button" className="data-link text-left"
                aria-label={`Use suggestion for ${name}`} onClick={() => {
                  setValues((previous) => ({ ...previous, [key]: suggestion.value }));
                  setVerified(false);
                }}>Use {suggestion.value}</button>}
            </div>}
          </div>;
        })}
      </div>

      <label className="flex items-start gap-2 text-body-md">
        <input className="mt-1" type="checkbox" name="verified" value="true" required checked={verified}
          onChange={(event) => setVerified(event.target.checked)} />
        I checked this workbook against the approval for this company and year.
      </label>
      {error && <p role="alert" className="field-error">{error}</p>}
    </div>
    <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t bg-card px-5 py-3">
      <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
      <Button type="submit" disabled={busy || pending || !workbook || !verified}>{busy ? "Registering…" : "Register workbook"}</Button>
    </div>
  </form>;
}
