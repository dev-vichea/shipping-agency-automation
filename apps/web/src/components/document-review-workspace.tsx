"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, FileText, Folder, ScanSearch, Sparkles } from "lucide-react";
import { AssignCompanyForm } from "@/components/company-forms";
import { RefreshButton } from "@/components/forms";
import { DocumentCanvas, type DocumentSourceOption } from "@/components/document-canvas";
import { ConnectorLine } from "@/components/connector-line";
import { IntakeStudioPanel, intakeStatus, type InspectedField } from "@/components/intake-studio-panel";
import { ReviewAuditControls, ReviewCdcMappings, reviewDraft, reviewKey, type ReviewDraft } from "@/components/staff-review";
import type { FieldChoice, FieldEdit, FieldEditor } from "@/components/evidence-field-card";
import { ReprocessDocumentsButton, ReviewActions } from "@/components/review-actions";
import { AdvisoryPanel, Findings, sourceKey } from "@/components/review-evidence";
import { Empty, Section, Status } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { write } from "@/lib/client-api";
import type { CaseActivity, CaseDetail, Company, ConsigneeSourceRef, Evidence, ExtractedField, Finding, MasterVersion, ReviewAnalysis, ReviewField, ReviewIssue, ReviewWorkflow, StaffReview } from "@/lib/contracts";
import { documentFieldLabel, intakeField, invoiceReference, label, location, sourceValue, timestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

type WorkspaceTab = {
  key: string;
  label: string;
  role: "draft_bl" | "final_bl" | "invoice" | "packing_list";
  documentId?: string;
  badge?: string;
  badgeVariant?: "final" | "draft";
  count: number | null;
};

function matchesRole(docRole: string, targetRole: string): boolean {
  if (targetRole === "draft_bl" || targetRole === "final_bl") {
    return docRole === "draft_bl" || docRole === "final_bl";
  }
  return docRole === targetRole;
}

const auditViews = ["All", "Blockers", "Warnings", "Passed"] as const;
const consignmentFields = ["bl_no", "vessel", "consignee", "container", "seal", "origin", "port", "destination"];

export function DocumentReviewWorkspace({ item, analysis, workflow, companies, activity, share, versions, admin }: {
  item: CaseDetail; analysis: ReviewAnalysis; versions: MasterVersion[]; workflow: ReviewWorkflow; companies: Company[]; activity: CaseActivity[]; admin: boolean; share?: ReactNode;
}) {
  const [chosenTabKey, setChosenTabKey] = useState<string>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [selection, setSelection] = useState<Evidence>();
  const [partyPreview, setPartyPreview] = useState<{ source: ConsigneeSourceRef; evidence: Evidence }>();
  const [activeFieldInfo, setActiveFieldInfo] = useState<InspectedField>();
  const [issueSelection, setIssueSelection] = useState<{ key: string; revision: number }>();
  const [auditView, setAuditView] = useState<typeof auditViews[number]>("All");
  const [auditOpen, setAuditOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [selectedValues, setSelectedValues] = useState<Record<string, { value: string; choice?: FieldChoice }>>({});
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [actionError, setActionError] = useState("");
  const [recent, setRecent] = useState<{ revision: number; base: string | null; review: StaffReview }>();
  const remoteId = workflow.review?.id ?? null;
  const saved = recent && recent.revision === analysis.revision && recent.base === remoteId ? recent.review : workflow.review;
  const busy = saving || refreshing;
  const path = `/intakes/${item.id}`;
  const approval = workflow.decisions.find((entry) =>
    entry.scope === "intake" && entry.decision === "approved" && entry.revision === analysis.revision);
  const reviewedFields = new Map(saved?.changes.map(({ edit, after }) => [reviewKey(edit), after]));
  const focusEvidenceOnClose = useRef(false);
  const source = useRef<HTMLDivElement>(null);
  const workspaceGridRef = useRef<HTMLDivElement>(null);
  const processing = analysis.state === "pending" || analysis.ai_state === "pending";
  const reference = invoiceReference(item.detected_reference);
  const master = analysis.analyzed_master ?? analysis.comparison_master;
  const sources = [
    ...item.documents.map((document) => ({
      id: document.id, name: document.original_filename, fileType: document.mime === "application/pdf" ? "PDF" : "Excel",
      url: `/api/v1/documents/${document.id}/download`, received: document.received_at,
      checksum: document.sha256, previousId: document.parent_version_id,
      version_number: document.version_number ?? 1,
      classification: document.classification,
    })),
    ...(master ? [{id: master.source_id, name: master.original_filename, fileType: "CDC" as const,
      url: `/api/v1/cdc/versions/${master.id}/download`, received: null, checksum: null, previousId: null,
      version_number: undefined, classification: undefined}] : []),
  ];
  const names = new Map(sources.map(({id, name}) => [id, name]));
  const extractionSources = analysis.extractions.flatMap((entry) => [entry, ...(entry.sections ?? [])]);
  const excerpts = extractionSources.map((extraction, index) => ({
    key: `${extraction.document_id}:${extraction.sheet ?? ""}:${index}:${extraction.role}`, id: extraction.document_id,
    title: label(extraction.role), sheet: extraction.sheet,
    lines: extraction.source_excerpt,
  }));
  const options = sources.flatMap((file) => {
    const matches = excerpts.filter((excerpt) => excerpt.id === file.id);
    return matches.length ? matches : [{key: file.id, id: file.id, title: file.name, sheet: null, lines: []}];
  });

  const transportDocs = item.documents
    .filter((doc) => doc.classification === "draft_bl" || doc.classification === "final_bl")
    .sort((a, b) => {
      if (a.classification === "final_bl" && b.classification !== "final_bl") return -1;
      if (b.classification === "final_bl" && a.classification !== "final_bl") return 1;
      return (b.version_number ?? 1) - (a.version_number ?? 1);
    });

  const transportExtractions = analysis.extractions.filter(
    (e) => e.role === "draft_bl" || e.role === "final_bl"
  );

  const tabs: WorkspaceTab[] = [];

  if (transportDocs.length > 0) {
    if (transportDocs.length === 1) {
      const doc = transportDocs[0];
      const ext = analysis.extractions.find((e) => e.document_id === doc.id)
        ?? analysis.extractions.find((e) => e.role === doc.classification);
      const isFinal = doc.classification === "final_bl" || ext?.role === "final_bl";
      const count = ext ? (ext.items?.length || Object.values(ext.fields).filter((f) => f?.value).length) : null;
      tabs.push({
        key: `transport:${doc.id}`,
        label: "B/L",
        role: isFinal ? "final_bl" : "draft_bl",
        documentId: doc.id,
        badge: isFinal ? "FINAL" : (doc.version_number ?? 1) > 1 ? `v${doc.version_number}` : undefined,
        badgeVariant: isFinal ? "final" : "draft",
        count,
      });
    } else {
      for (const doc of transportDocs) {
        const ext = analysis.extractions.find((e) => e.document_id === doc.id);
        const isFinal = doc.classification === "final_bl" || ext?.role === "final_bl";
        const count = ext ? (ext.items?.length || Object.values(ext.fields).filter((f) => f?.value).length) : null;
        tabs.push({
          key: `transport:${doc.id}`,
          label: "B/L",
          role: isFinal ? "final_bl" : "draft_bl",
          documentId: doc.id,
          badge: isFinal ? "FINAL" : "DRAFT",
          badgeVariant: isFinal ? "final" : "draft",
          count,
        });
      }
    }
  } else if (transportExtractions.length > 0) {
    for (const ext of transportExtractions) {
      const isFinal = ext.role === "final_bl";
      const count = ext.items?.length || Object.values(ext.fields).filter((f) => f?.value).length;
      tabs.push({
        key: `transport:${ext.document_id}`,
        label: "B/L",
        role: isFinal ? "final_bl" : "draft_bl",
        documentId: ext.document_id,
        badge: isFinal ? "FINAL" : "DRAFT",
        badgeVariant: isFinal ? "final" : "draft",
        count,
      });
    }
  } else {
    tabs.push({
      key: "transport:default",
      label: "B/L",
      role: "draft_bl",
      count: null,
    });
  }

  // Invoice tab
  const invoiceExt = analysis.extractions.find((e) => e.role === "invoice");
  const invoiceDoc = item.documents.find((d) => d.classification === "invoice");
  const invoiceCount = invoiceExt ? (invoiceExt.items?.length || Object.values(invoiceExt.fields).filter((f) => f?.value).length) : null;
  tabs.push({
    key: "invoice",
    label: "Invoice",
    role: "invoice",
    documentId: invoiceExt?.document_id ?? invoiceDoc?.id,
    count: invoiceCount,
  });

  // Packing list tab
  const packingExt = analysis.extractions.find((e) => e.role === "packing_list");
  const packingDoc = item.documents.find((d) => d.classification === "packing_list");
  const packingCount = packingExt ? (packingExt.items?.length || Object.values(packingExt.fields).filter((f) => f?.value).length) : null;
  tabs.push({
    key: "packing_list",
    label: "Packing list",
    role: "packing_list",
    documentId: packingExt?.document_id ?? packingDoc?.id,
    count: packingCount,
  });

  const fallbackTab = tabs.find((t) => t.documentId && selectedKey?.startsWith(t.documentId))
    ?? tabs.find((t) => t.role && selectedKey?.endsWith(`:${t.role}`))
    ?? tabs[0];
  const activeTab: WorkspaceTab = (chosenTabKey ? tabs.find((t) => t.key === chosenTabKey) : undefined) ?? fallbackTab ?? tabs[0];
  const activeRole = activeTab.role;

  const classifiedSources = item.documents.filter((doc) =>
    activeRole === "draft_bl" || activeRole === "final_bl"
      ? (doc.classification === "draft_bl" || doc.classification === "final_bl")
      : doc.classification === activeRole
  );
  const compatibleSources = sources.filter((doc) =>
    doc.fileType === (activeRole === "draft_bl" || activeRole === "final_bl" ? "PDF" : "Excel")
  );
  const fallbackSource = classifiedSources.length === 1 ? classifiedSources[0].id
    : compatibleSources.length === 1 ? compatibleSources[0].id : undefined;

  const targetOption = activeTab.documentId
    ? options.find((opt) => opt.id === activeTab.documentId && (!activeTab.role || opt.key.endsWith(`:${activeTab.role}`)))
      ?? options.find((opt) => opt.id === activeTab.documentId)
    : options.find((opt) => opt.key.endsWith(`:${activeTab.role}`));

  const previewOption = partyPreview && options.find((option) => option.id === partyPreview.source.document_id &&
    (option.key.endsWith(`:${partyPreview.source.role}`) || (matchesRole(partyPreview.source.role, "draft_bl") && matchesRole(option.key.split(":").pop() ?? "", "draft_bl"))) && option.sheet === partyPreview.evidence.sheet);
  const current = previewOption ?? options.find((option) => option.key === selectedKey)
    ?? targetOption
    ?? options.find((option) => option.id === fallbackSource)
    ?? options[0];

  const activeDocument = (activeTab.documentId
      ? extractionSources.find((doc) => doc.document_id === activeTab.documentId && (doc.role === activeTab.role || matchesRole(doc.role, activeTab.role)))
      : undefined
    )
    ?? extractionSources.find((doc, index) => excerpts[index].key === current?.key)
    ?? extractionSources.find((doc) => doc.document_id === current?.id && matchesRole(doc.role, activeRole))
    ?? extractionSources.find((doc) => doc.document_id === current?.id)
    ?? extractionSources.find((doc) => doc.role === activeRole)
    ?? extractionSources.find((doc) => matchesRole(doc.role, activeRole));

  const file = sources.find((entry) => entry.id === current?.id);
  const citation = partyPreview?.evidence ?? selection;
  const selectedEvidence = citation?.document_id === file?.id ? citation : undefined;
  const tally: Record<Finding["outcome"], number> = { PASS: 0, WARNING: 0, MISMATCH: 0, NEEDS_REVIEW: 0 };
  for (const finding of analysis.findings) tally[finding.outcome] += 1;
  const issueCount = saved?.open_issues ? Object.keys(saved.open_issues).length : tally.MISMATCH + tally.WARNING + tally.NEEDS_REVIEW;
  const auditCounts = { All: analysis.findings.length, Blockers: tally.MISMATCH, Warnings: tally.WARNING + tally.NEEDS_REVIEW, Passed: tally.PASS };
  const stale = analysis.analysis_revision !== null && analysis.analysis_revision !== analysis.revision;
  const editable = !stale && analysis.state === "available" && ["needs_review", "ready_for_approval"].includes(item.state);
  const knownIssueKeys = saved?.reviewed_issue_keys && new Set(saved.reviewed_issue_keys);
  const pendingIssues = stale ? [] : (workflow.issues ?? []).map((issue, index) => ({ issue, index })).filter(({ issue }) =>
    !saved?.open_issues || issue.key in saved.open_issues || (knownIssueKeys && !knownIssueKeys.has(issue.key)));
  const issueAnchor = issueSelection?.revision === analysis.revision
    ? workflow.issues?.findIndex((issue) => issue.key === issueSelection.key) ?? -1 : -1;
  const issuePosition = pendingIssues.findIndex(({ index }) => index === issueAnchor);
  const currentIssue = pendingIssues[issuePosition]?.issue;
  const previousIssue = pendingIssues.findLast(({ index }) => index < issueAnchor)?.issue;
  const nextIssue = pendingIssues.find(({ index }) => index > issueAnchor)?.issue;
  const candidates = Array.from(new Map(
    [...(saved?.candidates ?? []), ...(analysis.analyzed_master ? analysis.candidates : [])]
      .map((entry) => [`${entry.invoice_document_id}:${entry.invoice_row}:${entry.master_row}`, entry]),
  ).values());
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

  function handleSelectTab(tab: WorkspaceTab) {
    setChosenTabKey(tab.key);
    setPartyPreview(undefined);
    setIssueSelection(undefined);
    setSelection(undefined);
    setActiveFieldInfo(undefined);

    const match = (tab.documentId
      ? options.find((opt) => opt.id === tab.documentId && (!tab.role || opt.key.endsWith(`:${tab.role}`)))
        ?? options.find((opt) => opt.id === tab.documentId)
      : undefined
    ) ?? options.find((opt) => opt.key.endsWith(`:${tab.role}`));

    if (match) {
      setSelectedKey(match.key);
    }
  }

  function chooseSource(key?: string) {
    setPartyPreview(undefined);
    setIssueSelection(undefined);
    setSelectedKey(key);
    setSelection(undefined);
    setActiveFieldInfo(undefined);
    const opt = options.find((o) => o.key === key);
    if (opt) {
      const matchingTab = tabs.find((t) =>
        (t.documentId && t.documentId === opt.id && key?.endsWith(`:${t.role}`)) ||
        (t.documentId && t.documentId === opt.id) ||
        (key && key.endsWith(`:${t.role}`))
      );
      if (matchingTab) {
        setChosenTabKey(matchingTab.key);
      }
    }
  }



  function inspect(evidence?: Evidence, meta?: InspectedField) {
    const documentId = evidence?.document_id ?? meta?.target?.document_id;
    const role = meta?.target?.role;
    const match = options.find((option) => option.id === documentId && option.sheet === evidence?.sheet &&
      (!role || option.key.endsWith(`:${role}`)))
      ?? options.find((option) => option.id === documentId && (!role || option.key.endsWith(`:${role}`)))
      ?? options.find((option) => option.id === documentId);
    setPartyPreview(undefined);
    setIssueSelection(undefined);
    if (match) {
      setSelectedKey(match.key);
      const matchingTab = tabs.find((entry) =>
        (entry.documentId && entry.documentId === documentId && (!role || entry.role === role)) ||
        (role && entry.role === role) ||
        (entry.documentId && entry.documentId === documentId)
      );
      if (matchingTab) setChosenTabKey(matchingTab.key);
    }
    setSelection(evidence ? { ...evidence } : undefined);

    if (meta) {
      setActiveFieldInfo(meta);
    } else if (evidence) {
      let found: InspectedField | undefined;
      const citation = sourceKey(evidence);
      for (const ext of extractionSources) {
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

  function displayedField(target: ReviewField, field: ExtractedField): ExtractedField {
    const translated = target.name === "description" && target.row
      ? reviewedFields.get(reviewKey({ ...target, name: "english_description" })) : undefined;
    const reviewed = reviewedFields.get(reviewKey(target));
    return translated ? { ...translated, english: null } : reviewed ?? field;
  }

  function isReviewed(target: ReviewField) {
    return reviewedFields.has(reviewKey(target)) || (target.name === "description" && !!target.row &&
      reviewedFields.has(reviewKey({ ...target, name: "english_description" })));
  }

  function showIssue(issue: ReviewIssue) {
    const target = issue.target ?? undefined;
    const doc = target && analysis.extractions.find((entry) => entry.document_id === target.document_id && entry.role === target.role);
    const key = target?.row && target.name === "english_description" ? "description" : target?.name;
    const values = target?.row ? doc?.items.find(({ row }) => row === target.row)?.fields : doc?.fields;
    const raw = key ? values?.[key] : undefined;
    const field = target && key && raw ? displayedField({ ...target, name: key }, raw) : undefined;
    const text = intakeField(field);
    const evidence = issue.suggestion?.evidence[0] ?? text.evidence ?? issue.evidence.find((cite) =>
      !target || (cite.document_id === target.document_id && (!doc?.sheet || cite.sheet === doc.sheet)));
    const meta: InspectedField = {
      id: key ? target?.row ? `item:${target.row}:${key}` : `field:${key}` : undefined,
      name: documentFieldLabel(key ?? issue.name),
      value: field?.value ? text.value : issue.value ?? issue.message,
      target,
      uncertain: true,
    };
    if (evidence || target) {
      inspect(evidence, meta);
    } else {
      const matchingTab = tabs.find((entry) => entry.role === issue.name);
      if (matchingTab) handleSelectTab(matchingTab);
      setSelection(undefined);
      setPartyPreview(undefined);
      setActiveFieldInfo(meta);
      focusSource();
    }
    setIssueSelection({ key: issue.key, revision: analysis.revision });
  }

  async function updateReview<T>(action: () => Promise<T>) {
    if (busy) throw new Error("A review update is already saving.");
    setSaving(true);
    try {
      const result = await action();
      startRefresh(() => router.refresh());
      return result;
    } finally {
      setSaving(false);
    }
  }

  async function saveReview(next: ReviewDraft): Promise<StaffReview> {
    const revision = analysis.revision;
    const review = await updateReview(() => write<StaffReview>(`${path}/review`, {
      expected_revision: revision, expected_review_id: saved?.id ?? null, ...next,
    }));
    setRecent({ revision, base: remoteId, review });
    return review;
  }

  function getDetectedOptions(name: string, row: number | null, issue?: ReviewIssue): { value: string; label: string; choice?: FieldChoice }[] {
    const rawOptions: { value: string; label: string; choice?: FieldChoice }[] = [];

    const add = (val: string | null | undefined, lbl: string, choice?: FieldChoice) => {
      if (!val) return;
      const trimmed = val.trim();
      if (!trimmed) return;
      rawOptions.push({ value: trimmed, label: lbl, choice });
    };

    if (name === "consignee" && workflow.consignee_options?.length) {
      const partyRoles: Record<string, string> = { draft_bl: "B/L", invoice: "Invoice", packing_list: "Packing list" };
      for (const opt of workflow.consignee_options) {
        const roles = [...new Set(opt.sources.map((s) => partyRoles[s.ref.role] || s.ref.role))].join(" / ");
        add(opt.value, roles);
      }
    }

    if (issue?.target) {
      const ed = editorFor(issue.target, true);
      if (ed?.choices) {
        for (const c of ed.choices) {
          add(c.value, c.label, c);
        }
      }
    }

    for (const doc of analysis.extractions) {
      const roleLabel = doc.role === "draft_bl" ? "B/L" : doc.role === "invoice" ? "Invoice" : doc.role === "packing_list" ? "Packing list" : "Document";

      if (row === null || row === 0) {
        const fld = doc.fields[name];
        if (fld?.value) {
          add(fld.value, roleLabel);
        }
        if (fld?.alternatives) {
          for (const alt of fld.alternatives) {
            if (alt.value) add(alt.value, `${roleLabel} (Alt)`);
          }
        }
      }

      for (const itm of doc.items ?? []) {
        if (row === null || itm.row === row) {
          const itmFld = itm.fields[name];
          if (itmFld?.value) {
            add(itmFld.value, `${roleLabel}${row ? ` (Row ${itm.row})` : ""}`);
          }

          if (name === "description" || name === "english_description") {
            const desc = itm.fields["description"];
            if (desc?.value) add(desc.value, `${roleLabel}${row ? ` (Row ${itm.row})` : ""}`);
            if (desc?.english?.value) add(desc.english.value, "AI Translation");
          }
        }
      }

      if (row !== null && name === "packages") {
        const headerFld = doc.fields["packages"];
        if (headerFld?.value) {
          add(headerFld.value, `${roleLabel} (Shipment Total)`);
        }
      }
    }

    if (issue?.suggestion?.value) {
      add(issue.suggestion.value, "AI Suggestion");
    }
    if (issue?.comparison) {
      if (issue.comparison[0]) add(issue.comparison[0], "B/L");
      if (issue.comparison[1]) add(issue.comparison[1], "Invoice / Packing list");
    }
    if (issue) {
      const finding = analysis.findings.find((f) => f.key === issue.key);
      if (finding?.left) {
        const leftDoc = finding.group === "transport" ? "B/L" : finding.group === "invoice_packing" ? "Invoice" : "Source 1";
        add(finding.left, leftDoc);
      }
      if (finding?.right) {
        const rightDoc = finding.group === "transport" ? "Invoice / Packing list" : finding.group === "invoice_packing" ? "Packing list" : "Source 2";
        add(finding.right, rightDoc);
      }
    }

    if (issue?.value) {
      add(issue.value, "Detected in source");
    }

    if (name === "currency_uniformity" || name === "currency") {
      const currencies = new Set<string>();
      for (const doc of analysis.extractions) {
        for (const fld of Object.values(doc.fields)) {
          if (fld?.currency) currencies.add(fld.currency);
        }
        for (const itm of doc.items ?? []) {
          for (const fld of Object.values(itm.fields)) {
            if (fld?.currency) currencies.add(fld.currency);
          }
        }
      }
      if (currencies.size > 0) {
        add(Array.from(currencies).join(", "), "Detected Currency");
      }
    }

    if (name === "version" || name.startsWith("cdc")) {
      for (const ver of versions ?? []) {
        const title = `${ver.approval_ref || ver.original_filename} (${ver.year || "Master List"})`;
        add(title, "Registered Master List");
      }
    }

    const deduplicated: { value: string; label: string; choice?: FieldChoice }[] = [];
    const byValue = new Map<string, { value: string; labels: string[]; choice?: FieldChoice }>();

    for (const opt of rawOptions) {
      const existing = byValue.get(opt.value);
      if (existing) {
        if (!existing.labels.includes(opt.label)) {
          existing.labels.push(opt.label);
        }
        if (!existing.choice && opt.choice) {
          existing.choice = opt.choice;
        }
      } else {
        byValue.set(opt.value, { value: opt.value, labels: [opt.label], choice: opt.choice });
      }
    }

    for (const entry of byValue.values()) {
      deduplicated.push({
        value: entry.value,
        label: entry.labels.join(" / "),
        choice: entry.choice,
      });
    }

    return deduplicated;
  }

  async function handleConfirmGroup(
    group: { id: string; name: string; row: number | null; issues: ReviewIssue[] },
    chosenValue?: string,
    chosenChoice?: FieldChoice
  ) {
    const baseDraft = reviewDraft(saved);
    const nextDraft: ReviewDraft = {
      ...baseDraft,
      issue_actions: [...baseDraft.issue_actions],
      resolutions: [...baseDraft.resolutions],
      corrections: [...baseDraft.corrections],
    };

    for (const issue of group.issues) {
      if (issue.target && chosenValue !== undefined) {
        const target = issue.target;
        const doc = analysis.extractions.find((entry) => entry.document_id === target.document_id && entry.role === target.role);
        const values = target.row ? doc?.items.find((entry) => entry.row === target.row)?.fields : doc?.fields;
        const source = values?.[target.name];

        nextDraft.corrections = nextDraft.corrections.filter(
          (c) => !(c.document_id === target.document_id && c.role === target.role && c.row === target.row && c.name === target.name)
        );

        if (chosenChoice?.issueKey) {
          nextDraft.issue_actions = nextDraft.issue_actions.filter((a) => a.key !== chosenChoice.issueKey);
          nextDraft.issue_actions.push({ key: chosenChoice.issueKey, action: "accept_ai" });
        } else {
          nextDraft.corrections.push({
            ...target,
            value: chosenValue,
            unit: chosenChoice?.unit ?? source?.unit ?? null,
            currency: chosenChoice?.currency ?? source?.currency ?? null,
            note: chosenChoice?.consigneeSource ? "Selected a printed consignee from this shipment." :
              chosenChoice?.alternativeIndex !== undefined ? "Selected a value from the original document evidence." :
              source && chosenValue === source.value ? "Confirmed against original document evidence." : "Confirmed in review dialog.",
            alternative_index: chosenChoice?.alternativeIndex,
            consignee_source: chosenChoice?.consigneeSource,
          });
        }
      }

      const actionType = issue.can_confirm ? "confirm" : issue.suggestion ? "accept_ai" : undefined;
      if (actionType) {
        nextDraft.issue_actions = nextDraft.issue_actions.filter((a) => a.key !== issue.key);
        nextDraft.issue_actions.push({ key: issue.key, action: actionType });
      }

      const isResolvable = issue.can_resolve ||
        issue.key.startsWith("transport.") ||
        issue.key.startsWith("invoice_packing.") ||
        analysis.findings.some((f) => f.key === issue.key && (f.group === "transport" || f.group === "invoice_packing" || f.field === "description"));

      if (isResolvable) {
        nextDraft.resolutions = nextDraft.resolutions.filter((r) => r.key !== issue.key);
        nextDraft.resolutions.push({ key: issue.key, note: "Confirmed against document evidence." });
      }
    }

    return await saveReview(nextDraft);
  }



  function cleanFieldLabel(name: string): string {
    if (name === "unit") return "Unit of Measure";
    if (name === "packages") return "Total Packages";
    if (name === "description") return "Goods Description";
    if (name === "english_description") return "English Description";
    if (name === "currency_uniformity") return "Currency Uniformity";
    if (name === "version" || name.startsWith("cdc")) return "CDC Master List";
    return documentFieldLabel(name);
  }

  const { treeBranches, groupedIssues } = (() => {
    const map = new Map<string, { id: string; name: string; row: number | null; label: string; issues: ReviewIssue[] }>();

    for (const { issue } of pendingIssues) {
      const targetName = issue.target?.name ?? issue.name;
      const targetRow = issue.target?.row ?? (issue.key.match(/\.(\d+)\.?/) ? parseInt(RegExp.$1, 10) : null);
      const groupId = targetRow ? `${targetName}:${targetRow}` : targetName;

      const existing = map.get(groupId);
      if (existing) {
        existing.issues.push(issue);
      } else {
        const cleanLabel = cleanFieldLabel(targetName);
        map.set(groupId, {
          id: groupId,
          name: targetName,
          row: targetRow,
          label: cleanLabel,
          issues: [issue],
        });
      }
    }

    const allItems = Array.from(map.values());

    const shipmentItems: typeof allItems = [];
    const lineItemMap = new Map<number, typeof allItems>();
    const complianceItems: typeof allItems = [];

    for (const item of allItems) {
      if (item.row !== null) {
        const list = lineItemMap.get(item.row) ?? [];
        list.push(item);
        lineItemMap.set(item.row, list);
      } else if (
        ["currency_uniformity", "currency", "version"].includes(item.name) ||
        item.name.startsWith("cdc")
      ) {
        complianceItems.push(item);
      } else {
        shipmentItems.push(item);
      }
    }

    const branches: {
      id: string;
      title: string;
      items?: typeof allItems;
      rowGroups?: { row: number; description: string; items: typeof allItems }[];
      count: number;
    }[] = [];

    if (shipmentItems.length > 0) {
      branches.push({
        id: "shipment",
        title: "Shipment & Consignment",
        items: shipmentItems,
        count: shipmentItems.length,
      });
    }

    if (lineItemMap.size > 0) {
      const rowGroups: { row: number; description: string; items: typeof allItems }[] = [];
      let lineCount = 0;
      const sortedRows = Array.from(lineItemMap.keys()).sort((a, b) => a - b);
      for (const row of sortedRows) {
        const items = lineItemMap.get(row)!;
        lineCount += items.length;
        let desc = "";
        for (const doc of analysis.extractions) {
          const matchedItem = doc.items?.find((i) => i.row === row);
          if (matchedItem) {
            desc = matchedItem.fields["description"]?.value || matchedItem.fields["english_description"]?.value || "";
            if (desc) break;
          }
        }
        rowGroups.push({
          row,
          description: desc,
          items,
        });
      }

      branches.push({
        id: "line_items",
        title: "Line Items",
        rowGroups,
        count: lineCount,
      });
    }

    if (complianceItems.length > 0) {
      branches.push({
        id: "compliance",
        title: "Compliance & Master List",
        items: complianceItems,
        count: complianceItems.length,
      });
    }

    return { treeBranches: branches, groupedIssues: allItems };
  })();

  async function handleVerifyAll(): Promise<StaffReview> {
    const actionsToTake: { key: string; action: "confirm" | "accept_ai" }[] = [];
    const pendingResolutions: { key: string; note: string }[] = [];

    for (const { issue } of pendingIssues) {
      if (issue.can_confirm) {
        actionsToTake.push({ key: issue.key, action: "confirm" });
      } else if (issue.suggestion) {
        actionsToTake.push({ key: issue.key, action: "accept_ai" });
      }

      if (
        issue.can_resolve ||
        issue.key.startsWith("transport.") ||
        issue.key.startsWith("invoice_packing.description.")
      ) {
        pendingResolutions.push({
          key: issue.key,
          note: "Confirmed against document evidence.",
        });
      }
    }

    for (const finding of analysis.findings) {
      if (
        finding.outcome === "NEEDS_REVIEW" &&
        (finding.group === "transport" ||
          (finding.group === "invoice_packing" &&
            finding.field === "description" &&
            !finding.key.includes(".unpaired.")))
      ) {
        pendingResolutions.push({
          key: finding.key,
          note: "Verified against document evidence.",
        });
      }
    }

    const currentMappings = saved?.mappings ?? [];
    let nextMappings = currentMappings;
    if (currentMappings.length === 0 && candidates.length > 0) {
      const topByRow = new Map<number, typeof candidates[0]>();
      for (const cand of candidates) {
        if (cand.score >= 60) {
          const prev = topByRow.get(cand.invoice_row);
          if (!prev || cand.score > prev.score) {
            topByRow.set(cand.invoice_row, cand);
          }
        }
      }
      nextMappings = Array.from(topByRow.values()).map((c) => ({
        invoice_row: c.invoice_row,
        master_row: c.master_row,
      }));
    }

    const baseDraft = reviewDraft(saved);
    const existingActionKeys = new Set(baseDraft.issue_actions.map((a) => a.key));
    const newActions = actionsToTake.filter((a) => !existingActionKeys.has(a.key));

    const existingResKeys = new Set(baseDraft.resolutions.map((r) => r.key));
    const newResolutions = pendingResolutions.filter((r) => !existingResKeys.has(r.key));

    const nextDraft: ReviewDraft = {
      ...baseDraft,
      issue_actions: [...baseDraft.issue_actions, ...newActions],
      resolutions: [...baseDraft.resolutions, ...newResolutions],
      mappings: nextMappings,
      verify_cdc_mappings: nextMappings.length > 0,
      corrections: [...baseDraft.corrections],
    };

    for (const [key, selection] of Object.entries(selectedValues)) {
      const match = pendingIssues.find((p) => p.issue.key === key)?.issue ??
        groupedIssues.find((g) => g.id === key)?.issues.find((i) => i.target);
      if (match?.target) {
        const target = match.target;
        const doc = analysis.extractions.find((entry) => entry.document_id === target.document_id && entry.role === target.role);
        const values = target.row ? doc?.items.find((entry) => entry.row === target.row)?.fields : doc?.fields;
        const source = values?.[target.name];

        nextDraft.corrections = nextDraft.corrections.filter(
          (c) => !(c.document_id === target.document_id && c.role === target.role && c.row === target.row && c.name === target.name)
        );

        if (selection.choice?.issueKey) {
          nextDraft.issue_actions = nextDraft.issue_actions.filter((a) => a.key !== selection.choice?.issueKey);
          nextDraft.issue_actions.push({ key: selection.choice.issueKey, action: "accept_ai" });
        } else {
          nextDraft.corrections.push({
            ...target,
            value: selection.value,
            unit: selection.choice?.unit ?? source?.unit ?? null,
            currency: selection.choice?.currency ?? source?.currency ?? null,
            note: "Confirmed in review dialog.",
            alternative_index: selection.choice?.alternativeIndex,
            consignee_source: selection.choice?.consigneeSource,
          });
        }
      }
    }

    return await saveReview(nextDraft);
  }

  function clearField(review: ReviewDraft, refs: ReviewField[]) {
    const keys = new Set(refs.map(reviewKey));
    const affectsCdc = refs.some((ref) => ref.row || (ref.role === "invoice" && ref.name === "consignee"));
    return {
      ...review,
      corrections: review.corrections.filter((entry) => !keys.has(reviewKey(entry))),
      issue_actions: review.issue_actions.filter((entry) => !keys.has(entry.key) &&
        !workflow.issues?.some((issue) => issue.key === entry.key && issue.target && keys.has(reviewKey(issue.target)))),
      ...(affectsCdc && { mappings: [], verify_cdc_mappings: false }),
    };
  }

  function editorFor(target?: ReviewField, needsReview?: boolean): FieldEditor | undefined {
    if (!target || !editable) return;
    const doc = analysis.extractions.find((entry) => entry.document_id === target.document_id && entry.role === target.role);
    const values = target.row ? doc?.items.find((entry) => entry.row === target.row)?.fields : doc?.fields;
    const original = values?.[target.name];
    if (!original || !values) return;
    const englishRef = { ...target, name: "english_description" };
    const englishItem = target.name === "description" && target.row && values.english_description &&
      (reviewedFields.has(reviewKey(englishRef)) || original.english?.status === "proposed" ||
        (!!original.english?.value && original.english.value !== original.value) ||
        original.source_languages?.some((language) => ["zh", "km", "und"].includes(language)));
    const currentRef = englishItem ? englishRef : target;
    const source = values[currentRef.name];
    const currentField = reviewedFields.get(reviewKey(currentRef)) ?? source;
    const aiIssue = workflow.issues?.find((issue) => issue.suggestion && issue.target &&
      reviewKey(issue.target) === reviewKey(currentRef));
    const shipmentParties = currentRef.name === "consignee" && currentRef.role !== "draft_bl" ? workflow.consignee_options ?? [] : [];
    const partyOptions = needsReview || !source.value || shipmentParties.length > 1 ? shipmentParties : [];
    const printedHere = partyOptions.find((option) => option.sources.some(({ ref }) =>
      ref.document_id === currentRef.document_id && ref.role === currentRef.role && ref.alternative_index === null));
    const partyRoles: Record<string, string> = { draft_bl: "B/L", final_bl: "B/L", invoice: "Invoice", packing_list: "Packing list" };
    const options: FieldChoice[] = (printedHere ? [printedHere, ...partyOptions.filter((option) => option !== printedHere)] : partyOptions)
      .slice(0, 3).flatMap((option, index) => {
        const printed = option.sources.find(({ ref }) =>
          ref.document_id === currentRef.document_id && ref.role === currentRef.role && ref.alternative_index === null) ?? option.sources[0];
        const evidence = printed.evidence[0];
        if (!evidence) return [];
        const roles = [...new Set(option.sources.map(({ ref }) => partyRoles[ref.role]))];
        return [{
          id: `consignee:${index}`,
          label: `${roles.join(" / ")} · ${location(evidence)}${option.sources.every((entry) => entry.status === "uncertain") ? " · Uncertain" : ""}`,
          value: printed.value, evidence, unit: null, currency: null, consigneeSource: printed.ref,
        }];
      });
    if (aiIssue?.suggestion?.value && aiIssue.suggestion.evidence[0]) {
      options.push({ id: "ai", label: "AI suggestion", value: aiIssue.suggestion.value,
        unit: null, currency: null, evidence: aiIssue.suggestion.evidence[0], issueKey: aiIssue.key });
    }
    if (!partyOptions.length && needsReview && source.value && source.evidence[0]) {
      options.push({ id: "original", label: "Original extraction", value: source.value,
        unit: source.unit, currency: source.currency, evidence: source.evidence[0] });
    }
    if (!partyOptions.length) source.alternatives?.forEach((choice, index) => {
      if (!choice.evidence[0]) return;
      options.push({ ...choice, id: `source:${index}`, label: "From document",
        evidence: choice.evidence[0], alternativeIndex: index });
    });
    const dimension = ["amount", "unit_price"].includes(currentRef.name) ? "currency"
      : ["quantity", "packages", "gross_weight", "net_weight", "measurement"].includes(currentRef.name) ? "unit" : undefined;

    async function onSave(edit: FieldEdit) {
      const next = clearField(reviewDraft(saved), [currentRef]);
      if (edit.choice?.issueKey) {
        next.issue_actions.push({ key: edit.choice.issueKey, action: "accept_ai" });
      } else {
        next.corrections.push({
          ...currentRef, value: edit.value, unit: edit.unit, currency: edit.currency,
          note: edit.choice?.consigneeSource ? "Selected a printed consignee from this shipment." :
            edit.choice?.alternativeIndex !== undefined ? "Selected a value from the original document evidence." :
            edit.value === source.value && edit.unit === source.unit && edit.currency === source.currency
              ? "Confirmed against original document evidence." : "Edited in the document review card.",
          alternative_index: edit.choice?.alternativeIndex,
          consignee_source: edit.choice?.consigneeSource,
        });
      }
      await saveReview(next);
    }

    return {
      value: currentField.english?.status === "staff_verified" ? currentField.english.value ?? "" : currentField.value ?? "",
      unit: currentField.unit, currency: currentField.currency, dimension,
      multiline: ["description", "english_description", "cargo_summary", "shipper", "supplier", "consignee", "notify_party"].includes(target.name),
      reviewed: isReviewed(target), busy, choices: options, onSave,
      onPreview: (choice) => {
        setPartyPreview(choice?.consigneeSource ? { source: choice.consigneeSource, evidence: choice.evidence } : undefined);
        if (choice && !choice.consigneeSource) setSelection({ ...choice.evidence });
      },
      onUndo: async () => {
        await saveReview(clearField(reviewDraft(saved), englishItem ? [target, englishRef] : [target]));
      },
    };
  }

  async function decide(kind: "approve" | "reject" | "processed", notes = "Approved after staff review.", reviewId?: string | null) {
    await updateReview(() => write(`${path}/${kind}`, kind === "processed"
      ? { expected_revision: analysis.revision, approval_id: approval?.id }
      : { expected_revision: analysis.revision, review_id: reviewId !== undefined ? reviewId : (saved?.id ?? null), notes }));
  }

  async function handleApprove() {
    setActionError("");
    try {
      let currentReview = saved;
      if (!currentReview?.ready) {
        currentReview = await handleVerifyAll();
      }
      if (currentReview && !currentReview.ready) {
        const payload = currentReview as unknown as { blockers?: string[] };
        const blockers = payload.blockers;
        if (blockers && blockers.length > 0) {
          setActionError(`Cannot approve: ${blockers.join(" · ")}`);
          return;
        }
      }
      await decide("approve", "Approved after staff review.", currentReview?.id ?? null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to approve review.");
    }
  }

  const hasFinalBL = Boolean(
    analysis.version_diff?.is_final_bl ||
    item.documents.some((d) => d.classification === "final_bl")
  );
  const requiresFinalConfirmation = Boolean(
    analysis.version_diff?.requires_final_confirmation ||
    (hasFinalBL && item.state !== "approved")
  );

  async function handleConfirmFinalBL() {
    setActionError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/intakes/${item.id}/confirm-final-bl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail || "Failed to confirm Final B/L");
      }
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

  const editor = editorFor(activeFieldInfo?.target, activeFieldInfo?.uncertain);

  function renderTreeItem(item: { id: string; name: string; row: number | null; label: string; issues: ReviewIssue[] }) {
    const options = getDetectedOptions(item.name, item.row, item.issues[0]);
    const selected = selectedValues[item.id];
    const currentVal = selected?.value ?? options[0]?.value ?? "";
    const currentChoice = selected?.choice ?? options.find((o) => o.value === currentVal)?.choice;
    const currentOption = options.find((o) => o.value === currentVal) ?? options[0];

    return (
      <div key={item.id} className="relative flex items-center justify-between gap-3 py-1 text-xs">
        {/* Branch elbow connector */}
        <span className="pointer-events-none absolute -left-4 top-1/2 w-4 border-t border-dashed border-border/80" aria-hidden="true" />

        {/* Leaf icon + Clean label */}
        <div className="flex items-center gap-1.5 w-36 sm:w-44 shrink-0">
          <FileText size={13} className="text-amber-600/70 shrink-0" />
          <span className="text-xs font-medium text-foreground truncate block" title={item.label}>
            {item.label}
          </span>
        </div>

        {/* Detected value / Dropdown */}
        <div className="min-w-0 flex-1">
          {options.length > 1 ? (
            <Select
              value={currentVal}
              onValueChange={(val) => {
                const opt = options.find((o) => o.value === val);
                setSelectedValues((prev) => ({ ...prev, [item.id]: { value: val, choice: opt?.choice } }));
              }}
            >
              <SelectTrigger className="h-7 w-full max-w-md px-2.5 py-0 text-xs justify-between rounded border border-border/70 bg-background hover:bg-muted/40 text-foreground font-normal">
                <span className="truncate font-mono text-xs">
                  {currentVal}
                  {currentOption?.label && (
                    <span className="text-[10px] text-muted-foreground ml-1.5 font-sans">
                      ({currentOption.label})
                    </span>
                  )}
                </span>
              </SelectTrigger>
              <SelectContent>
                {options.map((opt, i) => (
                  <SelectItem key={`${opt.value}-${i}`} value={opt.value} className="text-xs">
                    <div className="flex flex-col py-0.5 max-w-sm sm:max-w-md">
                      <span className="font-mono text-xs font-medium truncate">{opt.value}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : options.length === 1 ? (
            <div className="flex items-center h-7 px-2.5 text-xs text-foreground font-mono truncate" title={currentVal}>
              <span>{currentVal}</span>
              {currentOption?.label && (
                <span className="text-[10px] text-muted-foreground ml-1.5 font-sans">
                  ({currentOption.label})
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center h-7 px-2.5 text-xs text-muted-foreground italic truncate">
              Not detected in documents
            </div>
          )}
        </div>

        {/* Action button */}
        <div className="shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void handleConfirmGroup(item, currentVal, currentChoice)}
            className="h-7 px-2.5 text-xs font-medium border-emerald-600/30 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-400"
          >
            <Check size={12} className="mr-1" /> Confirm
          </Button>
        </div>
      </div>
    );
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
      version_number: optFile?.version_number,
      classification: optFile?.classification,
    };
  });

  return <Sheet open={auditOpen} onOpenChange={setAuditOpen}>
    <div className="space-y-gutter lg:space-y-gutter-desktop">
      <header className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5 text-label-md text-muted-foreground">
            <Link href="/inbox" className="shrink-0 hover:text-primary">Inbox</Link>
            <ChevronRight size={13} aria-hidden className="shrink-0" />
            <span className="truncate font-mono text-code-tabular text-primary">{reference ?? "Reference pending"}</span>
            <ChevronRight size={13} aria-hidden className="shrink-0" />
            <span className="shrink-0">Document review</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            {["needs_review", "ready_for_approval", "failed"].includes(item.state) && (
              <ReprocessDocumentsButton caseId={item.id} revision={analysis.revision} />
            )}
            {share}
            {editable && (
              <>
                {groupedIssues.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setReviewDialogOpen(true)}
                    className="border-amber-600/30 text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-400 dark:hover:bg-amber-950/40 text-xs font-medium"
                    title="Review warnings and suggestions"
                  >
                    Review ({groupedIssues.length})
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => caseAction("approve")}
                  className="font-semibold shadow-xs"
                >
                  <Check aria-hidden /> Approve
                </Button>
              </>
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
            {item.state === "approved" && approval && !workflow.processed && <Button type="button" size="sm"
              disabled={busy} onClick={() => caseAction("processed")}><Check aria-hidden /> Add to Processed</Button>}
            {workflow.processed && <Badge variant="secondary">Processed</Badge>}
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" type="button" className="border-intelligence-border bg-intelligence-fill text-intelligence hover:bg-intelligence-border">
                <Sparkles aria-hidden /> Audit &amp; findings
                {issueCount > 0 && <Badge variant="destructive">{issueCount}</Badge>}
              </Button>
            </SheetTrigger>
          </div>
        </div>
        {actionError && <p role="alert" className="px-3 pt-1 text-xs text-destructive">{actionError}</p>}
        <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <h1 className="break-words text-headline-lg">{reference ?? "Intake case"}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
              <span>{item.company ?? "Unassigned"} · {label(item.channel)} · <time dateTime={item.created_at} className="font-mono text-code-tabular">{timestamp(item.created_at)}</time></span>
              <Status value={item.state} />
              {stale && <Status value="previous_analysis" />}
              {item.import_id && <Link href={`/imports/${item.import_id}`} className="data-link text-xs">Linked import</Link>}
            </div>
          </div>
        </div>
        {!item.company_id && !item.import_id && !["approved", "rejected"].includes(item.state) && <AssignCompanyForm companies={companies} caseId={item.id} revision={analysis.revision} />}
        {metadata.length > 0 && <dl className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-4 xl:grid-cols-8">
          {metadata.map(({ key, title, field, target }) => {
            const text = intakeField(field);
            const cite = text.evidence;
            const needsReview = intakeStatus(field) === "review";
            return <div key={key} className="min-w-0 bg-background px-3 py-2">
              <dt className="panel-label">{title}</dt>
              <dd className={cn("mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-label-md", ["bl_no", "container", "seal"].includes(key) && "font-mono text-code-tabular")} title={text.value}>
                {cite ? <button type="button" className="data-link block max-w-full cursor-pointer truncate text-left"
                  onClick={() => inspect(cite, { id: `field:${key}`, name: title, value: text.value, target, uncertain: needsReview })}>{text.value}</button> : text.value}
                {needsReview && <span className="size-1.5 rounded-full bg-amber-500 shrink-0" title="Review suggested" />}
              </dd>
            </div>;
          })}
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
        <div className="min-w-0 space-y-2 xl:col-span-5">
          {item.state === "awaiting_updated_document" && (
            <div className="rounded-md border border-amber-500/30 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="size-4 text-amber-600 shrink-0" />
                <span>Awaiting Updated Document</span>
              </div>
              <p className="mt-1 text-amber-800 dark:text-amber-300">
                This shipment is missing required transport or consignment documentation. When an updated version arrives, it will be automatically reprocessed and reconciled.
              </p>
            </div>
          )}

          {item.state === "manual_matching" && (
            <div className="rounded-md border border-rose-500/30 bg-rose-50/70 p-3 text-xs text-rose-900 dark:border-rose-500/20 dark:bg-rose-950/30 dark:text-rose-200">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="size-4 text-rose-600 shrink-0" />
                <span>Manual Matching Required</span>
              </div>
              <p className="mt-1 text-rose-800 dark:text-rose-300">
                Matching identifiers between this intake and active shipments were conflicting or uncertain. No records were modified automatically.
              </p>
            </div>
          )}

          <div className="panel overflow-hidden">
            {/* Document Intake Tabs */}
            <nav className="flex border-b bg-background px-2" aria-label="Document intake tabs">
              {tabs.map((tab) => {
                const active = activeTab.key === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleSelectTab(tab)}
                    aria-pressed={active}
                    className={cn(
                      "cursor-pointer border-b-2 px-4 py-2 text-xs font-semibold transition-all focus-visible:outline-offset-[-2px] flex items-center gap-1.5",
                      active
                        ? "border-primary text-primary font-bold"
                        : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                    )}
                  >
                    <span>{tab.label}</span>
                    {tab.badge && (
                      <span
                        className={cn(
                          "rounded px-1 py-0.2 text-[9px] font-bold",
                          tab.badgeVariant === "final"
                            ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        )}
                      >
                        {tab.badge}
                      </span>
                    )}
                    {typeof tab.count === "number" && tab.count > 0 && (
                      <span
                        className={cn(
                          "rounded-control px-1.5 py-0.2 text-[10px] font-mono",
                          active
                            ? "bg-primary/10 text-primary font-bold"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <IntakeStudioPanel
              item={item}
              analysis={analysis}
              intakeReference={reference}
              cdcNames={stale ? [] : saved?.cdc_names ?? []}
              editable={editable}
              hasConsigneeOptions={!!workflow.consignee_options?.length}
              viewedField={displayedField}
              isReviewed={isReviewed}
              cdcControls={activeRole === "invoice" && ["needs_review", "ready_for_approval"].includes(item.state) &&
                <>
                <details>
                  <summary className="cursor-pointer text-primary">Select CDC Master List</summary>
                  <ReviewActions caseId={item.id} revision={analysis.revision}
                    selected={analysis.selected_master ?? master ?? undefined} versions={versions}
                    companyId={item.company_id ?? undefined} canRegister={admin} pending={processing} showReprocess={false} />
                </details>
                <ReviewCdcMappings key={saved?.id ?? "none"} candidates={candidates} saved={saved} busy={busy}
                  onSave={async (mappings) => {
                    await saveReview({ ...reviewDraft(saved), mappings, verify_cdc_mappings: mappings.length > 0 });
                  }} />
                </>}
              document={activeDocument}
              activeEvidence={selectedEvidence}
              activeField={activeFieldInfo}
              activeRole={activeRole}
              onInspect={inspect}
              editor={editor}
              onDismissField={() => {
                setPartyPreview(undefined);
                setIssueSelection(undefined);
                setSelection(undefined);
                setActiveFieldInfo(undefined);
              }}
            />
          </div>
          <nav aria-label="Review issues" className="grid grid-cols-[1fr_auto_1fr] items-center px-1">
            <Button type="button" variant="ghost" size="icon-sm" className="justify-self-start"
              aria-label="Previous issue" title="Previous issue" disabled={!previousIssue}
              onClick={() => { if (previousIssue) showIssue(previousIssue); }}><ChevronLeft aria-hidden /></Button>
            <span role="status" className="text-xs text-muted-foreground tabular-nums" title={currentIssue?.message}>
              {issuePosition >= 0 ? `${issuePosition + 1} / ${pendingIssues.length}` :
                `${pendingIssues.length} ${pendingIssues.length === 1 ? "issue" : "issues"}`}
              {currentIssue && <span className="sr-only">{` · ${documentFieldLabel(currentIssue.name)}. ${currentIssue.message}`}</span>}
            </span>
            <Button type="button" variant="ghost" size="icon-sm" className="justify-self-end"
              aria-label="Next issue" title="Next issue" disabled={!nextIssue}
              onClick={() => { if (nextIssue) showIssue(nextIssue); }}><ChevronRight aria-hidden /></Button>
          </nav>
        </div>

        {/* Right Column: Document Canvas Artboard */}
        <div ref={source} tabIndex={-1} role="region" aria-label="Source viewer" className="min-w-0 scroll-mt-20 xl:col-span-7 xl:sticky xl:top-4 outline-none">
          <DocumentCanvas
            key={activeFieldInfo?.target?.name === "consignee" ? reviewKey(activeFieldInfo.target) : current?.key}
            file={file ? { id: file.id, name: file.name, fileType: file.fileType as "PDF" | "Excel" | "CDC", url: file.url, version_number: file.version_number, classification: file.classification } : undefined}
            options={canvasOptions}
            currentKey={current?.key}
            onChooseSource={chooseSource}
            evidence={selectedEvidence}
            activeFieldInfo={activeFieldInfo}
            editor={editor}
          />
        </div>
      </div>

      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden sm:max-w-3xl">
          <div className="flex items-center justify-between border-b px-5 py-3.5 bg-card">
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground">
                Review Warnings ({groupedIssues.length})
              </DialogTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                All detected values across shipment documents organized by hierarchy. Select or confirm values to proceed.
              </p>
            </div>
            <DialogCloseButton label="Close review dialog" />
          </div>

          <div className="max-h-[65vh] overflow-y-auto px-5 py-3 space-y-4">
            {groupedIssues.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                <Check size={20} className="mx-auto mb-2 text-emerald-600" />
                All warnings have been reviewed and confirmed.
              </div>
            ) : (
              treeBranches.map((branch) => (
                <div key={branch.id} className="space-y-1">
                  {/* Category Folder Header */}
                  <div className="flex items-center gap-2 py-1 text-xs font-semibold text-foreground">
                    <Folder size={15} className="text-amber-500 fill-amber-500/20 shrink-0" />
                    <span>{branch.title}</span>
                    <span className="rounded-full bg-muted/80 px-1.5 py-0.2 text-[10px] font-mono text-muted-foreground">
                      {branch.count}
                    </span>
                  </div>

                  {/* Direct Branch Leaf Items */}
                  {branch.items && branch.items.length > 0 && (
                    <div className="relative ml-2.5 pl-4 space-y-1.5 py-1">
                      <div className="pointer-events-none absolute left-0 top-0 bottom-3.5 w-px border-l border-dashed border-border/80" aria-hidden="true" />
                      {branch.items.map((item) => renderTreeItem(item))}
                    </div>
                  )}

                  {/* Row Groups (Line Items) */}
                  {branch.rowGroups && branch.rowGroups.length > 0 && (
                    <div className="relative ml-2.5 pl-4 space-y-3 py-1">
                      <div className="pointer-events-none absolute left-0 top-0 bottom-4 w-px border-l border-dashed border-border/80" aria-hidden="true" />
                      {branch.rowGroups.map((rg) => (
                        <div key={rg.row} className="relative space-y-1">
                          <span className="pointer-events-none absolute -left-4 top-3 w-4 border-t border-dashed border-border/80" aria-hidden="true" />
                          {/* Row Folder Header */}
                          <div className="flex items-center gap-2 py-0.5 text-xs font-medium text-foreground">
                            <Folder size={14} className="text-amber-600/70 fill-amber-600/10 shrink-0" />
                            <span className="font-semibold">Row {rg.row}</span>
                            {rg.description && (
                              <span className="text-muted-foreground font-normal truncate max-w-[280px]" title={rg.description}>
                                · {rg.description}
                              </span>
                            )}
                            <span className="rounded-full bg-muted/60 px-1.5 py-0.2 text-[9px] font-mono text-muted-foreground">
                              {rg.items.length}
                            </span>
                          </div>

                          {/* Row Leaf Items */}
                          <div className="relative ml-2.5 pl-4 space-y-1.5 py-1">
                            <div className="pointer-events-none absolute left-0 top-0 bottom-3.5 w-px border-l border-dashed border-border/80" aria-hidden="true" />
                            {rg.items.map((item) => renderTreeItem(item))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t px-5 py-2.5 bg-muted/20">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setReviewDialogOpen(false)}
              className="text-xs h-8"
            >
              Close
            </Button>
            {groupedIssues.length > 0 && (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  await handleVerifyAll();
                  setReviewDialogOpen(false);
                }}
                className="text-xs font-semibold shadow-xs h-8"
              >
                <Check size={13} className="mr-1" /> Confirm all ({groupedIssues.length})
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>

    <SheetContent aria-describedby={undefined} onCloseAutoFocus={(event) => {
      if (!focusEvidenceOnClose.current) return;
      focusEvidenceOnClose.current = false;
      event.preventDefault();
      focusSource();
    }}>
      <div className="sticky top-0 z-10 flex min-h-12 items-center justify-between border-b bg-card px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="flex items-center gap-2 text-headline-md"><ScanSearch size={16} aria-hidden className="text-tertiary" /> Audit &amp; Compliance</SheetTitle>
          {analysis.rules_version && <Badge variant="secondary">v{analysis.rules_version}</Badge>}
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
        {analysis.version_diff?.has_revisions && (
          <Section title="Document Revisions">
            <div className="space-y-2 p-3 text-xs">
              {analysis.version_diff.diffs.map((diff) => (
                <div key={diff.document_id} className="rounded border bg-card p-2.5 space-y-1">
                  <div className="flex items-center justify-between font-medium">
                    <span className="font-semibold text-foreground">{diff.original_filename} (v{diff.version_number})</span>
                    {diff.parent_filename && (
                      <span className="text-[10px] text-muted-foreground">replaces {diff.parent_filename}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {Object.entries(diff.modified).map(([f, vals]) => (
                      <span key={f} className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] border border-amber-500/20 text-amber-900 dark:text-amber-200">
                        <span className="font-medium text-amber-700 dark:text-amber-400">{documentFieldLabel(f)}:</span>
                        <span className="line-through text-muted-foreground text-[10px]">{String(vals.old)}</span>
                        <span className="font-semibold text-foreground">→ {String(vals.new)}</span>
                      </span>
                    ))}
                    {Object.entries(diff.added).map(([f, val]) => (
                      <span key={f} className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] border border-emerald-500/20 text-emerald-900 dark:text-emerald-200">
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
          <ReviewAuditControls caseId={item.id} workflow={workflow} saved={saved} busy={busy} editable={editable}
            onResolve={async (key, note) => {
              await saveReview({ ...reviewDraft(saved),
                issue_actions: reviewDraft(saved).issue_actions.filter((action) => action.key !== key),
                resolutions: [...(saved?.resolutions ?? []).filter((entry) => entry.key !== key), { key, note }],
              });
            }} onRequestCorrection={async (note) => {
              await saveReview({ ...reviewDraft(saved), request_correction: note });
            }}
            onReject={(note) => decide("reject", note)} />
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
