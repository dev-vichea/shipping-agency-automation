import type { ReactNode } from "react";
import Link from "next/link";
import { Anchor, Download, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Document } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Brand() {
  return (
    <Link href="/home" className="flex w-fit items-center gap-2.5 text-headline-sm">
      <span className="grid size-8 place-items-center rounded-control bg-primary text-primary-foreground">
        <Anchor aria-hidden size={18} />
      </span>
      <span>
        Harborway
        <span className="block text-body-sm text-muted-foreground">
          Shipping operations
        </span>
      </span>
    </Link>
  );
}

export function PageHeading({ title, description, action, code = false }: {
  title: string; description?: string; action?: ReactNode; code?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 pb-1">
      <div className="min-w-0">
        <h1 className={cn("break-words text-headline-xl", code && "font-mono")}>{title}</h1>
        {description && <p className="text-body-md text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </header>
  );
}

const statusStyle: Record<string, string> = {
  success: "bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  warning: "bg-amber-100/90 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  danger: "bg-rose-100/80 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
  pending: "bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  neutral: "bg-slate-100 text-slate-600 dark:bg-slate-800/70 dark:text-slate-400",
  intelligence: "bg-purple-100/80 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300",
};

const statusTone: Record<string, keyof typeof statusStyle> = {
  pass: "success", succeeded: "success", ready: "success", extracted: "intelligence",
  warning: "warning", uncertain: "warning", needs_review: "warning", partial: "warning",
  approved: "success", ready_for_approval: "success", reviewed: "success", authorized: "success",
  rejected: "danger",
  mismatch: "danger", failed: "danger", invalid_output: "danger",
  queued: "pending", running: "intelligence", processing: "intelligence", pending: "pending",
};

const singleWordLabel: Record<string, string> = {
  needs_review: "Review",
  uncertain: "Uncertain",
  warning: "Warning",
  partial: "Partial",
  pass: "Pass",
  succeeded: "Succeeded",
  ready: "Ready",
  ready_for_approval: "Ready",
  approved: "Approved",
  reviewed: "Reviewed",
  authorized: "Authorized",
  rejected: "Rejected",
  failed: "Failed",
  mismatch: "Mismatch",
  invalid_output: "Invalid",
  queued: "Queued",
  running: "Running",
  processing: "Processing",
  pending: "Pending",
  extracted: "Extracted",
  previous_analysis: "Previous",
  unsubmitted: "Draft",
  simulated: "Simulated",
};

export function Status({ value }: { value: string }) {
  const key = value.toLowerCase();
  const color = statusStyle[statusTone[key] ?? "neutral"];
  const text = singleWordLabel[key] ?? label(key).trim().split(/\s+/)[0] ?? key;
  return <Badge className={cn("border-0", color)}>
    {text}
  </Badge>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-24 place-items-center bg-background px-4 py-5 text-center text-body-sm text-muted-foreground">
      <div className="grid justify-items-center gap-2">
        <FileText aria-hidden size={18} className="text-ghost" />
        <div className="max-w-sm">{children}</div>
      </div>
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-heading">
        <h2 className="text-headline-sm">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const docClassificationLabel: Record<string, string> = {
  commercial_invoice: "Invoice",
  invoice: "Invoice",
  packing_list: "Packing",
  bill_of_lading: "B/L",
  draft_bl: "B/L",
  customs_permit: "Permit",
};

export function Originals({ documents }: { documents: Document[] }) {
  if (!documents.length) return <Empty>No attachments on this intake.</Empty>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead><TableHead>Classification</TableHead><TableHead>Received</TableHead>
          <TableHead className="text-right">Download</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => (
          <TableRow key={doc.id}>
            <TableCell className="whitespace-normal">
              <details className="min-w-44 max-w-sm">
                <summary className="break-all font-medium">{doc.original_filename}</summary>
                <div className="mt-1.5 space-y-0.5 break-all font-mono text-code-tabular text-muted-foreground">
                  <p>{doc.size_bytes.toLocaleString("en-GB")} bytes · {doc.mime}</p>
                  <p>SHA-256: {doc.sha256.slice(0, 24)}…</p>
                  <p>Source msg: {doc.source_message_id}</p>
                  {doc.parent_version_id && <p className="text-primary">Revises: {doc.parent_version_id.slice(0, 8)}</p>}
                </div>
              </details>
            </TableCell>
            <TableCell><Badge variant="secondary">{docClassificationLabel[doc.classification] ?? label(doc.classification).trim().split(/\s+/)[0]}</Badge></TableCell>
            <TableCell className="font-mono text-code-tabular text-muted-foreground">{timestamp(doc.received_at)}</TableCell>
            <TableCell className="text-right">
              <a
                className="data-link inline-flex items-center gap-1"
                aria-label={`Download ${doc.original_filename}`}
                href={`/api/v1/documents/${doc.id}/download`}
              >
                <Download size={13} aria-hidden /> Original
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
