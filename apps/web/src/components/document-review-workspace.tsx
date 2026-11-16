"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { ChevronRight, ScanSearch, Sparkles } from "lucide-react";
import { AssignCompanyForm } from "@/components/company-forms";
import { RefreshButton } from "@/components/forms";
import { DocumentCanvas, type DocumentSourceOption } from "@/components/document-canvas";
import { ConnectorLine } from "@/components/connector-line";
import { IntakeStudioPanel, type InspectedField } from "@/components/intake-studio-panel";
import { StaffReviewForm } from "@/components/staff-review";
import { AdvisoryPanel, Findings, sourceKey } from "@/components/review-evidence";
import { Empty, Section, Status } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { CaseActivity, CaseDetail, Company, Evidence, Finding, MasterVersion, ReviewAnalysis, ReviewWorkflow } from "@/lib/contracts";
import { documentFieldLabel, label, sourceValue, timestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

const documentTabs = ["B/L", "Invoice", "Packing list"] as const;
type DocumentTab = typeof documentTabs[number];

function tabToRole(tab: DocumentTab): "draft_bl" | "invoice" | "packing_list" {
  switch (tab) {
    case "B/L": return "draft_bl";
    case "Invoice": return "invoice";
    case "Packing list": return "packing_list";
  }
}

const auditViews = ["All", "Blockers", "Warnings", "Passed"] as const;
const consignmentFields = ["bl_no", "vessel", "consignee", "container", "seal", "origin", "destination"];

export function DocumentReviewWorkspace({ item, analysis, workflow, companies, activity, share }: {
  item: CaseDetail; analysis: ReviewAnalysis; versions: MasterVersion[]; workflow: ReviewWorkflow; companies: Company[]; activity: CaseActivity[]; admin: boolean; share?: ReactNode;
}) {
  const [chosenDocTab, setActiveDocTab] = useState<DocumentTab>();
  const [staffReviewOpen, setStaffReviewOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [selection, setSelection] = useState<Evidence>();
  const [activeFieldInfo, setActiveFieldInfo] = useState<InspectedField>();
  const [auditView, setAuditView] = useState<typeof auditViews[number]>("All");
  const [auditOpen, setAuditOpen] = useState(false);
  const focusEvidenceOnClose = useRef(false);
  const source = useRef<HTMLDivElement>(null);
  const workspaceGridRef = useRef<HTMLDivElement>(null);
  const master = analysis.analyzed_master;
  const sources = [
    ...item.documents.map((document) => ({
      id: document.id, name: document.original_filename, fileType: document.mime === "application/pdf" ? "PDF" : "Excel",
      url: `/api/v1/documents/${document.id}/download`, received: document.received_at,
      checksum: document.sha256, previousId: document.parent_version_id,
    })),
    ...(master ? [{id: master.source_id, name: master.original_filename, fileType: "CDC",
      url: `/api/v1/cdc/versions/${master.id}/download`, received: null, checksum: null, previousId: null}] : []),
  ];
  const names = new Map(sources.map(({id, name}) => [id, name]));
  const excerpts = analysis.extractions.map((extraction) => ({
    key: `${extraction.document_id}:${extraction.sheet ?? ""}:${extraction.role}`, id: extraction.document_id,
    title: label(extraction.role), sheet: extraction.sheet,
    lines: extraction.source_excerpt,
  }));
  const options = sources.flatMap((file) => {
    const matches = excerpts.filter((excerpt) => excerpt.id === file.id);
    return matches.length ? matches : [{key: file.id, id: file.id, title: file.name, sheet: null, lines: []}];
  });
  const activeDocTab = chosenDocTab ?? documentTabs.find((tab) => analysis.extractions.some((doc) => doc.role === tabToRole(tab))) ?? "B/L";
  const activeRole = tabToRole(activeDocTab);
  const current = options.find((option) => option.key === selectedKey)
    ?? options.find((option) => option.key.endsWith(`:${activeRole}`))
    ?? (!chosenDocTab ? options[0] : undefined);
  const activeDocument = analysis.extractions.find((doc, index) => doc.role === activeRole && excerpts[index].key === current?.key);
  const file = sources.find((entry) => entry.id === current?.id);
  const selectedEvidence = selection?.document_id === file?.id ? selection : undefined;
  const tally: Record<Finding["outcome"], number> = { PASS: 0, WARNING: 0, MISMATCH: 0, NEEDS_REVIEW: 0 };
  for (const finding of analysis.findings) tally[finding.outcome] += 1;
  const issueCount = tally.MISMATCH + tally.WARNING + tally.NEEDS_REVIEW;
  const auditCounts = { All: analysis.findings.length, Blockers: tally.MISMATCH, Warnings: tally.WARNING + tally.NEEDS_REVIEW, Passed: tally.PASS };
  const stale = analysis.analysis_revision !== null && analysis.analysis_revision !== analysis.revision;
  const metadata = consignmentFields.flatMap((key) => {
    for (const role of ["draft_bl", "invoice", "packing_list"]) {
      const docs = analysis.extractions.filter((doc) => doc.role === role);
      const field = docs.length === 1 ? docs[0].fields[key] : undefined;
      if (field?.value) return [{ key, title: documentFieldLabel(key), field }];
    }
    return [];
  });

  function handleDocTabChange(tab: DocumentTab) {
    setActiveDocTab(tab);
    setSelectedKey(undefined);
    setSelection(undefined);
    setActiveFieldInfo(undefined);
  }

  function chooseSource(key?: string) {
    setSelectedKey(key);
    setSelection(undefined);
    setActiveFieldInfo(undefined);
    const tab = documentTabs.find((entry) => key?.endsWith(`:${tabToRole(entry)}`));
    if (tab) setActiveDocTab(tab);
  }

  function inspect(evidence: Evidence, meta?: InspectedField) {
    const match = options.find((option) => option.id === evidence.document_id && option.sheet === evidence.sheet)
      ?? options.find((option) => option.id === evidence.document_id);
    if (!match) return;
    setSelectedKey(match.key);
    setSelection({ ...evidence });
    const tab = documentTabs.find((entry) => match.key.endsWith(`:${tabToRole(entry)}`));
    if (tab) setActiveDocTab(tab);

    if (meta) {
      setActiveFieldInfo(meta);
    } else {
      let found: InspectedField | undefined;
      const citation = sourceKey(evidence);
      for (const ext of analysis.extractions) {
        for (const [k, f] of Object.entries(ext.fields)) {
          if (f.value && f.evidence.some((e) => sourceKey(e) === citation)) {
            found = { id: `field:${k}`, name: documentFieldLabel(k), value: sourceValue(f), uncertain: f.status === "uncertain" };
            break;
          }
        }
        if (found) break;
      }
      setActiveFieldInfo(found ?? (evidence.raw ? { name: "Source citation", value: evidence.raw } : undefined));
    }

    if (auditOpen) {
      focusEvidenceOnClose.current = true;
      setAuditOpen(false);
    } else {
      focusSource();
    }
  }

  function focusSource() {
    const viewer = source.current;
    const workspace = workspaceGridRef.current;
    if (!viewer || !workspace) return;
    const bounds = viewer.getBoundingClientRect();
    const stacked = bounds.left <= workspace.getBoundingClientRect().left + 1;
    if (stacked || bounds.top >= window.innerHeight || bounds.bottom <= 0) {
      viewer.scrollIntoView({ block: "start" });
    }
    viewer.focus({ preventScroll: true });
  }

  const canvasOptions: DocumentSourceOption[] = options.map((opt) => {
    const optFile = sources.find((s) => s.id === opt.id);
    return {
      key: opt.key,
      id: opt.id,
      title: opt.title,
      sheet: opt.sheet,
      fileType: (optFile?.fileType as "PDF" | "Excel" | "CDC") ?? "Excel",
      name: optFile?.name ?? opt.title,
      url: optFile?.url ?? "",
      lines: opt.lines,
    };
  });

  return <Sheet open={auditOpen} onOpenChange={setAuditOpen}>
    <div className="space-y-gutter lg:space-y-gutter-desktop">
      <header className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5 text-label-md text-muted-foreground">
            <Link href="/inbox" className="shrink-0 hover:text-primary">Inbox</Link>
            <ChevronRight size={13} aria-hidden className="shrink-0" />
            <span className="truncate font-mono text-code-tabular text-primary">{item.detected_reference ?? "Reference pending"}</span>
            <ChevronRight size={13} aria-hidden className="shrink-0" />
            <span className="shrink-0">Document review</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <RefreshButton />
            {share}
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" type="button" className="border-intelligence-border bg-intelligence-fill text-intelligence hover:bg-intelligence-border">
                <Sparkles aria-hidden /> Audit &amp; findings
                {issueCount > 0 && <Badge variant="destructive">{issueCount}</Badge>}
              </Button>
            </SheetTrigger>
          </div>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <h1 className="break-words text-headline-lg">{item.detected_reference ?? item.subject ?? "Intake case"}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
              <span>{item.company ?? "Unassigned"} · {label(item.channel)} · <time dateTime={item.created_at} className="font-mono text-code-tabular">{timestamp(item.created_at)}</time></span>
              <Status value={item.state} />
              {stale && <Status value="previous_analysis" />}
              {item.import_id && <Link href={`/imports/${item.import_id}`} className="data-link text-xs">Linked import</Link>}
            </div>
          </div>
          {analysis.rules_version && <p className="flex items-center gap-1.5 font-mono text-code-badge text-intelligence"><Sparkles size={13} aria-hidden /> Rule Engine v{analysis.rules_version}</p>}
        </div>
        {!item.company_id && !item.import_id && !["approved", "rejected"].includes(item.state) && <AssignCompanyForm companies={companies} caseId={item.id} revision={analysis.revision} />}
        {metadata.length > 0 && <dl className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-3 xl:grid-cols-7">
          {metadata.map(({ key, title, field }) => <div key={key} className="min-w-0 bg-background px-3 py-2">
            <dt className="panel-label">{title}</dt>
            <dd className={cn("mt-0.5 min-w-0 truncate text-label-md", ["bl_no", "container", "seal"].includes(key) && "font-mono text-code-tabular")} title={field.value ?? undefined}>
              {field.evidence[0] ? <button type="button" className="data-link block max-w-full cursor-pointer truncate text-left"
                onClick={() => inspect(field.evidence[0], { id: `field:${key}`, name: title, value: sourceValue(field), uncertain: field.status === "uncertain" })}>{field.value}</button> : field.value}
              {field.status === "uncertain" && <span className="block text-warning">Uncertain</span>}
            </dd>
          </div>)}
        </dl>}
      </header>

      {/* Main Review Workspace Layout */}
      <div
        ref={workspaceGridRef}
        className="relative grid min-w-0 items-start gap-gutter lg:gap-gutter-desktop xl:grid-cols-12"
        role="region"
        aria-label="Document evidence and comparisons"
      >
        <ConnectorLine containerRef={workspaceGridRef} active={!!selectedEvidence} />
        {/* Left Column: Review & Extractions Panel */}
        <div className="min-w-0 space-y-gutter xl:col-span-5">
          <div className="panel overflow-hidden">
            {/* Exactly 3 Document Intake Tabs (matching simple flat tab style) */}
            <nav className="flex border-b bg-background px-2" aria-label="Document intake tabs">
              {documentTabs.map((tab) => {
                const active = activeDocTab === tab;
                const role = tabToRole(tab);
                const doc = analysis.extractions.find((d) => d.role === role);
                const count = doc ? (doc.items?.length || Object.values(doc.fields).filter((f) => f?.value).length) : null;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => handleDocTabChange(tab)}
                    aria-pressed={active}
                    className={cn(
                      "cursor-pointer border-b-2 px-4 py-2 text-xs font-semibold transition-all focus-visible:outline-offset-[-2px] flex items-center gap-1.5",
                      active
                        ? "border-primary text-primary font-bold"
                        : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                    )}
                  >
                    <span>{tab}</span>
                    {typeof count === "number" && count > 0 && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                          active
                            ? "bg-primary/10 text-primary font-bold"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <IntakeStudioPanel
              item={item}
              analysis={analysis}
              document={activeDocument}
              activeEvidence={selectedEvidence}
              activeField={activeFieldInfo}
              activeRole={activeRole}
              onInspect={inspect}
              onApprove={() => setStaffReviewOpen(true)}
            />
          </div>
        </div>

        {/* Right Column: Document Canvas Artboard */}
        <div ref={source} tabIndex={-1} role="region" aria-label="Source viewer" className="min-w-0 scroll-mt-20 xl:col-span-7 xl:sticky xl:top-4 outline-none">
          <DocumentCanvas
            key={current?.key}
            file={file ? { id: file.id, name: file.name, fileType: file.fileType as "PDF" | "Excel" | "CDC", url: file.url } : undefined}
            options={canvasOptions}
            currentKey={current?.key}
            onChooseSource={chooseSource}
            evidence={selectedEvidence}
            activeFieldInfo={activeFieldInfo}
            onDismissField={() => {
              setSelection(undefined);
              setActiveFieldInfo(undefined);
            }}
          />
        </div>
      </div>

    </div>

    {/* Staff Review & Approval Dialog */}
    <Dialog open={staffReviewOpen} onOpenChange={setStaffReviewOpen}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between border-b pb-2.5 mb-3">
          <DialogTitle className="text-headline-md font-semibold">Staff Review &amp; Approval</DialogTitle>
          <DialogCloseButton />
        </div>
        <StaffReviewForm
          key={`${analysis.revision}:${workflow.review?.id ?? ""}`}
          item={item}
          analysis={analysis}
          workflow={workflow}
          onInspect={(ev) => {
            setStaffReviewOpen(false);
            inspect(ev);
          }}
        />
      </DialogContent>
    </Dialog>

    <SheetContent aria-describedby={undefined} onCloseAutoFocus={(event) => {
      if (!focusEvidenceOnClose.current) return;
      focusEvidenceOnClose.current = false;
      event.preventDefault();
      focusSource();
    }}>
      <div className="sticky top-0 z-10 flex min-h-12 items-center justify-between border-b bg-card px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="flex items-center gap-2 text-headline-md"><ScanSearch size={16} aria-hidden className="text-tertiary" /> Audit &amp; Compliance</SheetTitle>
          {analysis.rules_version && <Badge variant="secondary">Rules v{analysis.rules_version}</Badge>}
        </div>
        <DialogCloseButton label="Close audit drawer" />
      </div>
      <div className="space-y-gutter p-3">
        <Section title="Validation Rules">
          <nav className="flex flex-wrap gap-1.5 border-b p-2" aria-label="Filter audit checks">
            {auditViews.map((tab) => <Button key={tab} variant={auditView === tab ? "default" : "outline"} size="xs"
              type="button" aria-pressed={auditView === tab} onClick={() => setAuditView(tab)}>
              {tab} <span className="font-mono text-code-badge">{auditCounts[tab]}</span>
            </Button>)}
          </nav>
          <Findings analysis={analysis} names={names} onInspect={inspect} auditFilter={auditView} />
        </Section>
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
            <div className="p-3"><Empty>No activity yet.</Empty></div>
          )}
        </Section>
        <Section title="AI suggestions"><AdvisoryPanel analysis={analysis} /></Section>
      </div>
    </SheetContent>
  </Sheet>;
}

function Trace({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex justify-between gap-3 py-1.5"><dt className="text-muted-foreground">{label}</dt><dd className="break-all text-right font-mono text-code-tabular">{children}</dd></div>;
}
