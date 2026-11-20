"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Folder, Mail, Paperclip, Upload } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Status } from "@/components/ui/page-layout";
import { FileAttachmentGroup } from "@/components/ui/file-icon";
import type { CaseSummary } from "@/lib/contracts";
import { label, timestamp } from "@/lib/format";
import { scopedPath } from "@/lib/scope";
import { cn } from "@/lib/utils";

function FilesCell({ item }: { item: CaseSummary }) {
  const types = item.file_types && item.file_types.length > 0 ? item.file_types : undefined;
  return <FileAttachmentGroup types={types} count={item.attachment_count} />;
}

function roleShortLabel(role: string): string {
  switch (role) {
    case "commercial_invoice":
    case "invoice":
      return "INV";
    case "packing_list":
      return "PL";
    case "draft_bl":
    case "final_bl":
      return "B/L";
    default:
      return role.slice(0, 3).toUpperCase();
  }
}

/**
 * Formats extracted document roles into clean, plain-text labels (e.g. "INV · PL · B/L")
 * without any heavy background badge styling.
 */
function formatDocRolesText(roles?: string[]): string {
  if (!roles || roles.length === 0) return "";

  const order = ["INV", "PL", "B/L"];
  const formatted = Array.from(new Set(roles.map(roleShortLabel)));
  formatted.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  return formatted.join(" · ");
}

function isGenericSubject(subject?: string | null): boolean {
  if (!subject) return true;
  const s = subject.trim().toLowerCase();
  return (
    !s ||
    s === "—" ||
    s === "-" ||
    s.startsWith("synthetic arrival") ||
    s === "new upload" ||
    s === "manual upload" ||
    s === "file upload" ||
    s === "no subject" ||
    s === "(no subject)" ||
    s.startsWith("fixture-") ||
    s.startsWith("iw-fixture-")
  );
}

function isHexReference(ref?: string | null): boolean {
  if (!ref) return true;
  return /^[0-9a-f]{8}$/i.test(ref.trim());
}

function formatDocPackageSummary(roles?: string[]): string {
  if (!roles || roles.length === 0) return "Import Documents";

  const hasInv = roles.some((r) => r === "commercial_invoice" || r === "invoice");
  const hasPl = roles.some((r) => r === "packing_list");
  const hasBl = roles.some((r) => r === "draft_bl" || r === "final_bl");

  if (hasInv && hasPl && hasBl) {
    return "Invoice, Packing List & Draft B/L";
  }
  if (hasInv && hasPl) {
    return "Commercial Invoice & Packing List";
  }
  if (hasInv && hasBl) {
    return "Commercial Invoice & Draft B/L";
  }
  if (hasPl && hasBl) {
    return "Packing List & Draft B/L";
  }
  if (hasInv) {
    return "Commercial Invoice";
  }
  if (hasPl) {
    return "Packing List";
  }
  if (hasBl) {
    return "Bill of Lading";
  }
  return "Import Documents";
}

/**
 * Resolves a genuine or AI-derived subject from extracted documents, references, and companies.
 */
export function resolveCaseSubject(item: CaseSummary): string {
  // If the intake already has a genuine email subject (e.g. from Gmail), prioritize it
  if (!isGenericSubject(item.subject)) {
    return item.subject!;
  }

  // Synthesize from AI analysis of extracted documents
  const docsLabel = formatDocPackageSummary(item.document_roles);
  const hasRealRef = item.detected_reference && !isHexReference(item.detected_reference);
  const company = item.company && item.company !== "Unassigned" ? item.company : null;
  const cargo = item.cargo_summary?.trim();

  // Pattern 1: Real Reference (e.g. TK164, F0026CD046, 26THYN164)
  if (hasRealRef) {
    if (cargo) {
      return `${item.detected_reference} Import · ${cargo} (${docsLabel})`;
    }
    if (company) {
      return `${item.detected_reference} Import · ${company} (${docsLabel})`;
    }
    return `${item.detected_reference} Import · ${docsLabel}`;
  }

  // Pattern 2: Bill of Lading known
  if (item.bill_of_lading) {
    if (company) {
      return `${company} · B/L ${item.bill_of_lading} · ${docsLabel}`;
    }
    return `B/L ${item.bill_of_lading} Import · ${docsLabel}`;
  }

  // Pattern 3: Company known
  if (company) {
    return `${company} Import · ${docsLabel}`;
  }

  // Pattern 4: Fallback for unassigned intake
  return `Import Intake · ${docsLabel}`;
}

