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

function roleChip(role: string) {
  switch (role) {
    case "commercial_invoice":
    case "invoice":
      return {
        label: "INV",
        title: "Commercial Invoice",
        className:
          "bg-emerald-100/90 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300/50",
      };
    case "packing_list":
      return {
        label: "PL",
        title: "Packing List",
        className:
          "bg-sky-100/90 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border-sky-300/50",
      };
    case "draft_bl":
    case "final_bl":
      return {
        label: "B/L",
        title: "Bill of Lading",
        className:
          "bg-indigo-100/90 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-300/50",
      };
    default:
      return {
        label: role.slice(0, 3).toUpperCase(),
        title: label(role),
        className: "bg-muted text-muted-foreground border-border",
      };
  }
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
            <TableHead className="min-w-64 max-w-xl">Subject & Cargo Details</TableHead>
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
            const subjectText = item.subject ?? item.sender ?? "—";
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

                {/* 2. Subject + Document Attachment Badges + Discrepancy snippet */}
                <TableCell className="min-w-64 max-w-xl py-2.5 align-middle">
                  <div className="space-y-1">
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

                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {/* Document Role Chips (Gmail Attachment Chips) */}
                      {item.document_roles && item.document_roles.length > 0 ? (
                        item.document_roles.map((role) => {
                          const chip = roleChip(role);
                          return (
                            <span
                              key={role}
                              title={chip.title}
                              className={cn(
                                "inline-flex items-center rounded border px-1.5 py-0.2 text-[10px] font-mono font-medium tracking-tight",
                                chip.className
                              )}
                            >
                              {chip.label}
                            </span>
                          );
                        })
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Paperclip size={11} className="shrink-0" />
                          <span>{item.attachment_count} {item.attachment_count === 1 ? "doc" : "docs"}</span>
                        </span>
                      )}

                      {/* Issue snippet / Review Reason */}
                      {typeof item.issue_count === "number" && item.issue_count > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded border border-amber-200/80 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/40 px-1.5 py-0.2 text-[10px] font-medium text-amber-800 dark:text-amber-300">
                          ⚠️ {item.issue_count} {item.issue_count === 1 ? "issue" : "issues"}
                        </span>
                      ) : null}

                      {item.review_reason && (
                        <span
                          className="max-w-64 truncate text-[11px] text-muted-foreground/80 italic"
                          title={item.review_reason}
                        >
                          • {item.review_reason}
                        </span>
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
