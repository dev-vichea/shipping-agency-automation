import type { ReactNode } from "react";
import Link from "next/link";
import { Anchor, Download, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Document } from "@/lib/contracts";
import { label, pageSize, timestamp } from "@/lib/format";

export function Brand() {
  return (
    <Link href="/inbox" className="flex w-fit items-center gap-3 font-semibold tracking-tight">
      <span className="grid size-10 place-items-center rounded-xl bg-primary text-white">
        <Anchor aria-hidden size={21} />
      </span>
      <span>Shipping Agency<span className="block text-xs font-normal tracking-normal text-muted-foreground">Operations workspace</span></span>
    </Link>
  );
}

export function PageHeading({ title, description, action }: {
  title: string; description: string; action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function Status({ value }: { value: string }) {
  const styles: Record<string, string> = {
    PASS: "bg-teal-50 text-teal-800",
    WARNING: "bg-amber-50 text-amber-900",
    MISMATCH: "bg-rose-50 text-rose-800",
    NEEDS_REVIEW: "bg-amber-50 text-amber-900",
    uncertain: "bg-amber-50 text-amber-900",
    failed: "bg-rose-50 text-rose-800",
    needs_review: "bg-amber-50 text-amber-900",
    succeeded: "bg-teal-50 text-teal-800",
    ready: "bg-teal-50 text-teal-800",
    queued: "bg-blue-50 text-blue-800",
    running: "bg-blue-50 text-blue-800",
  };
  return <Badge variant="secondary" className={styles[value]}>{label(value)}</Badge>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-32 place-items-center px-5 py-9 text-center text-sm text-muted-foreground">
      <div className="grid justify-items-center gap-3"><FileText aria-hidden size={21} />{children}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-0 py-0 shadow-none">
      <h2 className="border-b px-5 py-4 text-base font-semibold">{title}</h2>
      <CardContent className="p-0">{children}</CardContent>
    </Card>
  );
}

export function Pagination({ path, offset, count }: { path: string; offset: number; count: number }) {
  if (!offset && count < pageSize) return null;
  return (
    <nav aria-label="Pagination" className="flex justify-end gap-5 text-sm font-medium">
      {offset > 0 && <Link href={`${path}?offset=${Math.max(offset - pageSize, 0)}`}>Previous</Link>}
      {count === pageSize && offset < 99_990 && <Link href={`${path}?offset=${offset + pageSize}`}>Next</Link>}
    </nav>
  );
}

export function Originals({ documents }: { documents: Document[] }) {
  if (!documents.length) return <Empty>No attachments on this intake.</Empty>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>File</TableHead><TableHead>Type</TableHead><TableHead>Received</TableHead><TableHead>Download</TableHead></TableRow></TableHeader>
      <TableBody>{documents.map((doc) => (
        <TableRow key={doc.id}>
          <TableCell className="whitespace-normal">
            <details className="min-w-40 max-w-xs">
              <summary className="cursor-pointer break-all font-medium">{doc.original_filename}</summary>
              <div className="mt-2 space-y-1 break-all text-xs text-muted-foreground">
                <p>{doc.size_bytes.toLocaleString("en-GB")} bytes</p><p>SHA-256: {doc.sha256}</p>
                <p>Source message: {doc.source_message_id}</p>
                {doc.parent_version_id && <p>Revises: {doc.parent_version_id}</p>}
              </div>
            </details>
          </TableCell>
          <TableCell>{label(doc.classification)}</TableCell><TableCell>{timestamp(doc.received_at)}</TableCell>
          <TableCell>
            <a className="inline-flex items-center gap-2 font-medium text-primary hover:underline"
              aria-label={`Download ${doc.original_filename}`} href={`/api/v1/documents/${doc.id}/download`}>
              <Download size={15} aria-hidden /> Original
            </a>
          </TableCell>
        </TableRow>
      ))}</TableBody>
    </Table>
  );
}