function resolveDetailSnippet(item: CaseSummary): string {
  if (item.review_reason) {
    return item.review_reason;
  }
  if (item.analysis_outcome === "PASS") {
    return "All document comparisons passed";
  }
  if (item.state === "ready_for_approval" || item.state === "ready") {
    return "Verified and ready for approval";
  }
  if (item.state === "approved") {
    return "Approved by staff";
  }
  if (item.state === "processing" || item.state === "queued") {
    return "AI analysis in progress";
  }
  return "Document findings ready for staff review";
}

function ChannelBadge({ channel }: { channel: string }) {
  switch (channel) {
    case "folder":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
          <Folder className="size-3.5 text-blue-500 shrink-0" aria-hidden />
          <span>Watched folder</span>
        </span>
      );
    case "gmail":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
          <Mail className="size-3.5 text-rose-500 shrink-0" aria-hidden />
          <span>Gmail</span>
        </span>
      );
    case "manual":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
          <Upload className="size-3.5 text-slate-500 shrink-0" aria-hidden />
          <span>Manual upload</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
          <span>{label(channel)}</span>
        </span>
      );
  }
}

function rowToneClass(state: string) {
  switch (state) {
    case "needs_review":
    case "manual_matching":
    case "awaiting_updated_document":
      return "bg-background";
    case "ready_for_approval":
    case "ready":
      return "bg-background";
    case "processing":
    case "running":
    case "queued":
      return "bg-background/80";
    case "failed":
    case "rejected":
    case "mismatch":
      return "bg-rose-50/20 dark:bg-rose-950/10";
    case "approved":
    default:
      return "bg-muted/30 text-muted-foreground";
  }
}

interface IntakeTableViewProps {
  items: CaseSummary[];
  companyId?: string;
  inbox: boolean;
  draftView: boolean;
}

