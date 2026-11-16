"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDownToLine, Ellipsis, FolderOpen, Mail, Plus } from "lucide-react";
import { useWrite } from "@/components/forms";
import { ConnectGmail, GmailForm } from "@/components/integration-forms";
import { LiveRefresh } from "@/components/live-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogCloseButton, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, Section } from "@/components/workspace";
import { write } from "@/lib/client-api";
import type { Company, FolderSource, Integrations } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";

type Panel =
  | { view: "add" | "gmail" | "newFolder" }
  | { view: "editFolder"; source: FolderSource }
  | { view: "picker"; pairing: Pairing };

type Pairing = { source_id: string; code: string };

const titles: Record<Panel["view"], string> = {
  add: "Add intake source", gmail: "Gmail", newFolder: "Add watched folder",
  editFolder: "Edit watched folder", picker: "Choose a folder on your Mac",
};

const statuses: Record<FolderSource["status"], string> = {
  paused: "Paused", awaiting_setup: "Awaiting setup", offline: "Mac offline",
  connected: "Monitoring", waiting_for_files: "Waiting for files", folder_unavailable: "Folder unavailable",
  file_rejected: "File needs attention", upload_retry: "Retrying upload",
};

function FolderPicker({ pairing, available, connected, refreshLink, busy }: {
  pairing: Pairing; available: boolean; connected: boolean; refreshLink: () => void; busy: boolean;
}) {
  const params = new URLSearchParams({ server: window.location.origin, source: pairing.source_id, code: pairing.code });
  return <div className="space-y-3">
    <p className="text-body-md">Select the folder that contains your shipment subfolders. Harborway will watch for new files.</p>
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild><a href={`harborway-folder://choose?${params}`}><FolderOpen aria-hidden /> Choose folder</a></Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={refreshLink}>Refresh setup link</Button>
    </div>
    {connected && <p role="status" className="text-body-sm font-medium text-success">Mac app connected</p>}
    <details className="text-body-sm text-muted-foreground">
      <summary className="cursor-pointer">First time on this Mac?</summary>
      <div className="mt-2 space-y-2">
        <p>Open Harborway Folder Intake once, then return here and click <strong>Choose folder</strong>.</p>
        {available && <Button asChild variant="outline" size="sm">
          <a href="/harborway-folder-intake-mac.zip" download><ArrowDownToLine aria-hidden /> Download Mac app</a>
        </Button>}
      </div>
    </details>
  </div>;
}

