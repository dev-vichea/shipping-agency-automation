"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ExcelFileIcon, PdfFileIcon } from "@/components/ui/file-icon";
import { Button } from "@/components/ui/button";
import { FormError, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { write } from "@/lib/client-api";
import { toast } from "@/lib/toast";
import { useFormSubmission } from "@/lib/use-form-submission";
import type { Company, Receipt } from "@/lib/contracts";

export function IntakeForm({ caseId, revisionChoices = [], companies = [], defaultCompany = "", allowUnassigned = true }: {
  companies?: Company[]; defaultCompany?: string; allowUnassigned?: boolean;
  caseId?: string; revisionChoices?: { id: string; original_filename: string }[];
}) {
  const router = useRouter();
  const { error, busy, submit } = useFormSubmission();
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
      {!caseId && <FormField id="upload-company" label="Company">
        <NativeSelect required={!allowUnassigned} id="upload-company" name="company_id" defaultValue={defaultCompany} className="w-full">
          <option value="">{allowUnassigned ? "Unassigned" : "Select a company"}</option>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </NativeSelect>
      </FormField>}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="subject" label="Subject"><Input id="subject" name="subject" maxLength={200} placeholder="e.g. Supplier shipping documents" /></FormField>
        <FormField id="sender" label="Sender"><Input id="sender" name="sender" maxLength={254} /></FormField>
      </div>
      <FormField id="body" label="Message"><Textarea id="body" name="body" maxLength={16000} rows={3} /></FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="files" label="Attachments">
          <Input id="files" name="files" type="file" accept=".pdf,.xls,.xlsx" required={!caseId} multiple aria-describedby="file-limits" />
          <p id="file-limits" className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
            <PdfFileIcon size="xs" />
            <ExcelFileIcon size="xs" />
            <span>PDF, XLS or XLSX. Up to five files, 10 MB each.</span>
          </p>
        </FormField>
        <FormField id="classification" label="Attachment type">
          <NativeSelect id="classification" name="classification" className="w-full">
            <option value="other">Unclassified</option><option value="invoice">Invoice</option>
            <option value="packing_list">Packing list</option><option value="draft_bl">Draft B/L</option>
          </NativeSelect>
        </FormField>
      </div>
      {revisionChoices.length > 0 && <FormField id="parent_version_id" label="Revises an original (optional)">
        <NativeSelect id="parent_version_id" name="parent_version_id" aria-describedby="revision-info" className="w-full">
          <option value="">New attachment or message</option>
          {revisionChoices.map((doc) => <option key={doc.id} value={doc.id}>{doc.original_filename} · {doc.id.slice(0, 8)}</option>)}
        </NativeSelect>
        <p id="revision-info" className="text-body-sm text-muted-foreground">Attach one file when saving a revision.</p>
      </FormField>}
      <FormError error={error} />
      <Button type="submit" disabled={busy}>{busy ? "Uploading…" : caseId ? "Archive arrival" : "Upload and process"}</Button>
    </form>
  );
}
