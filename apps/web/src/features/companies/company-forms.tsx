"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { write } from "@/lib/client-api";
import type { Company, StaffMember } from "@/lib/contracts";
import { useFormSubmission } from "@/lib/use-form-submission";
import { toast } from "@/lib/toast";

export function CompanyForm({ company }: { company?: Company }) {
  const router = useRouter();
  const { error, busy, submit } = useFormSubmission();
  const [saved, setSaved] = useState(false);

  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaved(false);
    void submit(async () => {
      const result = await write<Company>(company ? `/companies/${company.id}` : "/companies", {
        name: data.get("name"),
        verified_english_name: data.get("verified_english_name") || null,
        identifier: data.get("identifier") || null,
        contact_name: data.get("contact_name") || null,
        contact_email: data.get("contact_email") || null,
        aliases: String(data.get("aliases") || "").split("\n").map((alias) => alias.trim()).filter(Boolean),
      });
      if (company) {
        setSaved(true);
        toast.updated("Company updated!");
        router.refresh();
      } else {
        toast.saved("Company created!");
        router.push(`/companies/${result.id}`);
      }
    });
  }

  return <form className="space-y-4" onSubmit={handle}>
    <Field label="Company name"><Input name="name" maxLength={254} required defaultValue={company?.name} /></Field>
    <Field label="Verified English name"><Input name="verified_english_name" maxLength={254} defaultValue={company?.verified_english_name ?? ""} /></Field>
    <Field label="Company identifier"><Input name="identifier" maxLength={160} defaultValue={company?.identifier ?? ""} /></Field>
    <Field label="Aliases (one per line)"><textarea name="aliases" rows={4} className="rounded-control border p-2" defaultValue={company?.aliases.join("\n")} /></Field>
    <Field label="Contact name"><Input name="contact_name" maxLength={254} defaultValue={company?.contact_name ?? ""} /></Field>
    <Field label="Contact email"><Input name="contact_email" maxLength={254} defaultValue={company?.contact_email ?? ""} type="email" /></Field>
    {error && <p role="alert" className="field-error">{error}</p>}
    {saved && <p role="status" className="text-success">Company saved.</p>}
    <Button type="submit" disabled={busy}>{busy ? "Saving…" : company ? "Save changes" : "Create company"}</Button>
  </form>;
}

export function CompanyStaffForm({ companyId, members, assigned }: {
  companyId: string; members: StaffMember[]; assigned: string[];
}) {
  const router = useRouter();
  const { error, busy, submit } = useFormSubmission();
  const [saved, setSaved] = useState(false);
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaved(false);
    void submit(async () => {
      await write(`/companies/${companyId}/staff`, { user_ids: data.getAll("member") });
      setSaved(true);
      toast.updated("Staff access updated!");
      router.refresh();
    });
  }}>
    <fieldset className="space-y-1.5">
      <legend className="mb-2 font-medium">Staff access</legend>
      <p className="mb-3 text-xs text-muted-foreground">Administrators can access every company in this workspace.</p>
      {members.filter(({ role }) => role === "operator").map((member) => <label key={member.id} className="flex items-center gap-2 break-all">
        <input type="checkbox" name="member" value={member.id} defaultChecked={assigned.includes(member.id)} /> {member.email}
      </label>)}
    </fieldset>
    {error && <p role="alert" className="field-error">{error}</p>}
    {saved && <p role="status" className="text-success">Staff access saved.</p>}
    <Button size="sm" variant="outline" disabled={busy}>Save access</Button>
  </form>;
}

export function AssignCompanyForm({ companies, caseId, revision }: {
  companies: Company[]; caseId: string; revision: number;
}) {
  const router = useRouter();
  const { error, busy, submit } = useFormSubmission();
  if (!companies.length) return null;
  return <form className="flex flex-wrap items-center gap-2 border-t px-3 py-3" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submit(async () => {
      await write(`/intakes/${caseId}/company`, { company_id: data.get("company_id"), expected_revision: revision });
      toast.updated("Company assigned!");
      router.refresh();
    });
  }}>
    <NativeSelect aria-label="Assign company" name="company_id" className="control max-w-full" required defaultValue="">
      <option value="">Select company</option>
      {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
    </NativeSelect>
    <Button size="sm" variant="outline" disabled={busy}>Assign company</Button>
    {error && <p role="alert" className="field-error">{error}</p>}
  </form>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 font-medium">{label}{children}</label>;
}
