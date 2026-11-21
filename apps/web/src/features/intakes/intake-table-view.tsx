"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronDown,
  CornerDownRight,
  Folder,
  Mail,
  Paperclip,
  Upload,
} from "lucide-react";
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
  if (!isGenericSubject(item.subject)) {
    return item.subject!;
  }

  const docsLabel = formatDocPackageSummary(item.document_roles);
  const hasRealRef = item.detected_reference && !isHexReference(item.detected_reference);
  const company = item.company && item.company !== "Unassigned" ? item.company : null;
  const cargo = item.cargo_summary?.trim();

  if (hasRealRef) {
    if (cargo) {
      return `${item.detected_reference} Import · ${cargo} (${docsLabel})`;
    }
    if (company) {
      return `${item.detected_reference} Import · ${company} (${docsLabel})`;
    }
    return `${item.detected_reference} Import · ${docsLabel}`;
  }

  if (item.bill_of_lading) {
    if (company) {
      return `${company} · B/L ${item.bill_of_lading} · ${docsLabel}`;
    }
    return `B/L ${item.bill_of_lading} Import · ${docsLabel}`;
  }

  if (company) {
    return `${company} Import · ${docsLabel}`;
  }

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

/**
 * Resolves the primary grouping key for a case.
 * Prioritizes extracted invoice number / reference so multiple arrivals
 * for the same shipment are unified into one case group.
 */
function getCaseGroupKey(item: CaseSummary): string {
  if (item.invoice_number && item.invoice_number.trim()) {
    return item.invoice_number.trim().toUpperCase();
  }
  if (item.detected_reference && !isHexReference(item.detected_reference)) {
    return item.detected_reference.trim().toUpperCase();
  }
  if (item.bill_of_lading && item.bill_of_lading.trim()) {
    return `BL:${item.bill_of_lading.trim().toUpperCase()}`;
  }
  return item.id;
}

export interface CaseGroup {
  key: string;
  invoiceNo: string;
  primaryCase: CaseSummary;
  arrivals: CaseSummary[];
  blNo?: string | null;
  shipper?: string | null;
  consignee?: string | null;
  cargoSummary?: string | null;
  allRoles: string[];
  rolesText: string;
  allFileTypes: string[];
  totalAttachments: number;
  totalIssues: number;
  analysisOutcome?: CaseSummary["analysis_outcome"];
  latestReceived: string;
  worstState: string;
}