export function IntakeSources({ gmail, companies, folders, macAppAvailable }: {
  gmail: Integrations["gmail"]; companies: Company[]; folders: FolderSource[]; macAppAvailable: boolean;
}) {
  const router = useRouter();
  const { busy, error, submit } = useWrite();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const editing = panel?.view === "editFolder" ? panel.source : null;
  const refresh = () => startTransition(() => router.refresh());

  function update(source: FolderSource, enabled: boolean) {
    void submit(async () => {
      await write(`/integrations/folders/${source.id}/settings`, { name: source.name, company_id: source.company_id, enabled });
      refresh();
    });
  }

  function choose(sourceID: string) {
    void submit(async () => {
      const pairing = await write<Pairing>(`/integrations/folders/${sourceID}/pairing`);
      setPanel({ view: "picker", pairing });
    });
  }

  return <Dialog open={!!panel} onOpenChange={(open) => { if (!open) setPanel(null); }}>
    <LiveRefresh active={folders.length > 0 && (!panel || panel.view === "picker") && !menu && !busy && !refreshing}
      interval={panel?.view === "picker" ? 4000 : 15000} />
    <Section title="Intake sources" action={<DialogTrigger asChild>
      <Button size="sm" onClick={() => setPanel({ view: "add" })}><Plus aria-hidden /> Add source</Button>
    </DialogTrigger>}>
      {gmail.connected || folders.length ? <Table className="min-w-[590px]">
        <TableHeader><TableRow>
          <TableHead>Source</TableHead><TableHead>Type</TableHead><TableHead>Company</TableHead>
          <TableHead>Status</TableHead><TableHead>Last successful check</TableHead>
          <TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {gmail.connected && <TableRow>
            <TableCell className="max-w-60 truncate font-medium" title={gmail.mailbox ?? undefined}>{gmail.mailbox ?? "Gmail"}</TableCell>
            <TableCell>Gmail</TableCell>
            <TableCell>{companies.find((entry) => entry.id === gmail.company_id)?.name ?? "Unassigned"}</TableCell>
            <TableCell><Badge variant="outline">{gmail.error ? "Needs attention" : gmail.enabled ? "Monitoring" : "Paused"}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{timestamp(gmail.last_synced_at)}</TableCell>
            <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => setPanel({ view: "gmail" })}>Manage</Button></TableCell>
          </TableRow>}
          {folders.map((source) => <TableRow key={source.id}>
            <TableCell className="max-w-52 truncate font-medium" title={source.name}>{source.name}</TableCell>
            <TableCell>Watched folder</TableCell><TableCell>{source.company}</TableCell>
            <TableCell><Badge variant="outline">{statuses[source.status]}</Badge></TableCell>
            <TableCell className="text-muted-foreground">{timestamp(source.last_checked_at)}</TableCell>
            <TableCell><div className="flex items-center justify-end gap-1">
              <Button size="sm" variant="ghost" disabled={busy || refreshing} onClick={() => update(source, !source.enabled)}>
                {source.enabled ? "Pause" : "Resume"}
              </Button>
              <DropdownMenu modal={false} open={menu === source.id} onOpenChange={(open) => setMenu(open ? source.id : null)}>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${source.name}`} disabled={busy || refreshing}><Ellipsis aria-hidden /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => setPanel({ view: "editFolder", source })}>Edit</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => choose(source.id)}>Choose folder</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div></TableCell>
          </TableRow>)}
        </TableBody>
      </Table> : <Empty>No automatic intake sources yet.</Empty>}
      {!panel && error && <p role="alert" className="field-error m-3">{error}</p>}
    </Section>
    {panel && <DialogContent aria-describedby={undefined}>
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <DialogTitle className="text-headline-md">{titles[panel.view]}</DialogTitle>
        <DialogCloseButton />
      </div>
      <div className="space-y-4 p-5">
        {panel.view === "add" && <div className="grid gap-2">
          <Button variant="outline" className="justify-start" onClick={() => setPanel({ view: "gmail" })}><Mail aria-hidden />{gmail.connected ? "Manage Gmail" : "Gmail"}</Button>
          <Button variant="outline" className="justify-start" onClick={() => setPanel({ view: "newFolder" })}><FolderOpen aria-hidden />Watched folder</Button>
        </div>}
        {panel.view === "gmail" && (gmail.connected ? <>
          <p className="break-all font-medium">{gmail.mailbox}</p>
          {gmail.error && <p className="field-error capitalize" role="alert">{label(gmail.error)}</p>}
          <GmailForm config={gmail} companies={companies} />
        </> : gmail.configured ? <ConnectGmail /> : <p className="text-muted-foreground">Gmail needs an administrator to configure Google sign-in on the server.</p>)}
        {(panel.view === "newFolder" || panel.view === "editFolder") && (companies.length || editing ?
          <form className="space-y-4" key={editing?.id ?? "new"} onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const values = { name: data.get("name"), company_id: editing?.has_received ? editing.company_id : data.get("company_id") };
            void submit(async () => {
              if (editing) {
                await write(`/integrations/folders/${editing.id}/settings`, { ...values, enabled: editing.enabled });
                setPanel(null);
              } else {
                const pairing = await write<Pairing>("/integrations/folders", values);
                setPanel({ view: "picker", pairing });
              }
              refresh();
            });
          }}>
            <label className="grid gap-1.5 font-medium">Source name<Input name="name" required maxLength={100} placeholder="Original Docs" defaultValue={editing?.name} /></label>
            <label className="grid gap-1.5 font-medium">Linked company
              <NativeSelect name="company_id" required defaultValue={editing?.company_id ?? ""} disabled={editing?.has_received}>
                <option value="">Select a company</option>
                {editing && !companies.some(({ id }) => id === editing.company_id) && <option value={editing.company_id}>{editing.company}</option>}
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </NativeSelect>
            </label>
            <Button disabled={busy}>{editing ? "Save changes" : "Create source"}</Button>
          </form> : <p><Link href="/companies?new=1" className="data-link">Add a company</Link> before connecting a watched folder.</p>)}
        {panel.view === "picker" && <FolderPicker pairing={panel.pairing} available={macAppAvailable} busy={busy}
          refreshLink={() => choose(panel.pairing.source_id)} connected={folders.some((source) =>
            source.id === panel.pairing.source_id && source.status === "connected")} />}
        {error && <p role="alert" className="field-error">{error}</p>}
      </div>
    </DialogContent>}
  </Dialog>;
}
