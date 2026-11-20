"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormSubmission } from "@/lib/use-form-submission";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { write } from "@/lib/client-api";

export function WorkspaceForm({ existing }: { existing?: string }) {
  const router = useRouter();
  const { error, busy, submit } = useFormSubmission();
  const [saved, setSaved] = useState(false);
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaved(false);
    void submit(async () => {
      await write(existing ? "/workspace/settings" : "/workspaces", Object.fromEntries(form));
      if (existing) {
        setSaved(true);
        toast.updated("Workspace updated!");
        router.refresh();
      } else {
        toast.saved("Workspace created!");
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Reload scoped data after creating a workspace.
        window.location.assign("/home");
      }
    });
  }}>
    <label className="grid gap-1.5 font-medium">Workspace name<Input name="name" required maxLength={254} defaultValue={existing} /></label>
    {error && <p role="alert" className="field-error">{error}</p>}
    {saved && <p role="status" className="text-success">Workspace saved.</p>}
    <Button disabled={busy} size="sm">{existing ? "Save workspace" : "Create workspace"}</Button>
  </form>;
}

export function MemberForm() {
  const router = useRouter();
  const { error, busy, submit } = useFormSubmission();
  const [saved, setSaved] = useState(false);
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaved(false);
    void submit(async () => {
      await write("/workspace/members", Object.fromEntries(form));
      setSaved(true);
      toast.saved("Staff member added!");
      router.refresh();
    });
  }}>
    <p className="text-xs text-muted-foreground">Add an existing staff account by work email, then assign the operator to companies.</p>
    <label className="grid gap-1.5 font-medium">Staff email<Input type="email" autoComplete="off" name="email" required maxLength={254} /></label>
    <label className="grid gap-1.5 font-medium">Role<NativeSelect name="role"><option value="operator">Operator</option><option value="admin">Administrator</option></NativeSelect></label>
    {error && <p role="alert" className="field-error">{error}</p>}
    {saved && <p role="status" className="text-success">Staff role saved.</p>}
    <Button disabled={busy} size="sm">Save membership</Button>
  </form>;
}

export function RemoveMember({ id, email }: { id: string; email: string }) {
  const router = useRouter();
  const { error, busy, submit } = useFormSubmission();
  return <div className="text-right">
    <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => {
      if (!window.confirm(`Remove workspace access for ${email}?`)) return;
      void submit(async () => {
        await write(`/workspace/members/${id}/remove`);
        toast.updated("Staff member removed");
        router.refresh();
      });
    }}>Remove</Button>
    {error && <p className="field-error mt-1" role="alert">{error}</p>}
  </div>;
}

export function AlertPreferences({ approvals, automation }: { approvals: boolean; automation: boolean }) {
  const router = useRouter();
  const { error, busy, submit } = useFormSubmission();
  const [saved, setSaved] = useState(false);
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaved(false);
    void submit(async () => {
      await write("/auth/preferences", { approval_alerts: data.has("approval"), automation_alerts: data.has("automation") });
      setSaved(true);
      toast.updated("Alert preferences updated!");
      router.refresh();
    });
  }}>
    <label className="flex items-center gap-2"><input type="checkbox" name="approval" defaultChecked={approvals} /> Review and approval alerts</label>
    <label className="flex items-center gap-2"><input type="checkbox" name="automation" defaultChecked={automation} /> Failed run alerts</label>
    {error && <p className="field-error" role="alert">{error}</p>}
    {saved && <p className="text-success" role="status">Preferences saved.</p>}
    <Button size="sm" variant="outline" disabled={busy}>Save preferences</Button>
  </form>;
}

export function ChangePasswordForm() {
  const { error, busy, submit } = useFormSubmission();
  const [saved, setSaved] = useState(false);
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const element = event.currentTarget;
    const data = new FormData(element);
    setSaved(false);
    void submit(async () => {
      await write("/auth/password", Object.fromEntries(data));
      element.reset();
      setSaved(true);
      toast.updated("Password updated!");
    });
  }}>
    <label className="grid gap-1.5 font-medium">Current password<Input name="current_password" type="password" autoComplete="current-password" maxLength={128} required /></label>
    <label className="grid gap-1.5 font-medium">New password<Input name="new_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
    <p className="text-xs text-muted-foreground">Changing your password signs you out of other sessions.</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    {saved && <p className="text-success" role="status">Password changed.</p>}
    <Button size="sm" disabled={busy}>Change password</Button>
  </form>;
}

export function OpenInWorkspace({ id, destination }: { id: string; destination: string }) {
  const { error, busy, submit } = useFormSubmission();
  return <div className="space-y-3">
    <Button disabled={busy} onClick={() => void submit(async () => {
      await write(`/workspaces/${id}/select`);
      window.location.assign(destination);
    })}>Switch workspace and open draft</Button>
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