export function groupCasesByInvoice(items: CaseSummary[]): CaseGroup[] {
  const groupsMap = new Map<string, CaseSummary[]>();

  for (const item of items) {
    const key = getCaseGroupKey(item);
    const existing = groupsMap.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groupsMap.set(key, [item]);
    }
  }

  const groups: CaseGroup[] = [];

  for (const [key, arrivals] of groupsMap.entries()) {
    arrivals.sort((a, b) => {
      const ta = new Date(a.received_at ?? a.created_at).getTime();
      const tb = new Date(b.received_at ?? b.created_at).getTime();
      return tb - ta;
    });

    const primaryCase = arrivals[0];
    const invoiceNo =
      primaryCase.invoice_number ||
      (primaryCase.detected_reference && !isHexReference(primaryCase.detected_reference)
        ? primaryCase.detected_reference
        : arrivals.find((a) => a.detected_reference && !isHexReference(a.detected_reference))?.detected_reference) ||
      primaryCase.detected_reference ||
      primaryCase.id.slice(0, 8);

    const blNo = arrivals.find((a) => a.bill_of_lading)?.bill_of_lading ?? null;
    const shipper = arrivals.find((a) => a.shipper)?.shipper ?? null;
    const consignee =
      arrivals.find((a) => a.consignee && a.consignee !== "Unassigned")?.consignee ||
      arrivals.find((a) => a.company && a.company !== "Unassigned")?.company ||
      primaryCase.consignee ||
      primaryCase.company ||
      null;

    const cargoSummary = arrivals.find((a) => a.cargo_summary)?.cargo_summary ?? null;

    const rolesSet = new Set<string>();
    for (const a of arrivals) {
      if (a.document_roles) {
        for (const r of a.document_roles) rolesSet.add(r);
      }
    }
    const allRoles = Array.from(rolesSet);
    const rolesText = formatDocRolesText(allRoles);

    const fileTypesSet = new Set<string>();
    let totalAttachments = 0;
    for (const a of arrivals) {
      totalAttachments += a.attachment_count;
      if (a.file_types) {
        for (const ft of a.file_types) fileTypesSet.add(ft);
      }
    }
    const allFileTypes = Array.from(fileTypesSet);

    const totalIssues = Math.max(...arrivals.map((a) => a.issue_count ?? 0));

    const outcomes = arrivals.map((a) => a.analysis_outcome).filter(Boolean);
    const analysisOutcome = outcomes.includes("MISMATCH")
      ? "MISMATCH"
      : outcomes.includes("WARNING")
      ? "WARNING"
      : outcomes.includes("NEEDS_REVIEW")
      ? "NEEDS_REVIEW"
      : outcomes.includes("PASS")
      ? "PASS"
      : undefined;

    const states = arrivals.map((a) => a.state);
    const statePriority = [
      "failed",
      "rejected",
      "needs_review",
      "manual_matching",
      "awaiting_updated_document",
      "processing",
      "queued",
      "ready_for_approval",
      "ready",
      "approved",
    ];
    let worstState = states[0];
    for (const sp of statePriority) {
      if (states.includes(sp)) {
        worstState = sp;
        break;
      }
    }

    const latestReceived = primaryCase.received_at ?? primaryCase.created_at;

    groups.push({
      key,
      invoiceNo,
      primaryCase,
      arrivals,
      blNo,
      shipper,
      consignee,
      cargoSummary,
      allRoles,
      rolesText,
      allFileTypes,
      totalAttachments,
      totalIssues,
      analysisOutcome,
      latestReceived,
      worstState,
    });
  }

  return groups;
}

interface IntakeTableViewProps {
  items: CaseSummary[];
  companyId?: string;
  inbox: boolean;
  draftView: boolean;
  mode?: string;
}

