"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RegisterMasterDialog } from "@/components/register-master-dialog";
import { write } from "@/lib/client-api";
import type { MasterVersion } from "@/lib/contracts";

export function ReviewActions({ caseId, revision, selected, versions, pending, canRegister, companyId }: {
  canRegister?: boolean; companyId?: string; caseId: string; revision: number; selected?: MasterVersion; versions: MasterVersion[]; pending: boolean;
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

  const options = selected && !versions.some((version) => version.id === selected.id)
    ? [selected, ...versions] : versions;

  return <div className="space-y-3 p-4">
    <form method="post" onSubmit={choose} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-56 space-y-1">
        <Label htmlFor="version_id">CDC Master List version</Label>
        <NativeSelect id="version_id" name="version_id" key={selected?.id ?? "none"}
          defaultValue={selected?.id ?? ""} className="block w-full">
          <option value="">No version selected</option>
          {options.map((version) => <option key={version.id} value={version.id}>
            {version.company} · {version.year} · {version.approval_ref} · {version.original_filename} · {version.id.slice(0, 8)}
          </option>)}
        </NativeSelect>
      </div>
      <Button type="submit" variant="outline" disabled={busy}>Apply version</Button>
      <Button type="button" variant="outline" disabled={busy || pending} onClick={() =>
        void submit(() => write(`/intakes/${caseId}/process`, {expected_revision: revision}))
      }>Reprocess documents</Button>
    </form>
    {selected && <p className="text-body-sm text-muted-foreground">Balance date: {selected.balance_as_of ?? "Unknown"} ·{" "}
      <a className="font-medium text-primary hover:underline" href={`/api/v1/cdc/versions/${selected.id}/download`}>Download selected workbook</a>
    </p>}
    {canRegister && <RegisterMasterDialog companyId={companyId} outline trigger="Register a verified workbook" />}
    {error && <p role="alert" className="field-error">{error}</p>}
  </div>;
}
