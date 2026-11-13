"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { write } from "@/lib/client-api";
import type { MasterVersion } from "@/lib/contracts";

export function ReviewActions({ caseId, revision, selected, versions, pending }: {
  caseId: string; revision: number; selected?: MasterVersion; versions: MasterVersion[]; pending: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not complete the request.");
    } finally {
      setBusy(false);
    }
  }

  function choose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit(() => write(`/intakes/${caseId}/cdc-version`, {
      expected_revision: revision, version_id: form.get("version_id") || null,
    }));
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    if (!form.get("balance_as_of")) form.delete("balance_as_of");
    void submit(async () => {
      await write("/cdc/versions", form);
      element.reset();
    });
  }

  const options = selected && !versions.some((version) => version.id === selected.id)
    ? [selected, ...versions] : versions;

  return <div className="space-y-4 p-4">
    <form method="post" onSubmit={choose} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-56 space-y-2">
        <Label htmlFor="version_id">CDC Master List version</Label>
        <select id="version_id" name="version_id" key={selected?.id ?? "none"}
          defaultValue={selected?.id ?? ""} className="block h-9 w-full rounded-md border border-input bg-card px-2 text-sm">
          <option value="">No version selected</option>
          {options.map((version) => <option key={version.id} value={version.id}>
            {version.company} · {version.year} · {version.approval_ref} · {version.original_filename} · {version.id.slice(0, 8)}
          </option>)}
        </select>
      </div>
      <Button type="submit" variant="outline" disabled={busy}>Apply version</Button>
      <Button type="button" variant="outline" disabled={busy || pending} onClick={() =>
        void submit(() => write(`/intakes/${caseId}/process`, {expected_revision: revision}))
      }>Reprocess documents</Button>
    </form>
    {selected && <p className="text-sm text-muted-foreground">Balance date: {selected.balance_as_of ?? "Unknown"} ·{" "}
      <a className="font-medium text-primary hover:underline" href={`/api/v1/cdc/versions/${selected.id}/download`}>Download selected workbook</a>
    </p>}
    <details className="rounded-md border bg-background">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-primary">Register a verified workbook</summary>
      <form method="post" encType="multipart/form-data" onSubmit={register} className="space-y-3 border-t p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="master_company">Company on approval</Label><Input id="master_company" name="company" maxLength={254} required /></div>
          <div className="space-y-1"><Label htmlFor="approval_ref">Approval reference</Label><Input id="approval_ref" name="approval_ref" maxLength={160} required /></div>
          <div className="space-y-1"><Label htmlFor="master_year">Approval year</Label><Input id="master_year" name="year" type="number" min={2000} max={2100} required /></div>
          <div className="space-y-1"><Label htmlFor="balance_as_of">Balance as of (optional)</Label><Input id="balance_as_of" name="balance_as_of" type="date" /></div>
        </div>
        <div className="space-y-1"><Label htmlFor="master_file">Master List workbook</Label><Input id="master_file" name="file" type="file" accept=".xls,.xlsx" required /></div>
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" name="verified" value="true" required /> I checked this workbook against the approval for this company and year.</label>
        <Button type="submit" size="sm" disabled={busy}>Register workbook</Button>
      </form>
    </details>
    {error && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-destructive">{error}</p>}
  </div>;
}