export function IntakeTableView({
  items,
  companyId,
  inbox,
  draftView,
  mode,
}: IntakeTableViewProps) {
  const router = useRouter();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // When on "Intake cases" (/review) or related case-centric views, render the invoice-merged table
  const isCasesView = !inbox && mode !== "drafts";

  if (isCasesView) {
    const caseGroups = groupCasesByInvoice(items);

    return (
      <div className="relative">
        <Table className="min-w-[1080px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-48 pl-4">Intake Reference / Inv No</TableHead>
              <TableHead className="w-36 font-mono">B/L Number</TableHead>
              <TableHead className="min-w-44 max-w-56">Shipper</TableHead>
              <TableHead className="min-w-44 max-w-56">Consignee</TableHead>
              <TableHead className="w-36">Documents</TableHead>
              <TableHead className="w-28 text-center">Verification</TableHead>
              <TableHead className="w-36">Received</TableHead>
              <TableHead className="w-24 text-center">Status</TableHead>
              <TableHead className="w-24 text-right pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {caseGroups.map((group) => {
              const primaryHref = scopedPath(`/review/${group.primaryCase.id}`, companyId);
              const isActionNeeded = [
                "needs_review",
                "manual_matching",
                "awaiting_updated_document",
                "failed",
              ].includes(group.worstState);
              const isExpanded = expandedGroups.has(group.key);
              const hasMultipleArrivals = group.arrivals.length > 1;

              return (
                <TableRowGroup
                  key={group.key}
                  group={group}
                  primaryHref={primaryHref}
                  isActionNeeded={isActionNeeded}
                  isExpanded={isExpanded}
                  hasMultipleArrivals={hasMultipleArrivals}
                  onToggle={() => toggleGroup(group.key)}
                  onNavigate={() => router.push(primaryHref)}
                  companyId={companyId}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  // Raw Inbox Feed View (/inbox)
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
                      {/* Document roles as clean text or attachment count with paperclip icon */}
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
                    <Link
                      href={href}
                      aria-label={draftView ? "Review draft" : "Open case"}
                      className="hidden group-hover:inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-all focus-visible:outline-offset-1"
                    >
                      <span>Review</span>
                      <ArrowRight size={12} aria-hidden />
                    </Link>

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

/**
 * Renders a consolidated shipment case group row, with expandable nested arrival sub-rows.
 */
function TableRowGroup({
  group,
  primaryHref,
  isActionNeeded,
  isExpanded,
  hasMultipleArrivals,
  onToggle,
  onNavigate,
  companyId,
}: {
  group: CaseGroup;
  primaryHref: string;
  isActionNeeded: boolean;
  isExpanded: boolean;
  hasMultipleArrivals: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  companyId?: string;
}) {
  const router = useRouter();

  return (
    <>
      <TableRow
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (
            target.closest("button") ||
            target.closest("input") ||
            target.closest("a")
          ) {
            return;
          }
          onNavigate();
        }}
        className={cn(
          "group relative cursor-pointer border-b transition-colors duration-100 hover:bg-accent/40",
          rowToneClass(group.worstState)
        )}
      >
        {/* 1. Intake Reference / Inv No (with group count badge & expand toggle) */}
        <TableCell className="max-w-48 align-middle pl-4 py-2.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {hasMultipleArrivals ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
                aria-label={isExpanded ? "Collapse arrivals" : "Expand arrivals"}
                title={`${group.arrivals.length} arrivals grouped`}
                className="grid size-5.5 place-items-center rounded hover:bg-muted text-muted-foreground transition-colors shrink-0 cursor-pointer"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform duration-200",
                    !isExpanded && "-rotate-90"
                  )}
                />
              </button>
            ) : (
              <span className="size-5.5 shrink-0" />
            )}

            <Link
              href={primaryHref}
              className={cn(
                "data-link block truncate font-mono text-code-tabular font-medium",
                isActionNeeded ? "font-bold text-foreground" : "text-muted-foreground"
              )}
              title={group.invoiceNo}
            >
              {group.invoiceNo}
            </Link>

            {hasMultipleArrivals && (
              <span
                className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-semibold text-primary shrink-0"
                title={`${group.arrivals.length} arrivals received for this invoice`}
              >
                {group.arrivals.length}
              </span>
            )}
          </div>
        </TableCell>

        {/* 2. B/L Number */}
        <TableCell className="max-w-36 truncate font-mono text-code-tabular align-middle">
          {group.blNo ? (
            <span className="inline-block rounded bg-muted/70 px-1.5 py-0.5 text-xs text-foreground font-medium truncate max-w-32" title={group.blNo}>
              {group.blNo}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>

        {/* 3. Shipper */}
        <TableCell className="max-w-56 truncate align-middle text-body-sm" title={group.shipper ?? undefined}>
          {group.shipper ? (
            <span className="font-medium text-foreground">{group.shipper}</span>
          ) : (
            <span className="text-muted-foreground font-normal">—</span>
          )}
        </TableCell>

        {/* 4. Consignee */}
        <TableCell className="max-w-56 truncate align-middle text-body-sm" title={group.consignee ?? undefined}>
          {group.consignee ? (
            <span className="font-medium text-foreground">{group.consignee}</span>
          ) : (
            <span className="text-muted-foreground font-normal">Unassigned</span>
          )}
        </TableCell>

        {/* 5. Documents & Files */}
        <TableCell className="max-w-36 align-middle">
          <div className="flex items-center gap-1.5 text-xs">
            <FileAttachmentGroup types={group.allFileTypes} count={group.totalAttachments} size="sm" />
            {group.rolesText ? (
              <span className="font-mono text-[11px] font-semibold text-foreground/75 truncate" title={group.rolesText}>
                {group.rolesText}
              </span>
            ) : null}
          </div>
        </TableCell>

        {/* 6. Verification / Issues */}
        <TableCell className="text-center whitespace-nowrap align-middle">
          {group.totalIssues > 0 ? (
            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              {group.totalIssues} {group.totalIssues === 1 ? "issue" : "issues"}
            </span>
          ) : group.analysisOutcome === "PASS" ? (
            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              Pass
            </span>
          ) : group.analysisOutcome ? (
            <Status value={group.analysisOutcome} />
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </TableCell>

        {/* 7. Received Date */}
        <TableCell className="whitespace-nowrap font-mono text-code-tabular align-middle text-xs text-muted-foreground">
          {timestamp(group.latestReceived)}
        </TableCell>

        {/* 8. Status */}
        <TableCell className="text-center whitespace-nowrap align-middle">
          <Status value={group.worstState} />
        </TableCell>

        {/* 9. Action */}
        <TableCell className="text-right whitespace-nowrap align-middle pr-4">
          <div className="flex items-center justify-end">
            <Link
              href={primaryHref}
              aria-label="Review case"
              className="hidden group-hover:inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-all focus-visible:outline-offset-1"
            >
              <span>Review</span>
              <ArrowRight size={12} aria-hidden />
            </Link>

            <span className="group-hover:hidden inline-flex items-center gap-1 text-xs text-muted-foreground">
              <span>Open</span>
              <ArrowRight size={12} aria-hidden />
            </span>
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded sub-rows showing individual arrivals in this case group */}
      {isExpanded &&
        hasMultipleArrivals &&
        group.arrivals.map((arrival, idx) => {
          const arrivalHref = scopedPath(`/review/${arrival.id}`, companyId);
          const arrivalSubject = resolveCaseSubject(arrival);

          return (
            <TableRow
              key={arrival.id}
              onClick={() => router.push(arrivalHref)}
              className="group/sub cursor-pointer border-b bg-muted/20 dark:bg-muted/10 hover:bg-accent/30 text-xs transition-colors"
            >
              {/* Indented Arrival indicator */}
              <TableCell className="pl-9 py-2 align-middle max-w-48 font-mono text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <CornerDownRight className="size-3 text-muted-foreground/60 shrink-0" aria-hidden />
                  <span className="font-semibold text-foreground/80">Arrival #{group.arrivals.length - idx}</span>
                </div>
              </TableCell>

              {/* Sub B/L or dash */}
              <TableCell className="font-mono text-[11px] text-muted-foreground">
                {arrival.bill_of_lading || "—"}
              </TableCell>

              {/* Sub Subject / Shipper details */}
              <TableCell colSpan={2} className="text-muted-foreground truncate max-w-80" title={arrivalSubject}>
                <div className="flex items-center gap-2 truncate">
                  <ChannelBadge channel={arrival.channel} />
                  <span className="truncate">{arrivalSubject}</span>
                </div>
              </TableCell>

              {/* Sub Files */}
              <TableCell className="align-middle">
                <FileAttachmentGroup
                  types={arrival.file_types}
                  count={arrival.attachment_count}
                  size="xs"
                />
              </TableCell>

              {/* Sub Issues */}
              <TableCell className="text-center align-middle text-[11px]">
                {arrival.issue_count && arrival.issue_count > 0 ? (
                  <span className="text-amber-700 dark:text-amber-400 font-medium">
                    {arrival.issue_count} {arrival.issue_count === 1 ? "issue" : "issues"}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>

              {/* Sub Received */}
              <TableCell className="font-mono text-code-tabular text-[11px] text-muted-foreground">
                {timestamp(arrival.received_at ?? arrival.created_at)}
              </TableCell>

              {/* Sub Status */}
              <TableCell className="text-center align-middle">
                <Status value={arrival.state} />
              </TableCell>

              {/* Sub Action */}
              <TableCell className="text-right pr-4 align-middle">
                <Link
                  href={arrivalHref}
                  className="text-xs text-primary hover:underline font-medium inline-flex items-center gap-1"
                >
                  <span>Review</span>
                  <ArrowRight size={11} aria-hidden />
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
    </>
  );
}
