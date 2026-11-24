"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { AlertCircle, Check, CheckCircle2, FilePlus, FileText, ScanSearch, Search, Sparkles, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AssignCompanyForm } from "@/features/companies/company-forms";
import { RefreshButton } from "@/components/ui/refresh-button";
import { DocumentCanvas, type DocumentSourceOption } from "@/features/review/document-canvas";
import { VerificationWorkspace } from "@/features/review/verification/verification-workspace";
import { ConnectorLine } from "@/features/review/connector-line";
import { ResizableSplit } from "@/features/review/resizable-split";
import { IntakeStudioPanel, intakeStatus, type InspectedField } from "@/features/review/intake-studio-panel";
import { ReviewAuditControls, ReviewCdcMappings, reviewDraft, reviewKey, type ReviewDraft } from "@/features/review/staff-review";
import type { FieldChoice, FieldEdit, FieldEditor } from "@/features/review/field-editor-types";
import { ReprocessDocumentsButton, ReviewActions } from "@/features/review/review-actions";
import { AdvisoryPanel, Findings, sourceKey } from "@/features/review/review-findings";
import { Empty, Section, Status } from "@/components/ui/page-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { DialogCloseButton } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "@/lib/toast";
import { write } from "@/lib/client-api";
import { removeSyncedPackingListField, syncInvoiceEditToPackingList } from "@/features/review/verification/verification-review";
import type { CaseActivity, CaseDetail, Company, ConsigneeSourceRef, Evidence, ExtractedField, Finding, MasterVersion, ReviewAnalysis, ReviewCorrection, ReviewField, ReviewWorkflow, StaffReview } from "@/lib/contracts";
import { documentFieldLabel, intakeField, invoiceReference, label, location, sourceValue, timestamp } from "@/lib/format";
import { cn } from "@/lib/utils";

type MainTab = "B/L" | "Invoice" | "Packing list";

type MainTabItem = {
  key: MainTab;
  label: string;
  badge?: string;
  badgeVariant?: "final" | "draft";
  count: number | null;
};