export function IntakeTableView({
  items,
  companyId,
  inbox,
  draftView,
}: IntakeTableViewProps) {
  const router = useRouter();

  return (
    <div className="relative">
      <Table className="min-w-[1020px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-36 pl-4">Reference</TableHead>
            <TableHead className="min-w-64 max-w-xl">Subject</TableHead>
            <TableHead className="w-32 font-mono">B/L Number</TableHead>
            <TableHead className="w-40">Company</TableHead>
            <TableHead className="w-36">{inbox ? "Source" : "Verification"}</TableHead>
            <TableHead className="w-24 text-center">{inbox ? "Files" : "Findings"}</TableHead>
            <TableHead className="w-40">Received</TableHead>
            <TableHead className="w-24 text-center">Status</TableHead>
            <TableHead className="w-24 text-right pr-4">
              <span className="sr-only">Details</span>
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {items.map((item) => {
            const href = scopedPath(`/review/${item.id}`, companyId);
            const refText = item.detected_reference ?? item.id.slice(0, 8);
            const subjectText = resolveCaseSubject(item);
            const hasRoles = Boolean(item.document_roles && item.document_roles.length > 0);
            const rolesText = formatDocRolesText(item.document_roles);
            const detailSnippet = resolveDetailSnippet(item);
            const isActionNeeded = [
              "needs_review",
              "manual_matching",
              "awaiting_updated_document",
              "failed",
            ].includes(item.state);

            return (
              <TableRow
                key={item.id}
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (
                    target.closest("button") ||
                    target.closest("input") ||
                    target.closest("a")
                  ) {
                    return;
                  }
                  router.push(href);
                }}
                className={cn(
                  "group relative cursor-pointer border-b transition-colors duration-100 hover:bg-accent/40",
                  rowToneClass(item.state)
                )}
              >
                {/* 1. Reference */}
                <TableCell className="max-w-36 truncate font-mono text-code-tabular align-middle pl-4">
                  <Link
                    href={href}
                    className={cn(
                      "data-link block truncate font-medium",
                      isActionNeeded ? "font-bold text-foreground" : "text-muted-foreground"
                    )}
                    title={refText}
                  >
                    {refText}
                  </Link>
                </TableCell>

                {/* 2. Subject & Details (Max 2 lines, clean text, no background badges) */}
                <TableCell className="min-w-64 max-w-xl py-2 align-middle">
                  <div className="flex flex-col justify-center min-w-0 max-w-full">
                    {/* Line 1: Subject */}
                    <div
                      className={cn(
                        "truncate text-body-sm leading-snug",
                        isActionNeeded
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground font-normal"
                      )}
                      title={subjectText}
                    >
                      {subjectText}
                    </div>

                    {/* Line 2: Details snippet (Clean text, no bg, max 1 line) */}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate leading-normal pt-0.5">
                      {/* Document roles as clean text (e.g. INV · PL · B/L) or attachment count with paperclip icon (e.g. 📎 1 doc) */}
                      {hasRoles ? (
                        <span className="font-mono text-[11px] font-semibold text-foreground/75 shrink-0">
                          {rolesText}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground/75 shrink-0">
                          <Paperclip className="size-3 text-muted-foreground shrink-0" aria-hidden />
                          <span>{item.attachment_count} {item.attachment_count === 1 ? "doc" : "docs"}</span>
                        </span>
                      )}

                      {/* Issue count as clean text without bg and without warning emoji: e.g. 11 issues */}
                      {typeof item.issue_count === "number" && item.issue_count > 0 && (
                        <>
                          <span className="text-muted-foreground/40 shrink-0">·</span>
                          <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 shrink-0">
                            {item.issue_count} {item.issue_count === 1 ? "issue" : "issues"}
                          </span>
                        </>
                      )}

                      {/* Detail snippet */}
                      {detailSnippet && (
                        <>
                          <span className="text-muted-foreground/40 shrink-0">·</span>
                          <span
                            className="truncate text-[11px] text-muted-foreground"
                            title={item.review_reason ?? detailSnippet}
                          >
                            {detailSnippet}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </TableCell>

                {/* 3. B/L Number */}
                <TableCell className="max-w-32 truncate font-mono text-code-tabular align-middle">
                  {item.bill_of_lading ? (
                    <span className="inline-block rounded bg-muted/70 px-1.5 py-0.5 text-xs text-foreground font-medium">
                      {item.bill_of_lading}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>

                {/* 4. Company */}
                <TableCell
                  className={cn(
                    "max-w-40 truncate align-middle text-body-sm",
                    isActionNeeded ? "font-semibold text-foreground" : "text-muted-foreground"
                  )}
                  title={item.company ?? undefined}
                >
                  {item.company ?? "Unassigned"}
                </TableCell>

                {/* 5. Source / Verification */}
                <TableCell className="whitespace-nowrap align-middle">
                  {inbox ? (
                    <ChannelBadge channel={item.channel} />
                  ) : item.analysis_outcome ? (
                    <Status value={item.analysis_outcome} />
                  ) : (
                    "—"
                  )}
                </TableCell>

                {/* 6. Files (Rich SVG file type icons) */}
                <TableCell className="text-center whitespace-nowrap align-middle">
                  {inbox ? (
                    <FilesCell item={item} />
                  ) : typeof item.issue_count === "number" ? (
                    item.issue_count
                  ) : (
                    "—"
                  )}
                </TableCell>

                {/* 7. Received Date */}
                <TableCell className="whitespace-nowrap font-mono text-code-tabular align-middle">
                  <span
                    className={cn(
                      "text-xs",
                      isActionNeeded ? "text-foreground font-medium" : "text-muted-foreground"
                    )}
                  >
                    {timestamp(item.received_at ?? item.created_at)}
                  </span>
                </TableCell>

                {/* 8. Status */}
                <TableCell className="text-center whitespace-nowrap align-middle">
                  <Status value={item.state} />
                </TableCell>

                {/* 9. Hover Action (Gmail-style Instant Review Button) */}
                <TableCell className="text-right whitespace-nowrap align-middle pr-4">
                  <div className="flex items-center justify-end">
                    {/* Hover state: pop active button */}
                    <Link
                      href={href}
                      aria-label={draftView ? "Review draft" : "Open case"}
                      className="hidden group-hover:inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-all focus-visible:outline-offset-1"
                    >
                      <span>Review</span>
                      <ArrowRight size={12} aria-hidden />
                    </Link>

                    {/* Resting state: subtle Open arrow */}
                    <span className="group-hover:hidden inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <span>Open</span>
                      <ArrowRight size={12} aria-hidden />
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
