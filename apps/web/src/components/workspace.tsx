import type { ReactNode } from "react";
import Link from "next/link";
import { Anchor, Download, FileText, CheckCircle2, AlertTriangle, XCircle, Clock, HelpCircle, Sparkles } from "lucide-react";
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

const statusStyle = {
  success: { color: "border-success-border bg-success-fill text-success", icon: CheckCircle2 },
  warning: { color: "border-warning-border bg-warning-fill text-warning", icon: AlertTriangle },
  danger: { color: "border-danger-border bg-danger-fill text-danger", icon: XCircle },
  pending: { color: "border-border bg-muted text-muted-foreground", icon: Clock },
  neutral: { color: "border-border bg-background text-muted-foreground", icon: HelpCircle },
  intelligence: { color: "border-intelligence-border bg-intelligence-fill text-intelligence", icon: Sparkles },
};

const statusTone: Record<string, keyof typeof statusStyle> = {
  pass: "success", succeeded: "success", ready: "success", extracted: "intelligence",
  warning: "warning", uncertain: "warning", needs_review: "warning", partial: "warning",
  approved: "success", ready_for_approval: "success", reviewed: "success", authorized: "success",
  rejected: "danger",
  mismatch: "danger", failed: "danger", invalid_output: "danger",
  queued: "pending", running: "intelligence", processing: "intelligence", pending: "pending",
};

export function Status({ value }: { value: string }) {
  const key = value.toLowerCase();
  const { color, icon: Icon } = statusStyle[statusTone[key] ?? "neutral"];
  return <Badge variant="outline" className={color}>
    <Icon size={11} aria-hidden /> {key === "needs_review" ? "Review required" : label(key === "pass" || key === "warning" || key === "mismatch" ? key.toUpperCase() : key)}
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
            <TableCell><Badge variant="secondary">{label(doc.classification)}</Badge></TableCell>
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
