import type { Metadata } from "next";
import { AlertPreferences, ChangePasswordForm, MemberForm, RemoveMember, WorkspaceForm } from "@/features/workspace/workspace-forms";
import { FormSheet } from "@/components/ui/form-sheet";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeading, Section, Status } from "@/components/ui/page-layout";
import type { Provider, StaffMember } from "@/lib/contracts";
import { api, staffProfile, workspaceList } from "@/lib/server-api";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [staff, provider, workspace] = await Promise.all([staffProfile(), api<Provider>("/automation/provider"), workspaceList()]);
  const active = workspace.workspaces.find((entry) => entry.id === workspace.active_id);
  const members = active?.role === "admin" ? await api<StaffMember[]>("/workspace/members") : [];
  return <div className="space-y-gutter">
    <PageHeading title="Settings" action={<FormSheet title="New workspace" trigger="New workspace" outline><WorkspaceForm /></FormSheet>} />
    <div className="grid items-start gap-gutter xl:grid-cols-2">
      <Section title="Staff account" action={<FormSheet title="Change password" trigger="Change password" outline><ChangePasswordForm /></FormSheet>}>
        <dl className="p-3"><dt className="panel-label">Email</dt><dd className="mt-1 break-all font-mono text-code-tabular">{staff.email}</dd></dl>
      </Section>
      {active && <Section title="Workspace"><div className="p-4">{active.role === "admin" ? <WorkspaceForm existing={active.name} /> : active.name}</div></Section>}
      {active?.role === "admin" && <Section title="Staff members" action={<FormSheet title="Manage membership" trigger="Manage membership" outline><MemberForm /></FormSheet>}>
        <ul className="divide-y">{members.map((member) => <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="break-all">{member.email}</span><div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{member.role === "admin" ? "Administrator" : "Operator"}</span>
            {member.email !== staff.email && <RemoveMember id={member.id} email={member.email} />}
          </div>
        </li>)}</ul>
      </Section>}
      <Section title="Notifications"><div className="p-4"><AlertPreferences approvals={staff.approval_alerts} automation={staff.automation_alerts} /></div></Section>
      <Section title="Local AI provider" action={<Status value={provider.state} />}>
        <dl className="grid gap-3 p-3 sm:grid-cols-2">
          <div><dt className="panel-label">Provider</dt><dd className="mt-1 text-body-md">Ollama</dd></div>
          <div><dt className="panel-label">Model</dt><dd className="mt-1 break-all font-mono text-code-tabular">{provider.model}</dd></div>
          <div><dt className="panel-label">Context</dt><dd className="mt-1 font-mono text-code-tabular">{provider.context.toLocaleString("en-GB")} tokens</dd></div>
          <div><dt className="panel-label">Concurrent requests</dt><dd className="mt-1 font-mono text-code-tabular">{provider.max_concurrency}</dd></div>
        </dl>
        <div className="flex justify-between gap-3 border-t px-3 py-2 text-body-sm text-muted-foreground">
          <p className="self-center">Provider configuration comes from the server environment.</p>
          <Button asChild variant="outline" size="sm"><Link href="/automation">Automation</Link></Button>
        </div>
      </Section>
    </div>
  </div>;
}