type BlSubTabItem = {
  key: string;
  label: string;
  role: "draft_bl" | "final_bl";
  documentId: string;
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

export function DocumentReviewWorkspace({ item, analysis, workflow, companies, activity, share, versions, admin, initialTab }: {
  item: CaseDetail; analysis: ReviewAnalysis; versions: MasterVersion[]; workflow: ReviewWorkflow; companies: Company[]; activity: CaseActivity[]; admin: boolean; share?: ReactNode; initialTab?: "documents" | "verification";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get("tab");
  const tabFromUrl: "documents" | "verification" =
    initialTab ??
    (tabParam === "verification" || pathname.endsWith("/verification")
      ? "verification"
      : "documents");

  const [activeTabOverride, setActiveTabOverride] = useState<"documents" | "verification">();
  const workspaceTab = activeTabOverride ?? tabFromUrl;
  const [chosenMainTab, setChosenMainTab] = useState<MainTab>();
  const [chosenBlSubTabKey, setChosenBlSubTabKey] = useState<string>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [selection, setSelection] = useState<Evidence>();
  const [partyPreview, setPartyPreview] = useState<{ source: ConsigneeSourceRef; evidence: Evidence }>();
  const [activeFieldInfo, setActiveFieldInfo] = useState<InspectedField>();
  const [auditView, setAuditView] = useState<typeof auditViews[number]>("All");
  const [auditOpen, setAuditOpen] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState("");

  const handleWorkspaceTabChange = useCallback((nextTab: "documents" | "verification") => {
    setActiveTabOverride(nextTab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nextTab === "verification") {
        url.searchParams.set("tab", "verification");
      } else {
        url.searchParams.delete("tab");
      }
      if (url.pathname.endsWith("/verification") && nextTab === "documents") {
        url.pathname = url.pathname.replace(/\/verification$/, "");
      }
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setActiveTabOverride(undefined);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
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

  const blSubTabs: BlSubTabItem[] = transportDocs.map((doc) => {
    const ext = analysis.extractions.find((e) => e.document_id === doc.id);
    const isFinal = doc.classification === "final_bl" || ext?.role === "final_bl";
    const count = ext ? (ext.items?.length || Object.values(ext.fields).filter((f) => f?.value).length) : null;
    return {
      key: `bl:${doc.id}`,
      label: isFinal ? "Final B/L" : "Draft B/L",
      role: isFinal ? "final_bl" : "draft_bl",
      documentId: doc.id,
      badge: isFinal ? "FINAL" : (doc.version_number ?? 1) > 1 ? `v${doc.version_number}` : "v1",
      badgeVariant: isFinal ? "final" : "draft",
      count,
    };
  });

  if (blSubTabs.length === 0) {
    const transportExts = analysis.extractions.filter((e) => e.role === "draft_bl" || e.role === "final_bl");
    for (const ext of transportExts) {
      const isFinal = ext.role === "final_bl";
      const count = ext.items?.length || Object.values(ext.fields).filter((f) => f?.value).length;
      blSubTabs.push({
        key: `bl:${ext.document_id}`,
        label: isFinal ? "Final B/L" : "Draft B/L",
        role: isFinal ? "final_bl" : "draft_bl",
        documentId: ext.document_id,
        badge: isFinal ? "FINAL" : "v1",
        badgeVariant: isFinal ? "final" : "draft",
        count,
      });
    }
  }

  const fallbackSubTab = blSubTabs.find((t) => t.documentId && selectedKey?.startsWith(t.documentId))
    ?? blSubTabs[0];
  const activeBlSubTab: BlSubTabItem | undefined = (chosenBlSubTabKey ? blSubTabs.find((t) => t.key === chosenBlSubTabKey) : undefined)
    ?? fallbackSubTab
    ?? blSubTabs[0];

  const hasFinalBl = transportDocs.some((d) => d.classification === "final_bl")
    || analysis.extractions.some((e) => e.role === "final_bl");

  const blCount = activeBlSubTab?.count
    ?? (blSubTabs.length > 0 ? blSubTabs[0]?.count : null);

  const invoiceExt = analysis.extractions.find((e) => e.role === "invoice");
  const invoiceCount = invoiceExt ? (invoiceExt.items?.length || Object.values(invoiceExt.fields).filter((f) => f?.value).length) : null;

  const packingExt = analysis.extractions.find((e) => e.role === "packing_list");
  const packingCount = packingExt ? (packingExt.items?.length || Object.values(packingExt.fields).filter((f) => f?.value).length) : null;

  const mainTabItems: MainTabItem[] = [
    {
      key: "B/L",
      label: "B/L",
      badge: hasFinalBl ? "FINAL" : undefined,
      badgeVariant: "final",
      count: blCount,
    },
    {
      key: "Invoice",
      label: "Invoice",
      count: invoiceCount,
    },
    {
      key: "Packing list",
      label: "Packing list",
      count: packingCount,
    },
  ];

  const fallbackMainTab: MainTab = selectedKey?.includes(":invoice")
    ? "Invoice"
    : selectedKey?.includes(":packing_list")
    ? "Packing list"
    : "B/L";

  const activeMainTab: MainTab = chosenMainTab ?? fallbackMainTab;

  const activeRole: "draft_bl" | "final_bl" | "invoice" | "packing_list" = activeMainTab === "Invoice"
    ? "invoice"
    : activeMainTab === "Packing list"
    ? "packing_list"
    : (activeBlSubTab?.role ?? "draft_bl");

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

  const targetOption = activeMainTab === "B/L"
    ? (activeBlSubTab?.documentId
        ? options.find((opt) => opt.id === activeBlSubTab.documentId && (!activeBlSubTab.role || opt.key.endsWith(`:${activeBlSubTab.role}`)))
          ?? options.find((opt) => opt.id === activeBlSubTab.documentId)
        : options.find((opt) => opt.key.endsWith(":draft_bl") || opt.key.endsWith(":final_bl"))
      )
    : activeMainTab === "Invoice"
    ? options.find((opt) => opt.key.endsWith(":invoice") || (invoiceExt?.sheet && opt.sheet === invoiceExt.sheet))
    : options.find((opt) => opt.key.endsWith(":packing_list") || (packingExt?.sheet && opt.sheet === packingExt.sheet));

  const previewOption = partyPreview && options.find((option) => option.id === partyPreview.source.document_id &&
    (option.key.endsWith(`:${partyPreview.source.role}`) || (matchesRole(partyPreview.source.role, "draft_bl") && matchesRole(option.key.split(":").pop() ?? "", "draft_bl"))) && option.sheet === partyPreview.evidence.sheet);
  const current = previewOption ?? options.find((option) => option.key === selectedKey)
    ?? targetOption
    ?? options.find((option) => option.id === fallbackSource)
    ?? options[0];

  const activeDocument = (activeMainTab === "B/L" && activeBlSubTab?.documentId
      ? extractionSources.find((doc) => doc.document_id === activeBlSubTab.documentId && (doc.role === activeBlSubTab.role || matchesRole(doc.role, activeBlSubTab.role)))
      : undefined
    )
    ?? (activeMainTab === "Invoice"
      ? extractionSources.find((doc) => doc.role === "invoice")
      : activeMainTab === "Packing list"
      ? extractionSources.find((doc) => doc.role === "packing_list")
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
  const editable = !stale && analysis.state === "available" && ["needs_review", "ready_for_approval", "awaiting_updated_document"].includes(item.state);
  const candidates = Array.from(new Map(
    [...(saved?.candidates ?? []), ...(analysis.candidates ?? [])]
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

  function handleSelectMainTab(tab: MainTab) {
    setChosenMainTab(tab);
    setPartyPreview(undefined);
    setSelection(undefined);
    setActiveFieldInfo(undefined);

    if (tab === "B/L") {
      const sub = activeBlSubTab ?? blSubTabs[0];
      const match = sub?.documentId
        ? options.find((opt) => opt.id === sub.documentId && (!sub.role || opt.key.endsWith(`:${sub.role}`)))
          ?? options.find((opt) => opt.id === sub.documentId)
        : options.find((opt) => opt.key.endsWith(":draft_bl") || opt.key.endsWith(":final_bl"));
      if (match) setSelectedKey(match.key);
    } else if (tab === "Invoice") {
      const match = options.find((opt) => opt.key.endsWith(":invoice") || (invoiceExt?.sheet && opt.sheet === invoiceExt.sheet));
      if (match) setSelectedKey(match.key);
    } else if (tab === "Packing list") {
      const match = options.find((opt) => opt.key.endsWith(":packing_list") || (packingExt?.sheet && opt.sheet === packingExt.sheet));
      if (match) setSelectedKey(match.key);
    }
  }

  function handleSelectBlSubTab(subTab: BlSubTabItem) {
    setChosenMainTab("B/L");
    setChosenBlSubTabKey(subTab.key);
    setPartyPreview(undefined);
    setSelection(undefined);
    setActiveFieldInfo(undefined);

    const match = options.find((opt) => opt.id === subTab.documentId && (!subTab.role || opt.key.endsWith(`:${subTab.role}`)))
      ?? options.find((opt) => opt.id === subTab.documentId);
    if (match) {
      setSelectedKey(match.key);
    }
  }

  function chooseSource(key?: string) {
    setPartyPreview(undefined);
    setSelectedKey(key);
    setSelection(undefined);
    setActiveFieldInfo(undefined);
    const opt = options.find((o) => o.key === key);
    if (opt) {
      const blMatch = blSubTabs.find((t) => t.documentId === opt.id);
      if (blMatch) {
        setChosenMainTab("B/L");
        setChosenBlSubTabKey(blMatch.key);
      } else if (key?.endsWith(":invoice")) {
        setChosenMainTab("Invoice");
      } else if (key?.endsWith(":packing_list")) {
        setChosenMainTab("Packing list");
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
    if (match) {
      setSelectedKey(match.key);
      const docId = documentId ?? match.id;
      const blMatch = blSubTabs.find((t) => t.documentId === docId);
      if (blMatch) {
        setChosenMainTab("B/L");
        setChosenBlSubTabKey(blMatch.key);
      } else if (match.key.endsWith(":invoice") || role === "invoice") {
        setChosenMainTab("Invoice");
      } else if (match.key.endsWith(":packing_list") || role === "packing_list") {
        setChosenMainTab("Packing list");
      }
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

  async function handleVerifyAll(): Promise<StaffReview> {
    return saveReview(reviewDraft(saved));
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
      let next = clearField(reviewDraft(saved), [currentRef]);
      if (edit.choice?.issueKey) {
        next.issue_actions.push({ key: edit.choice.issueKey, action: "accept_ai" });
      } else {
        const invoiceCorrection: ReviewCorrection = {
          ...currentRef, value: edit.value, unit: edit.unit, currency: edit.currency,
          note: edit.choice?.consigneeSource ? "Selected a printed consignee from this shipment." :
            edit.choice?.alternativeIndex !== undefined ? "Selected a value from the original document evidence." :
            edit.value === source.value && edit.unit === source.unit && edit.currency === source.currency
              ? "Confirmed against original document evidence." : "Edited in the document review card.",
          alternative_index: edit.choice?.alternativeIndex,
          consignee_source: edit.choice?.consigneeSource,
        };
        next.corrections.push(invoiceCorrection);

        if (currentRef.role === "invoice" && currentRef.row !== null && ["description", "english_description", "unit"].includes(currentRef.name)) {
          next = syncInvoiceEditToPackingList(
            next,
            invoiceCorrection,
            workflow,
            analysis.extractions,
            analysis.line_items,
            analysis.findings
          );
        }
      }
      await saveReview(next);
      toast.saved("Saved!");
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
        let draft = reviewDraft(saved);
        if (target.role === "invoice" && target.row !== null && ["description", "english_description", "unit"].includes(target.name)) {
          draft = removeSyncedPackingListField(
            draft,
            target,
            analysis.extractions,
            analysis.line_items,
            analysis.findings
          );
        }
        await saveReview(clearField(draft, englishItem ? [target, englishRef] : [target]));
        toast.updated("Field reset");
      },
    };
  }

  const handleMarkCorrect = useCallback(async (target: ReviewField, value: string) => {
    const isAlreadyReviewed = isReviewed(target);
    if (isAlreadyReviewed) {
      let draft = reviewDraft(saved);
      if (target.role === "invoice" && target.row !== null && ["description", "english_description", "unit"].includes(target.name)) {
        draft = removeSyncedPackingListField(
          draft,
          target,
          analysis.extractions,
          analysis.line_items,
          analysis.findings
        );
      }
      await saveReview(clearField(draft, [target]));
      toast.updated(`Reset ${documentFieldLabel(target.name)}`);
    } else {
      let next = clearField(reviewDraft(saved), [target]);
      const invoiceCorrection: ReviewCorrection = {
        ...target,
        value,
        unit: null,
        currency: null,
        note: "Confirmed as correct by staff.",
      };
      next.corrections.push(invoiceCorrection);
      if (target.role === "invoice" && target.row !== null && ["description", "english_description", "unit"].includes(target.name)) {
        next = syncInvoiceEditToPackingList(
          next,
          invoiceCorrection,
          workflow,
          analysis.extractions,
          analysis.line_items,
          analysis.findings
        );
      }
      await saveReview(next);
      toast.saved(`Marked ${documentFieldLabel(target.name)} as correct`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReviewed, saved, analysis, workflow]);

  const handleOpenVerification = useCallback((target?: ReviewField) => {
    if (target) {
      toast.info(`Opening verification for ${documentFieldLabel(target.name)}`);
    }
    handleWorkspaceTabChange("verification");
  }, [handleWorkspaceTabChange]);

  async function decide(kind: "approve" | "reject" | "processed", notes = "Approved after staff review.", reviewId?: string | null) {
    await updateReview(() => write(`${path}/${kind}`, kind === "processed"
      ? { expected_revision: analysis.revision, approval_id: approval?.id }
      : { expected_revision: analysis.revision, review_id: reviewId !== undefined ? reviewId : (saved?.id ?? null), notes }));
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
    hasFinalBL && item.final_bl_confirmed_revision !== analysis.revision
  );

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

  async function handleCreateDraft() {
    setActionError("");
    try {
      await handleVerifyAll();
      toast.saved("Draft created! Review CDC verification and preview.");
      handleWorkspaceTabChange("verification");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create draft.");
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
      {/* Top Bar: Breadcrumb + Action Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/inbox">Inbox</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <span className="truncate font-mono text-code-tabular text-primary font-medium">{reference ?? "Reference pending"}</span>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                {workspaceTab === "verification" ? "Document verification" : "Document review"}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton />
          {["needs_review", "ready_for_approval", "failed"].includes(item.state) && (
            <ReprocessDocumentsButton caseId={item.id} revision={analysis.revision} />
          )}
          {share}
          {editable && (
            <>
              {workspaceTab === "documents" ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={handleCreateDraft}
                  className="font-semibold shadow-xs"
                  title="Save document extractions and prepare draft for CDC verification"
                >
                  <FilePlus aria-hidden className="size-3.5 mr-1" /> Create Draft
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => caseAction("approve")}
                  className="font-semibold shadow-xs"
                  title="Approve shipment and finalize permit draft"
                >
                  <Check aria-hidden className="size-3.5 mr-1" /> Approve
                </Button>
              )}
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
          {item.state === "approved" && approval && !workflow.processed && (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => caseAction("processed")}
            >
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

      {/* Top Workspace Level Tabs: Documents | Verification */}
      <nav className="flex border-b bg-background gap-1" aria-label="Case workspace tabs">
        <button
          type="button"
          disabled={busy}
          onClick={() => handleWorkspaceTabChange("documents")}
          aria-pressed={workspaceTab === "documents"}
          className={cn(
            "cursor-pointer border-b-2 px-4 py-2.5 text-xs font-semibold transition-all flex items-center gap-1.5",
            workspaceTab === "documents"
              ? "border-primary text-primary font-bold"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
          )}
        >
          <FileText className="size-3.5" />
          <span>Documents</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => handleWorkspaceTabChange("verification")}
          aria-pressed={workspaceTab === "verification"}
          className={cn(
            "cursor-pointer border-b-2 px-4 py-2.5 text-xs font-semibold transition-all flex items-center gap-1.5",
            workspaceTab === "verification"
              ? "border-primary text-primary font-bold"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
          )}
        >
          <CheckCircle2 className="size-3.5" />
          <span>Verification</span>
          {issueCount > 0 ? (
            <span className="rounded-control bg-destructive/10 text-destructive font-mono text-[10px] px-1.5 py-0.2 font-bold">
              {issueCount}
            </span>
          ) : analysis.outcome === "PASS" ? (
            <span className="rounded-control bg-emerald-500/10 text-emerald-600 font-mono text-[10px] px-1.5 py-0.2 font-bold">
              PASS
            </span>
          ) : null}
        </button>
      </nav>

      {/* Case Header Card */}
      <header className="panel overflow-hidden">
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
        {metadata.length > 0 && (
          <dl className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-4 md:grid-cols-none md:grid-flow-col md:auto-cols-fr md:grid-rows-1">
            {metadata.map(({ key, title, field, target }) => {
              const text = intakeField(field);
              const cite = text.evidence;
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
                    {cite ? (
                      <button
                        type="button"
                        className="data-link block max-w-full cursor-pointer truncate text-left text-primary hover:underline transition-colors"
                        onClick={() =>
                          inspect(cite, {
                            id: `field:${key}`,
                            name: title,
                            value: text.value,
                            target,
                            uncertain: needsReview,
                          })
                        }
                      >
                        {text.value}
                      </button>
                    ) : (
                      text.value
                    )}
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

      {workspaceTab === "verification" ? (
        <VerificationWorkspace key={`${item.id}:${analysis.revision}`} item={item} analysis={analysis} workflow={workflow} saved={saved} versions={versions} admin={admin}
          onSaved={(review) => setRecent({ revision: analysis.revision, base: remoteId, review })} onPending={setSaving} />
      ) : (
        /* Main Review Workspace Layout */
        <ResizableSplit
          ref={workspaceGridRef}
          role="region"
          aria-label="Document evidence and comparisons"
          ariaLabel="Resize editor and preview"
          defaultWidth={42}
          minWidth={28}
          maxWidth={75}
          storageKey="harborway:intake:doc-split"
          dividerHeightClassName="lg:h-[min(82vh,880px)]"
          overlay={<ConnectorLine containerRef={workspaceGridRef} active={!!selectedEvidence} />}
          left={
            <div className="min-w-0 flex flex-col">
              {/* Clean toolbar above left card - search field */}
              <div className="flex items-center justify-between gap-2 h-9 px-1 mb-2">
                <div className="relative w-full max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    type="text"
                    placeholder="Search intake fields & items..."
                    value={docSearchQuery}
                    onChange={(e) => setDocSearchQuery(e.target.value)}
                    className="h-8 pl-8 pr-7 text-xs bg-white dark:bg-slate-900 border-border/80 rounded-md focus-visible:ring-1 focus-visible:ring-primary shadow-2xs"
                  />
                  {docSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setDocSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                      aria-label="Clear search"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
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
                {/* Main Document Intake Tabs */}
            <nav className="flex border-b bg-background px-2" aria-label="Document intake tabs">
              {mainTabItems.map((tab) => {
                const active = activeMainTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => handleSelectMainTab(tab.key)}
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

            {/* Sub Tab Bar for Bill of Lading (shown only when in B/L tab, hidden on Invoice & Packing list) */}
            {activeMainTab === "B/L" && blSubTabs.length > 1 && (
              <nav className="flex border-b bg-muted/20 px-2" aria-label="Bill of Lading versions">
                {blSubTabs.map((subTab) => {
                  const active = activeBlSubTab?.key === subTab.key;
                  return (
                    <button
                      key={subTab.key}
                      type="button"
                      onClick={() => handleSelectBlSubTab(subTab)}
                      aria-pressed={active}
                      className={cn(
                        "cursor-pointer border-b-2 px-4 py-2 text-xs font-semibold transition-all focus-visible:outline-offset-[-2px] flex items-center gap-1.5",
                        active
                          ? "border-primary text-primary font-bold"
                          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                      )}
                    >
                      <span>{subTab.label}</span>
                      {subTab.badge && (
                        <span
                          className={cn(
                            "rounded px-1 py-0.2 text-[9px] font-bold",
                            subTab.badgeVariant === "final"
                              ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                          )}
                        >
                          {subTab.badge}
                        </span>
                      )}
                      {typeof subTab.count === "number" && subTab.count > 0 && (
                        <span
                          className={cn(
                            "rounded-control px-1.5 py-0.2 text-[10px] font-mono",
                            active
                              ? "bg-primary/10 text-primary font-bold"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {subTab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            )}

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
                    toast.updated("CDC mappings updated!");
                  }} />
                </>}
              document={activeDocument}
              activeEvidence={selectedEvidence}
              activeField={activeFieldInfo}
              activeRole={activeRole}
              onInspect={inspect}
              editor={editor}
              onMarkCorrect={handleMarkCorrect}
              onOpenVerification={handleOpenVerification}
              onDismissField={() => {
                setPartyPreview(undefined);
                setSelection(undefined);
                setActiveFieldInfo(undefined);
              }}
              searchQuery={docSearchQuery}
            />
          </div>
        </div>
        </div>
      }
      right={
        <div ref={source} tabIndex={-1} role="region" aria-label="Source viewer" className="min-w-0 flex flex-col scroll-mt-20 lg:sticky lg:top-4 outline-none">
          <div className="flex items-center justify-between h-9 px-1 mb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Original Document Viewer
            </span>
          </div>
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
      }
    />
    )}

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
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileTypeIcon filename={diff.original_filename} size="xs" />
                      <span className="font-semibold text-foreground truncate">{diff.original_filename} (v{diff.version_number})</span>
                    </div>
                    {diff.parent_filename && (
                      <span className="text-[10px] text-muted-foreground shrink-0">replaces {diff.parent_filename}</span>
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
              toast.updated("Issue resolved");
            }} onRequestCorrection={async (note) => {
              await saveReview({ ...reviewDraft(saved), request_correction: note });
              toast.updated("Correction requested");
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
