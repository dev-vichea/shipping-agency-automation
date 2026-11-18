"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { write } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { Company, ImportSummary, Receipt } from "@/lib/contracts";

function ErrorMessage({ error }: { error: string }) {
  return error && <p role="alert" className="field-error">{error}</p>;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="space-y-1"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

export function useWrite() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, submit };
}

export function LoginForm({ destination = "/home" }: { destination?: string }) {
  const { error, busy, submit } = useWrite();
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit(async () => {
      await write("/auth/login", Object.fromEntries(form));
      window.location.assign(destination);
    });
  }
  return <form method="post" onSubmit={handle} className="space-y-3">
    <Field id="email" label="Work email"><Input id="email" name="email" type="email" autoComplete="username" required /></Field>
    <Field id="password" label="Password"><Input id="password" name="password" type="password" autoComplete="current-password" maxLength={128} required /></Field>
    <ErrorMessage error={error} />
    <Button className="w-full" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
  </form>;
}

export function IntakeForm({ caseId, revisionChoices = [], companies = [], defaultCompany = "", allowUnassigned = true }: {
  companies?: Company[]; defaultCompany?: string; allowUnassigned?: boolean;
  caseId?: string; revisionChoices?: { id: string; original_filename: string }[];
}) {
  const router = useRouter();
  const { error, busy, submit } = useWrite();
  const [messageId, setMessageId] = useState<string>();
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    for (const [key, value] of [...form]) {
      if (value === "" || (value instanceof File && !value.name)) form.delete(key);
    }
    if (caseId) form.set("intake_case_id", caseId);
    if (!form.has("provider_message_id")) {
      const generated = messageId ?? crypto.randomUUID();
      setMessageId(generated);
      form.set("provider_message_id", generated);
    }
    void submit(async () => {
      const receipt = await write<Receipt>("/intakes/upload", form);
      setMessageId(undefined);
      toast.saved(caseId ? "Arrival archived!" : "Intake uploaded!");
      if (caseId) {
        element.reset();
        router.refresh();
      } else {
        router.push(`/review/${receipt.case_id}`);
      }
    });
  }
  return (
    <form method="post" onSubmit={handle} className="space-y-3">
      {!caseId && <Field id="upload-company" label="Company">
        <NativeSelect required={!allowUnassigned} id="upload-company" name="company_id" defaultValue={defaultCompany} className="w-full">
          <option value="">{allowUnassigned ? "Unassigned" : "Select a company"}</option>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </NativeSelect>
      </Field>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="subject" label="Subject"><Input id="subject" name="subject" maxLength={200} placeholder="e.g. Supplier shipping documents" /></Field>
        <Field id="sender" label="Sender"><Input id="sender" name="sender" maxLength={254} /></Field>
      </div>
      <Field id="body" label="Message"><Textarea id="body" name="body" maxLength={16000} rows={3} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="files" label="Attachments">
          <Input id="files" name="files" type="file" accept=".pdf,.xls,.xlsx" required={!caseId} multiple aria-describedby="file-limits" />
          <p id="file-limits" className="text-body-sm text-muted-foreground">PDF, XLS or XLSX. Up to five files, 10 MB each.</p>
        </Field>
        <Field id="classification" label="Attachment type">
          <NativeSelect id="classification" name="classification" className="w-full">
            <option value="other">Unclassified</option><option value="invoice">Invoice</option>
            <option value="packing_list">Packing list</option><option value="draft_bl">Draft B/L</option>
          </NativeSelect>
        </Field>
      </div>
      {revisionChoices.length > 0 && <Field id="parent_version_id" label="Revises an original (optional)">
        <NativeSelect id="parent_version_id" name="parent_version_id" aria-describedby="revision-info" className="w-full">
          <option value="">New attachment or message</option>
          {revisionChoices.map((doc) => <option key={doc.id} value={doc.id}>{doc.original_filename} · {doc.id.slice(0, 8)}</option>)}
        </NativeSelect>
        <p id="revision-info" className="text-body-sm text-muted-foreground">Attach one file when saving a revision.</p>
      </Field>}
      <ErrorMessage error={error} />
      <Button type="submit" disabled={busy}>{busy ? "Uploading…" : caseId ? "Archive arrival" : "Upload and process"}</Button>
    </form>
  );
}

export function DraftForm({ caseId, company }: { caseId: string; company?: string | null }) {
  const router = useRouter();
  const { error, busy, submit } = useWrite();
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submit(async () => {
      const draft = await write<ImportSummary>("/imports", {
        intake_case_id: caseId, company: data.get("company"), invoice_no: data.get("invoice_no"),
        supplier: data.get("supplier") || null, consignee: data.get("consignee") || null,
      });
      toast.saved("Draft saved!");
      router.push(`/imports/${draft.id}`);
    });
  }
  return <form method="post" className="space-y-3" onSubmit={handle}>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="company" label="Company"><Input id="company" name="company" defaultValue={company ?? ""} maxLength={254} required /></Field>
      <Field id="invoice_no" label="Invoice number"><Input id="invoice_no" name="invoice_no" maxLength={160} required /></Field>
      <Field id="supplier" label="Supplier"><Input id="supplier" name="supplier" maxLength={254} /></Field>
      <Field id="consignee" label="Consignee"><Input id="consignee" name="consignee" maxLength={254} /></Field>
    </div>
    <ErrorMessage error={error} /><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save import draft"}</Button>
  </form>;
}

export function AutomationAction({ path, children }: { path: string; children: ReactNode }) {
  const router = useRouter();
  const { error, busy, submit } = useWrite();
  return <div><Button variant="outline" size="sm" disabled={busy} onClick={() => void submit(async () => {
    await write(path);
    toast.updated("Queued run");
    router.refresh();
  })}>{busy ? "Queuing…" : children}</Button><ErrorMessage error={error} /></div>;
}

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      title="Refresh"
      aria-label="Refresh"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RotateCw aria-hidden className={cn("size-4", pending && "animate-spin")} />
    </Button>
  );
}
