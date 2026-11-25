"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Download, Eye, FileText, LayoutDashboard } from "lucide-react";
import { ExcelFileIcon } from "@/components/ui/file-icon";
import { Button } from "@/components/ui/button";
import { Empty, PageHeading, Section, Status } from "@/components/ui/page-layout";
import { Originals } from "@/features/imports/originals";
import { PermitRelease } from "@/features/imports/permit-release";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListPagination } from "@/components/ui/pagination";
import { ImportShipmentTracker } from "@/features/imports/import-shipment-tracker";
import { ImportDocumentReview } from "@/features/imports/import-document-review";
import type { CaseDetail, ImportDetail, MasterVersion, PermitDraft, ReviewAnalysis, ReviewWorkflow, StaffReview } from "@/lib/contracts";
import { label, timestamp, formatFieldValue } from "@/lib/format";
import { cn } from "@/lib/utils";

type ImportDetailViewProps = {
  record: ImportDetail;
  items: ImportDetail["items"];
  offset: number;
  companyIdParam?: string;
  initialTab?: "overview" | "documents";
  drafts: PermitDraft[];
  workflow: ReviewWorkflow | null;
  permitPending?: string | null;
  caseDetail?: CaseDetail | null;
  analysis?: ReviewAnalysis | null;
  saved?: StaffReview | null;
  versions?: MasterVersion[];
  paginationPath: string;
};

export function ImportDetailView({
  record,
  items,
  offset,
  initialTab = "overview",
  drafts,
  permitPending,
  analysis,
  saved,
  versions = [],
  paginationPath,
}: ImportDetailViewProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "documents">(initialTab);

  const fields = [
    ["Company", record.company],
    ["Supplier", record.supplier || "—"],
    ["Consignee", record.consignee || "—"],
    ["Created", timestamp(record.created_at)],
    ["ETD", record.etd || label(record.etd_status)],
    ["ETA", record.eta || label(record.eta_status)],
  ];

  return (
    <div className="space-y-gutter lg:space-y-gutter-desktop">
      {/* Clean Header without extra status badge clutter */}
      <PageHeading
        title={record.invoice_no}
        description={
          record.approved_at
            ? `Approved ${timestamp(record.approved_at)}${record.supplier ? ` · ${record.supplier}` : ""}`
            : "Import draft · pending approval"
        }
        code
      />

      {/* Clean Flat Underline Tab Switcher */}
      <nav className="flex border-b bg-background gap-1" aria-label="Import record views">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          aria-pressed={activeTab === "overview"}
          className={cn(
            "cursor-pointer border-b-2 px-4 py-2.5 text-xs font-semibold transition-all flex items-center gap-2",
            activeTab === "overview"
              ? "border-primary text-primary font-bold"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
          )}
        >
          <LayoutDashboard className="size-3.5" />
          <span>Overview &amp; Tracking</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("documents")}
          aria-pressed={activeTab === "documents"}
          className={cn(
            "cursor-pointer border-b-2 px-4 py-2.5 text-xs font-semibold transition-all flex items-center gap-2",
            activeTab === "documents"
              ? "border-primary text-primary font-bold"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
          )}
        >
          <FileText className="size-3.5" />
          <span>Document Review</span>
        </button>
      </nav>

      {/* Tab 1: Overview & Shipment */}
      {activeTab === "overview" && (
        <div className="space-y-gutter lg:space-y-gutter-desktop">
          <div className="grid items-start gap-gutter lg:grid-cols-[minmax(0,1fr)_minmax(18rem,30%)] lg:gap-gutter-desktop">
            <Section
              title="Overview"
              action={
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => setActiveTab("documents")}
                    className="gap-1.5 text-xs font-semibold text-primary"
                  >
                    <Eye className="size-3.5" />
                    <span>Review Documents</span>
                  </Button>
                  <Button asChild size="xs" variant="ghost">
                    <Link href={`/review/${record.intake_case_id}`}>
                      Source intake <ArrowUpRight aria-hidden className="size-3" />
                    </Link>
                  </Button>
                </div>
              }
            >
              <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3">
                {fields.map(([field, value], index) => (
                  <div key={field} className="min-w-0 bg-card px-3 py-2.5">
                    <dt className="panel-label">{field}</dt>
                    <dd
                      className={`mt-1 break-words ${
                        index >= 3 ? "font-mono text-code-tabular" : "text-body-md"
                      }`}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
            <Section title="Original attachments">
              <Originals documents={record.documents} />
            </Section>
          </div>

          <ImportShipmentTracker
            invoiceNo={record.invoice_no}
            company={record.company}
            supplier={record.supplier}
            consignee={record.consignee}
            eta={record.eta}
            isApproved={record.state === "approved"}
          />

          {record.state === "approved" && (
            <Section title="Permit drafts">
              {permitPending && (
                <div className="flex flex-wrap items-center gap-2 border-b border-warning-border bg-warning-fill p-3 text-body-sm text-warning">
                  <Status value="pending" />
                  <p>{permitPending}</p>
                </div>
              )}
              {drafts.map((draft) => (
                <div className="space-y-3 border-b p-3 last:border-b-0" key={draft.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <ExcelFileIcon size="lg" />
                      <div className="space-y-1">
                        <h3 className="text-headline-sm">Permit INV / PL</h3>
                        <p className="font-mono text-code-tabular text-muted-foreground">
                          Revision {draft.revision} · {timestamp(draft.created_at)}
                          {!draft.current && " · Prior revision"}
                        </p>
                      </div>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <a href={`/api/v1/imports/${record.id}/permit-drafts/${draft.id}/download`}>
                        <Download aria-hidden />
                        Download permit draft
                      </a>
                    </Button>
                  </div>
                  {draft.current && (
                    <PermitRelease
                      importId={record.id}
                      draftId={draft.id}
                      recipient={draft.recipient ?? undefined}
                    />
                  )}
                </div>
              ))}
              {drafts.length === 0 && !permitPending && (
                <Empty>No permit draft has been generated.</Empty>
              )}
            </Section>
          )}

          <Section title="Items">
            {items.length ? (
              <Table className="min-w-[480px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Verification</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-code-tabular text-muted-foreground">
                        {item.line_no}
                      </TableCell>
                      <TableCell className="max-w-80 whitespace-normal">
                        {item.normalized_description ?? item.raw_description}
                      </TableCell>
                      <TableCell className="text-right font-mono text-code-tabular">
                        {item.quantity ? [formatFieldValue(item.quantity, "quantity"), item.unit].filter(Boolean).join(" ") : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-code-tabular">
                        {item.amount ? [formatFieldValue(item.amount, "amount"), item.currency].filter(Boolean).join(" ") : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {label(item.verification_state)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Empty>No line items are saved in this draft. Review extracted lines in the source intake.</Empty>
            )}
            <ListPagination
              path={paginationPath}
              label="Import items"
              offset={offset}
              count={items.length}
              total={record.items.length}
            />
          </Section>
        </div>
      )}

      {/* Tab 2: Document Review & PDF Preview Studio */}
      {activeTab === "documents" && (
        <ImportDocumentReview
          importRecord={record}
          analysis={analysis}
          saved={saved}
          versions={versions}
        />
      )}
    </div>
  );
}
