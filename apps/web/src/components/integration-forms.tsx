"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWrite } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { write } from "@/lib/client-api";
import type { Company, Integrations, StaffMember, TelegramPreview } from "@/lib/contracts";

export function ConnectGmail() {
  const { busy, error, submit } = useWrite();
  return <div className="space-y-2">
    <Button size="sm" disabled={busy} onClick={() => void submit(async () => {
      const { url } = await write<{ url: string }>("/integrations/gmail/connect");
      const destination = new URL(url);
      if (destination.origin !== "https://accounts.google.com") throw new Error("Unexpected authorization destination.");
      window.location.assign(destination.toString());
    })}>Connect Gmail</Button>
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}

export function GmailForm({ config, companies }: { config: Integrations["gmail"]; companies: Company[] }) {
  const router = useRouter();
  const { error, busy, submit } = useWrite();
  const [saved, setSaved] = useState(false);
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSaved(false);
    void submit(async () => {
      await write("/integrations/gmail/settings", {
        senders: String(data.get("senders") || "").split(/[\n,]+/).map((sender) => sender.trim()).filter(Boolean),
        company_id: data.get("company_id") || null, enabled: data.get("enabled") === "on",
      });
      setSaved(true);
      router.refresh();
    });
  }}>
    <label className="grid gap-1.5 font-medium">Allowed sender addresses (one per line)<Textarea name="senders" rows={3} maxLength={13000} defaultValue={config.senders.join("\n")} /></label>
    <label className="grid gap-1.5 font-medium">File new cases under<NativeSelect name="company_id" defaultValue={config.company_id ?? ""}>
      <option value="">Unassigned intake</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
    </NativeSelect></label>
    <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={config.enabled} /> Enable automatic monitoring</label>
    {error && <p className="field-error" role="alert">{error}</p>}
    {saved && <p className="text-success" role="status">Inbox settings saved.</p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy}>Save inbox settings</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => {
        if (!window.confirm("Disconnect this mailbox and stop automatic intake?")) return;
        void submit(async () => { await write("/integrations/gmail/disconnect"); router.refresh(); });
      }}>Disconnect Gmail</Button>
    </div>
  </form>;
}

export function TelegramLinkForm({ members }: { members: StaffMember[] }) {
  const router = useRouter();
  const { error, busy, submit } = useWrite();
  const [saved, setSaved] = useState(false);
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const element = event.currentTarget;
    const data = new FormData(element);
    setSaved(false);
    void submit(async () => {
      await write("/integrations/telegram/recipients", Object.fromEntries(data));
      element.reset();
      setSaved(true);
      router.refresh();
    });
  }}>
    <p className="text-xs text-muted-foreground">Ask the staff member to start the agency bot and confirm their private chat ID.</p>
    <label className="grid gap-1.5 font-medium">Staff account<NativeSelect required name="email" defaultValue="">
      <option value="">Select staff</option>{members.map((member) => <option key={member.id} value={member.email}>{member.email}</option>)}
    </NativeSelect></label>
    <label className="grid gap-1.5 font-medium">Private chat ID<Input name="chat_id" required inputMode="numeric" pattern="[1-9][0-9]{0,19}" /></label>
    {error && <p className="field-error" role="alert">{error}</p>}
    {saved && <p className="text-success" role="status">Recipient linked.</p>}
    <Button size="sm" disabled={busy}>Link recipient</Button>
  </form>;
}

export function UnlinkTelegram({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { error, busy, submit } = useWrite();
  return <div>
    <Button size="xs" variant="outline" disabled={busy} onClick={() => {
      if (!window.confirm(`Remove ${name} as a Telegram recipient?`)) return;
      void submit(async () => { await write(`/integrations/telegram/recipients/${id}/unlink`); router.refresh(); });
    }}>Unlink</Button>
    {error && <p className="field-error mt-1" role="alert">{error}</p>}
  </div>;
}

export function TelegramSendForm({ caseId, preview }: { caseId: string; preview: TelegramPreview }) {
  const { error, busy, submit } = useWrite();
  const [result, setResult] = useState("");
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setResult("");
    void submit(async () => {
      const { state } = await write<{ state: string }>(`/intakes/${caseId}/telegram`, {
        recipient_id: form.get("recipient_id"), revision: preview.revision, payload_hash: preview.payload_hash,
      });
      setResult(state === "sent" ? "Message sent." : state === "failed" ? "Telegram rejected this delivery." : "Delivery could not be confirmed. Check the recipient’s chat.");
    });
  }}>
    <pre className="rounded-lg border bg-muted p-3 text-xs leading-5 break-words whitespace-pre-wrap">{preview.message}</pre>
    {preview.configured && preview.recipients.length > 0 ? <>
      <label className="grid gap-1.5 font-medium">Recipient<NativeSelect name="recipient_id" defaultValue="" required>
        <option value="">Choose a recipient</option>
        {preview.recipients.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.email}</option>)}
      </NativeSelect></label>
      <label className="flex items-start gap-2"><input type="checkbox" required className="mt-0.5" /> I authorize this exact message to the selected recipient.</label>
      <Button size="sm" disabled={busy}>Send message</Button>
    </> : <p className="text-xs text-muted-foreground">Link an authorized recipient in Integrations to send this message.</p>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {result && <p role="status">{result}</p>}
  </form>;
}

export function QuickApproveForm({ caseId, revision, reviewId }: { caseId: string; revision: number; reviewId: string }) {
  const router = useRouter();
  const { error, busy, submit } = useWrite();
  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    void submit(async () => {
      const result = await write<{ import_id: string }>(`/intakes/${caseId}/quick-approval`, { expected_revision: revision, review_id: reviewId, notes: "Confirmed through the draft quick approval link." });
      router.push(`/imports/${result.import_id}`);
    });
  }}>
    <label className="flex items-center gap-2"><input type="checkbox" required /> Confirm this exact revision for the approved import register.</label>
    <Button size="sm" disabled={busy}>Approve import</Button>
    {error && <p role="alert" className="field-error">{error}</p>}
  </form>;
}
