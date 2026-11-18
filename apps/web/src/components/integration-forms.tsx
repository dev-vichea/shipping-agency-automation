"use client";

import { NativeSelect } from "@/components/ui/native-select";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWrite } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { write } from "@/lib/client-api";
import type { Company, Integrations, StaffMember, TelegramPairing, TelegramPreview } from "@/lib/contracts";
import { useTelegramWebApp } from "@/lib/telegram";

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
      toast.updated("Inbox settings updated!");
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

export function TelegramLinkForm({ members, botUsername }: { members: StaffMember[]; botUsername?: string | null }) {
  const router = useRouter();
  const { error, busy, submit } = useWrite();
  const [saved, setSaved] = useState(false);
  const [pairing, setPairing] = useState<TelegramPairing | null>(null);
  const [selectedEmail, setSelectedEmail] = useState("");

  const generateLink = () => {
    void submit(async () => {
      const data = await write<TelegramPairing>(
        "/integrations/telegram/pairing-token",
        selectedEmail ? { email: selectedEmail } : {}
      );
      setPairing(data);
    });
  };

  const handleSync = () => {
    void submit(async () => {
      await write<{ processed: number }>("/integrations/telegram/sync", {});
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="text-label-md font-semibold">1-Click Telegram Pairing</h4>
            {botUsername && <span className="text-xs font-mono text-muted-foreground">@{botUsername}</span>}
          </div>
          <Button size="xs" variant="ghost" onClick={handleSync} disabled={busy} type="button">
            Check updates
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Generate an instant pairing link. When tapped in Telegram, it links the account immediately.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            value={selectedEmail}
            onChange={(e) => setSelectedEmail(e.target.value)}
            className="text-xs max-w-xs"
          >
            <option value="">Current account</option>
            {members.map((m) => (
              <option key={m.id} value={m.email}>
                {m.email}
              </option>
            ))}
          </NativeSelect>
          <Button size="sm" onClick={generateLink} disabled={busy} type="button">
            Generate link
          </Button>
        </div>

        {pairing?.pairing_url && (
          <div className="rounded-md border bg-background p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-muted-foreground break-all">
                {pairing.pairing_url}
              </span>
              <Button asChild size="xs" variant="default">
                <a href={pairing.pairing_url} target="_blank" rel="noopener noreferrer">
                  Open in Telegram
                </a>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Link expires in 10 minutes. Click &ldquo;Check updates&rdquo; above once you tap Start in Telegram.
            </p>
          </div>
        )}
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium hover:text-foreground">
          Or link manually with numeric Chat ID
        </summary>
        <form
          className="mt-3 space-y-3 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            const element = event.currentTarget;
            const data = new FormData(element);
            setSaved(false);
            void submit(async () => {
              await write("/integrations/telegram/recipients", Object.fromEntries(data));
              element.reset();
              setSaved(true);
              toast.saved("Recipient linked!");
              router.refresh();
            });
          }}
        >
          <label className="grid gap-1.5 font-medium text-foreground">
            Staff account
            <NativeSelect required name="email" defaultValue="">
              <option value="">Select staff</option>
              {members.map((member) => (
                <option key={member.id} value={member.email}>
                  {member.email}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1.5 font-medium text-foreground">
            Private chat ID
            <Input name="chat_id" required inputMode="numeric" pattern="[1-9][0-9]{0,19}" />
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
          {saved && <p className="text-success" role="status">Recipient linked.</p>}
          <Button size="sm" disabled={busy}>
            Link recipient manually
          </Button>
        </form>
      </details>
    </div>
  );
}

export function UnlinkTelegram({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { error, busy, submit } = useWrite();
  return <div>
    <Button size="xs" variant="outline" disabled={busy} onClick={() => {
      if (!window.confirm(`Remove ${name} as a Telegram recipient?`)) return;
      void submit(async () => {
        await write(`/integrations/telegram/recipients/${id}/unlink`);
        toast.updated("Recipient unlinked");
        router.refresh();
      });
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
    {preview.buttons.length > 0 && <div aria-label="Telegram buttons" className="flex flex-wrap gap-2">
      {preview.buttons.map((button) => <span key={button} className="rounded-md border px-3 py-1 text-sm">{button}</span>)}
    </div>}
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

export function QuickDecisionForm({ caseId, revision, reviewId, reject }: {
  caseId: string; revision: number; reviewId: string; reject: boolean;
}) {
  const router = useRouter();
  const { error, busy, submit } = useWrite();
  const { isTelegram, hapticSuccess, hapticError, close } = useTelegramWebApp();
  const [completed, setCompleted] = useState<string | null>(null);

  return <form className="space-y-3" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const notes = reject ? String(form.get("notes") ?? "").trim() : "Confirmed through the draft quick approval link.";
    const payload = { expected_revision: revision, review_id: reviewId, notes };
    void submit(async () => {
      try {
        if (reject) {
          await write(`/intakes/${caseId}/quick-rejection`, payload);
          hapticSuccess();
          toast.updated("Draft rejected");
          if (isTelegram) {
            setCompleted("Draft rejected. Returning to Telegram...");
            setTimeout(() => close(), 1200);
          } else {
            router.push(`/review/${caseId}`);
          }
        } else {
          const { import_id: id } = await write<{ import_id: string }>(`/intakes/${caseId}/quick-approval`, payload);
          hapticSuccess();
          toast.saved("Import approved!");
          if (isTelegram) {
            setCompleted("Import approved. Returning to Telegram...");
            setTimeout(() => close(), 1200);
          } else {
            router.push(`/imports/${id}`);
          }
        }
      } catch (err) {
        hapticError();
        throw err;
      }
    });
  }}>
    {completed ? (
      <div className="rounded-lg bg-emerald-100/80 p-3 text-sm text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" role="status">
        {completed}
      </div>
    ) : (
      <>
        {reject && <label className="grid gap-1.5 text-label-md">Rejection reason
          <Textarea name="notes" required maxLength={1000} />
        </label>}
        <label className="flex items-start gap-2"><input type="checkbox" required className="mt-1" />
          {reject ? "Confirm rejection of this draft revision." : "Confirm this exact revision for the approved import register."}
        </label>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={reject ? "destructive" : "default"} disabled={busy}>
            {reject ? "Reject draft" : "Approve import"}
          </Button>
          {isTelegram && (
            <Button size="sm" variant="outline" type="button" onClick={close} disabled={busy}>
              Close
            </Button>
          )}
        </div>
      </>
    )}
    {error && <p role="alert" className="field-error">{error}</p>}
  </form>;
}
