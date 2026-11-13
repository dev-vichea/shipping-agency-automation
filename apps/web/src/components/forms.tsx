"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { write } from "@/lib/client-api";
import type { ImportSummary, Receipt } from "@/lib/contracts";

function ErrorMessage({ error }: { error: string }) {
  return error && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-destructive">{error}</p>;
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function useWrite() {
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

export function LoginForm() {
  const { error, busy, submit } = useWrite();
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit(async () => {
      await write("/auth/login", Object.fromEntries(form));
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear the router cache when the session changes.
      window.location.assign("/inbox");
    });
  }
  return <form method="post" onSubmit={handle} className="space-y-4">
    <Field id="email" label="Work email"><Input id="email" name="email" type="email" autoComplete="username" required /></Field>
    <Field id="password" label="Password"><Input id="password" name="password" type="password" autoComplete="current-password" maxLength={128} required /></Field>
    <ErrorMessage error={error} />
    <Button className="w-full" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
  </form>;
}

export function IntakeForm({ caseId, revisionChoices = [] }: {
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
      const receipt = await write<Receipt>("/intakes/simulate", form);
      setMessageId(undefined);
      if (caseId) {
        element.reset();
        router.refresh();
      } else {
        router.push(`/review/${receipt.case_id}`);
      }
    });
  }
  return (
    <form method="post" onSubmit={handle} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="subject" label="Subject"><Input id="subject" name="subject" maxLength={200} placeholder="e.g. Supplier shipping documents" /></Field>
        <Field id="sender" label="Sender"><Input id="sender" name="sender" maxLength={254} /></Field>
      </div>
      <Field id="body" label="Message"><Textarea id="body" name="body" maxLength={16000} rows={3} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="files" label="Attachments">
          <Input id="files" name="files" type="file" accept=".pdf,.xls,.xlsx" multiple aria-describedby="file-limits" />
          <p id="file-limits" className="text-xs text-muted-foreground">PDF, XLS or XLSX. Up to five files, 10 MB each.</p>
        </Field>
        <Field id="classification" label="Attachment type">
          <select id="classification" name="classification" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="other">Unclassified</option><option value="invoice">Invoice</option>
            <option value="packing_list">Packing list</option><option value="draft_bl">Draft B/L</option>
          </select>
        </Field>
      </div>
      {revisionChoices.length > 0 && <Field id="parent_version_id" label="Revises an original (optional)">
        <select id="parent_version_id" name="parent_version_id" aria-describedby="revision-info" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="">New attachment or message</option>
          {revisionChoices.map((doc) => <option key={doc.id} value={doc.id}>{doc.original_filename} · {doc.id.slice(0, 8)}</option>)}
        </select>
        <p id="revision-info" className="text-xs text-muted-foreground">Attach one file when saving a revision.</p>
      </Field>}
      <ErrorMessage error={error} />
      <Button type="submit" disabled={busy}>{busy ? "Archiving…" : "Archive arrival"}</Button>
    </form>
  );
}

export function DraftForm({ caseId }: { caseId: string }) {
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
      router.push(`/imports/${draft.id}`);
    });
  }
  return <form method="post" className="space-y-4" onSubmit={handle}>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="company" label="Company"><Input id="company" name="company" maxLength={254} required /></Field>
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
    router.refresh();
  })}>{busy ? "Queuing…" : children}</Button><ErrorMessage error={error} /></div>;
}

export function RefreshButton() {
  const router = useRouter();
  return <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>Refresh</Button>;
}
