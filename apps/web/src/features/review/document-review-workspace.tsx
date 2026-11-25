"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition, type ReactNode } from "react";
import { ArrowUpRight, Check, CheckCircle2, ScanSearch, Sparkles } from "lucide-react";
import { AssignCompanyForm } from "@/features/companies/company-forms";
import { RefreshButton } from "@/components/ui/refresh-button";
import { VerificationWorkspace, type VerificationWorkspaceHandle } from "@/features/review/verification/verification-workspace";
import { intakeStatus } from "@/features/review/intake-studio-panel";
import { ReviewAuditControls, reviewDraft, reviewKey, type ReviewDraft } from "@/features/review/staff-review";
import { AdvisoryPanel, Findings } from "@/features/review/review-findings";
import { Empty, Section, Status } from "@/components/ui/page-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { DialogCloseButton } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "@/lib/toast";
import { write } from "@/lib/client-api";
import type { CaseActivity, CaseDetail, Company, Evidence, ExtractedField, Finding, MasterVersion, ReviewAnalysis, ReviewField, ReviewWorkflow, StaffReview } from "@/lib/contracts";
import { documentFieldLabel, intakeField, invoiceReference, label, timestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

const auditViews = ["All", "Blockers", "Warnings", "Passed"] as const;
const consignmentFields = ["bl_no", "vessel", "consignee", "container", "seal", "origin", "port", "destination"];

export function DocumentReviewWorkspace({
  item,
  analysis,
  workflow,
  companies,
  activity,
  share,
  versions,
  admin,
}: {
  item: CaseDetail;
  analysis: ReviewAnalysis;
  versions: MasterVersion[];
  workflow: ReviewWorkflow;
  companies: Company[];
  activity: CaseActivity[];
  admin: boolean;
  share?: ReactNode;
  initialTab?: "documents" | "verification";
}) {
  const router = useRouter();
  const [auditView, setAuditView] = useState<typeof auditViews[number]>("All");
  const [auditOpen, setAuditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [actionError, setActionError] = useState("");
  const [recent, setRecent] = useState<{ revision: number; base: string | null; review: StaffReview }>();
  const workspaceRef = useRef<VerificationWorkspaceHandle>(null);

  const remoteId = workflow.review?.id ?? null;
  const saved = recent && recent.revision === analysis.revision && recent.base === remoteId ? recent.review : workflow.review;
  const busy = saving || refreshing;
  const path = `/intakes/${item.id}`;
  const approval = workflow.decisions.find(
    (entry) => entry.scope === "intake" && entry.decision === "approved" && entry.revision === analysis.revision
  );
  const reviewedFields = new Map(saved?.changes.map(({ edit, after }) => [reviewKey(edit), after]));
  const reference = invoiceReference(item.detected_reference);
  const master = analysis.analyzed_master ?? analysis.comparison_master;

  const sources = [
    ...item.documents.map((document) => ({
      id: document.id,
      name: document.original_filename,
      fileType: document.mime === "application/pdf" ? "PDF" : "Excel",
      url: `/api/v1/documents/${document.id}/download`,
      received: document.received_at,
      checksum: document.sha256,
      previousId: document.parent_version_id,
      version_number: document.version_number ?? 1,
      classification: document.classification,
    })),
    ...(master
      ? [
          {
            id: master.source_id,
            name: master.original_filename,
            fileType: "CDC" as const,
            url: `/api/v1/cdc/versions/${master.id}/download`,
            received: null,
            checksum: null,
            previousId: null,
            version_number: undefined,
            classification: undefined,
          },
        ]
      : []),
  ];
  const names = new Map(sources.map(({ id, name }) => [id, name]));

  const tally: Record<Finding["outcome"], number> = { PASS: 0, WARNING: 0, MISMATCH: 0, NEEDS_REVIEW: 0 };
  for (const finding of analysis.findings) tally[finding.outcome] += 1;
  const issueCount = saved?.open_issues ? Object.keys(saved.open_issues).length : tally.MISMATCH + tally.WARNING + tally.NEEDS_REVIEW;
  const auditCounts = { All: analysis.findings.length, Blockers: tally.MISMATCH, Warnings: tally.WARNING + tally.NEEDS_REVIEW, Passed: tally.PASS };
  const stale = analysis.analysis_revision !== null && analysis.analysis_revision !== analysis.revision;
  const editable = !stale && analysis.state === "available" && ["needs_review", "ready_for_approval", "awaiting_updated_document"].includes(item.state);

  function displayedField(target: ReviewField, field: ExtractedField): ExtractedField {
    const translated =
      target.name === "description" && target.row
        ? reviewedFields.get(reviewKey({ ...target, name: "english_description" }))
        : undefined;
    const reviewed = reviewedFields.get(reviewKey(target));
    return translated ? { ...translated, english: null } : reviewed ?? field;
  }

  const metadata = consignmentFields.flatMap((key) => {
    for (const role of ["final_bl", "draft_bl", "invoice", "packing_list"] as const) {
      const docs = analysis.extractions.filter((doc) => doc.role === role);
      const field = docs.length >= 1 ? docs[0].fields[key] : undefined;
      if (field?.value) {
        const target: ReviewField = { document_id: docs[0].document_id, role, row: null, name: key };
        return [{ key, title: documentFieldLabel(key), field: displayedField(target, field), target }];
      }
    }
    return [];
  });

  const inspect = useCallback((evidence?: Evidence) => {
    if (evidence?.raw) {
      toast.info(`Citation: ${evidence.raw}`);
    }
  }, []);

  async function updateReview(action: () => Promise<StaffReview>) {
    setSaving(true);
    setActionError("");
    try {
      const review = await action();
      setRecent({ revision: analysis.revision, base: remoteId, review });
      startRefresh(() => router.refresh());
      return review;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Review update failed";
      setActionError(message);
      toast.error(message);
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function saveReview(draft: ReviewDraft) {
    return updateReview(() => write(`${path}/review`, { ...draft, expected_revision: analysis.revision }));
  }

  async function decide(kind: "approve" | "reject" | "processed", notes = "Approved after staff review.", reviewId?: string | null) {
    await updateReview(() =>
      write(
        `${path}/${kind}`,
        kind === "processed"
          ? { expected_revision: analysis.revision, approval_id: approval?.id }
          : { expected_revision: analysis.revision, review_id: reviewId !== undefined ? reviewId : saved?.id ?? null, notes }
      )
    );
    if (kind === "approve") {
      toast.saved("Shipment approved!");
    } else if (kind === "reject") {
      toast.updated("Shipment rejected");
    } else {
      toast.saved("Marked as processed");
    }
  }

  async function handleApprove() {
    setActionError("");
    if (workspaceRef.current) {
      await workspaceRef.current.validateAndApprove();
    } else {
      try {
        await decide("approve", "Approved after staff review.", saved?.id ?? null);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Failed to approve review.");
      }
    }
  }

  const hasFinalBL = Boolean(
    analysis.version_diff?.is_final_bl || item.documents.some((d) => d.classification === "final_bl")
  );
  const requiresFinalConfirmation = Boolean(hasFinalBL && item.final_bl_confirmed_revision !== analysis.revision);

  async function handleConfirmFinalBL() {
    setActionError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/intakes/${item.id}/confirm-final-bl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_revision: analysis.revision }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail || "Failed to confirm Final B/L");
      }
      toast.saved("Final B/L confirmed!");
      startRefresh(() => router.refresh());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to confirm Final B/L");
    } finally {
      setSaving(false);
    }
  }

  function caseAction(kind: "approve" | "processed") {
    setActionError("");
    if (kind === "approve") {
      void handleApprove();
    } else {
      void decide(kind).catch((error) => setActionError(error.message));
    }
  }

  return (
    <Sheet open={auditOpen} onOpenChange={setAuditOpen}>
      <div className="space-y-gutter lg:space-y-gutter-desktop">
        {/* Top Bar: Breadcrumb + Action Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/inbox">Inbox</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href={`/review/${item.id}`}>{reference ?? item.id.slice(0, 8)}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Document verification</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            {share}
            {(item.state === "ready_for_approval" || item.state === "needs_review") && (
              <Button type="button" size="sm" disabled={busy} onClick={() => caseAction("approve")}>
                <Check aria-hidden /> Approve
              </Button>
            )}
            {requiresFinalConfirmation && (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={handleConfirmFinalBL}
                className="bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-xs text-xs"
              >
                <Check aria-hidden className="size-3.5 mr-1" /> Confirm Final B/L
              </Button>
            )}
            {item.state === "approved" && approval && !workflow.processed && (
              <Button type="button" size="sm" disabled={busy} onClick={() => caseAction("processed")}>
                <Check aria-hidden /> Add to Processed
              </Button>
            )}
            {workflow.processed && <Badge variant="secondary">Processed</Badge>}
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                type="button"
                className="border-intelligence-border bg-intelligence-fill text-intelligence hover:bg-intelligence-border"
              >
                <Sparkles aria-hidden /> Audit &amp; findings
                {issueCount > 0 && <Badge variant="destructive">{issueCount}</Badge>}
              </Button>
            </SheetTrigger>
          </div>
        </div>
        {actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}

        {/* Case Header Card */}
        <header className="panel overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <h1 className="break-words text-headline-lg">{reference ?? "Intake case"}</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
                <span>
                  {item.company ?? "Unassigned"} · {label(item.channel)} ·{" "}
                  <time dateTime={item.created_at} className="font-mono text-code-tabular">
                    {timestamp(item.created_at)}
                  </time>
                </span>
                <Status value={item.state} />
                {stale && <Status value="previous_analysis" />}
                {item.import_id && (
                  <Link href={`/imports/${item.import_id}?tab=documents`} className="data-link text-xs">
                    Linked import &amp; documents →
                  </Link>
                )}
              </div>
            </div>
          </div>
          {!item.company_id && !item.import_id && !["approved", "rejected"].includes(item.state) && (
            <AssignCompanyForm companies={companies} caseId={item.id} revision={analysis.revision} />
          )}
          {metadata.length > 0 && (
            <dl className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-4 md:grid-cols-none md:grid-flow-col md:auto-cols-fr md:grid-rows-1">
              {metadata.map(({ key, title, field }) => {
                const text = intakeField(field);
                const needsReview = intakeStatus(field) === "review";
                return (
                  <div key={key} className="min-w-0 bg-background px-3.5 py-2 space-y-0.5">
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                      {title}
                    </dt>
                    <dd
                      className={cn(
                        "flex min-w-0 items-center gap-1.5 truncate text-xs font-semibold text-primary",
                        ["bl_no", "container", "seal"].includes(key) && "font-mono"
                      )}
                      title={text.value}
                    >
                      <span className="truncate">{text.value}</span>
                      {needsReview && (
                        <span className="size-1.5 rounded-full bg-amber-500 shrink-0" title="Review suggested" />
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </header>

        {/* Banner linking to Import Record Document Review if case is approved */}
        {item.state === "approved" && item.import_id && (
          <div className="flex items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-50/70 p-3 text-xs text-emerald-950 dark:border-emerald-500/20 dark:bg-emerald-950/30 dark:text-emerald-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
              <span>
                <strong>Shipment case approved.</strong> Full document review with INV, PL, and B/L PDF previews is available in the Import Record.
              </span>
            </div>
            <Button asChild size="xs" variant="outline" className="border-emerald-600/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50">
              <Link href={`/imports/${item.import_id}?tab=documents`}>
                Open Document Review <ArrowUpRight className="ml-1 size-3" />
              </Link>
            </Button>
          </div>
        )}

        {/* Direct Verification Workspace (User requested intake case to show only verification) */}
        <VerificationWorkspace
          ref={workspaceRef}
          key={`${item.id}:${analysis.revision}`}
          item={item}
          analysis={analysis}
          workflow={workflow}
          saved={saved}
          versions={versions}
          admin={admin}
          onSaved={(review) => setRecent({ revision: analysis.revision, base: remoteId, review })}
          onPending={setSaving}
          onActionError={setActionError}
          onOpenAudit={() => setAuditOpen(true)}
        />
      </div>

      <SheetContent aria-describedby={undefined}>
        <div className="sticky top-0 z-10 flex min-h-12 items-center justify-between border-b bg-card px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="flex items-center gap-2 text-headline-md">
              <ScanSearch size={16} aria-hidden className="text-tertiary" /> Audit &amp; Compliance
            </SheetTitle>
            {analysis.rules_version && <Badge variant="secondary">v{analysis.rules_version}</Badge>}
          </div>
          <DialogCloseButton label="Close audit drawer" />
        </div>
        <div className="space-y-gutter p-3">
          <Section title="Validation Rules">
            <nav className="flex flex-wrap gap-1.5 border-b p-2" aria-label="Filter audit checks">
              {auditViews.map((tab) => (
                <Button
                  key={tab}
                  variant={auditView === tab ? "default" : "outline"}
                  size="xs"
                  type="button"
                  aria-pressed={auditView === tab}
                  onClick={() => setAuditView(tab)}
                >
                  {tab} <span className="font-mono text-code-badge">{auditCounts[tab]}</span>
                </Button>
              ))}
            </nav>
            <Findings analysis={analysis} names={names} onInspect={inspect} auditFilter={auditView} />
          </Section>
          {analysis.version_diff?.has_revisions && (
            <Section title="Document Revisions">
              <div className="space-y-2 p-3 text-xs">
                {analysis.version_diff.diffs.map((diff) => (
                  <div key={diff.document_id} className="rounded border bg-card p-2.5 space-y-1">
                    <div className="flex items-center justify-between font-medium">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileTypeIcon filename={diff.original_filename} size="xs" />
                        <span className="font-semibold text-foreground truncate">
                          {diff.original_filename} (v{diff.version_number})
                        </span>
                      </div>
                      {diff.parent_filename && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          replaces {diff.parent_filename}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {Object.entries(diff.modified).map(([f, vals]) => (
                        <span
                          key={f}
                          className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] border border-amber-500/20 text-amber-900 dark:text-amber-200"
                        >
                          <span className="font-medium text-amber-700 dark:text-amber-400">{documentFieldLabel(f)}:</span>
                          <span className="line-through text-muted-foreground text-[10px]">{String(vals.old)}</span>
                          <span className="font-semibold text-foreground">→ {String(vals.new)}</span>
                        </span>
                      ))}
                      {Object.entries(diff.added).map(([f, val]) => (
                        <span
                          key={f}
                          className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] border border-emerald-500/20 text-emerald-900 dark:text-emerald-200"
                        >
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">+{documentFieldLabel(f)}:</span>
                          <span className="font-semibold text-foreground">{String(val)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
          <div className="space-y-2 px-2">
            <ReviewAuditControls
              caseId={item.id}
              workflow={workflow}
              saved={saved}
              busy={busy}
              editable={editable}
              onResolve={async (key, note) => {
                await saveReview({
                  ...reviewDraft(saved),
                  issue_actions: reviewDraft(saved).issue_actions.filter((action) => action.key !== key),
                  resolutions: [...(saved?.resolutions ?? []).filter((entry) => entry.key !== key), { key, note }],
                });
                toast.updated("Issue resolved");
              }}
              onRequestCorrection={async (note) => {
                await saveReview({ ...reviewDraft(saved), request_correction: note });
                toast.updated("Correction requested");
              }}
              onReject={(note) => decide("reject", note)}
            />
          </div>
          <Section title="Analysis trace">
            <dl className="grid divide-y px-3 text-body-sm">
              <Trace label="Revision">{analysis.analysis_revision ?? "Pending"}</Trace>
              <Trace label="Rules">{analysis.rules_version ?? "—"}</Trace>
              <Trace label="Analyzed">{timestamp(analysis.extracted_at)}</Trace>
              <Trace label="Trace ID">{analysis.trace_id ?? "—"}</Trace>
            </dl>
          </Section>
          <Section title="Activity log">
            {activity.length ? (
              <ol className="divide-y text-xs px-3">
                {activity.map((event) => (
                  <li key={event.id} className="flex items-center justify-between py-2">
                    <div>
                      <span className="font-semibold capitalize">{label(event.event_type)}</span>
                      <p className="text-muted-foreground">{event.actor ?? "Automation worker"}</p>
                    </div>
                    <time className="font-mono text-muted-foreground text-[11px]">{timestamp(event.created_at)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="p-3">
                <Empty>No activity yet.</Empty>
              </div>
            )}
          </Section>
          <Section title="AI suggestions">
            <AdvisoryPanel analysis={analysis} />
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Trace({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all text-right font-mono text-code-tabular">{children}</dd>
    </div>
  );
}
