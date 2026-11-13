import Link from "next/link";
import { DraftForm, IntakeForm, RefreshButton } from "@/components/forms";
import { Originals, PageHeading, Section, Status } from "@/components/workspace";
import type { CaseDetail } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";
import { api } from "@/lib/server-api";

export default async function ReviewDetail({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const item = await api<CaseDetail>(`/intakes/${encodeURIComponent(caseId)}`);
  return <>
    <Link className="text-sm font-medium text-primary hover:underline" href="/inbox">← Inbox</Link>
    <PageHeading title={item.subject || "Untitled arrival"} description={`Intake · ${label(item.channel)} · ${timestamp(item.created_at)}`} action={<RefreshButton />} />
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Status value={item.state} />
      <span className="text-muted-foreground">{item.review_reason ?? (item.state === "queued" ? "Waiting for the archive check." : "")}</span>
    </div>
    <Section title="Original attachments"><Originals documents={item.documents} /></Section>
    <Section title="Source messages">
      <div className="divide-y">
        {item.messages.map((message) => <details key={message.id} className="space-y-3 px-5 py-4">
          <summary className="cursor-pointer font-medium">{message.subject || "Untitled message"} <span className="text-xs font-normal text-muted-foreground">· {timestamp(message.received_at)}</span></summary>
          <dl className="space-y-1 text-sm">
            <div><dt className="inline font-medium">Sender: </dt><dd className="inline break-all">{message.sender || "Not supplied"}</dd></div>
            <div><dt className="inline font-medium">Message ID: </dt><dd className="inline break-all">{message.provider_message_id}</dd></div>
            {message.thread_id && <div><dt className="inline font-medium">Thread: </dt><dd className="inline break-all">{message.thread_id}</dd></div>}
          </dl>
          <p className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{message.body || "No message body."}</p>
        </details>)}
      </div>
    </Section>
    <details className="rounded-xl border bg-card">
      <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-primary">Add a simulated follow-up or revision</summary>
      <div className="border-t p-5"><IntakeForm caseId={item.id} revisionChoices={item.documents.map(({ id, original_filename }) => ({ id, original_filename }))} /></div>
    </details>
    <Section title="Import draft">
      <div className="space-y-4 p-5">
        {item.import_id ? <Link href={`/imports/${item.import_id}`} className="text-sm font-medium text-primary hover:underline">Open linked import draft</Link> : <>
          <p className="text-sm text-muted-foreground">Enter the reference manually to save a draft for this intake. It stays outside the accepted import register.</p>
          <DraftForm caseId={item.id} />
        </>}
      </div>
    </Section>
  </>;
}
