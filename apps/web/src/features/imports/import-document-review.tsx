"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { Anchor, FileText, Package, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty } from "@/components/ui/page-layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DocumentCanvas, type DocumentSourceOption } from "@/features/review/document-canvas";
import { ResizableSplit } from "@/features/review/resizable-split";
import { PermitDraftPreview, type PermitTemplate } from "@/features/review/verification/permit-draft-preview";
import type { ImportDetail, MasterVersion, ReviewAnalysis, StaffReview } from "@/lib/contracts";
import { formatFieldValue, formatDecimal } from "@/lib/format";
import { cn } from "@/lib/utils";

type ImportDocumentReviewProps = {
  importRecord: ImportDetail;
  analysis?: ReviewAnalysis | null;
  saved?: StaffReview | null;
  versions?: MasterVersion[];
};

type DocTab = "inv" | "pl" | "bl";

export function ImportDocumentReview({
  importRecord,
  analysis,
  saved,
  versions = [],
}: ImportDocumentReviewProps) {
  const [docTab, setDocTab] = useState<DocTab>("inv");
  const [template, setTemplate] = useState<PermitTemplate>("cdc_classic");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputId = useId();

  const invoiceExt = useMemo(() => {
    return analysis?.extractions.find((e) => e.role === "invoice");
  }, [analysis]);

  const packingExt = useMemo(() => {
    return analysis?.extractions.find((e) => e.role === "packing_list");
  }, [analysis]);

  const blExt = useMemo(() => {
    return (
      analysis?.extractions.find((e) => e.role === "final_bl") ??
      analysis?.extractions.find((e) => e.role === "draft_bl")
    );
  }, [analysis]);

  const originalBlDoc = useMemo(() => {
    const docs = importRecord.documents ?? [];
    return (
      docs.find((d) => d.classification === "final_bl") ??
      docs.find((d) => d.classification === "draft_bl") ??
      (blExt?.document_id ? docs.find((d) => d.id === blExt.document_id) : undefined) ??
      docs.find(
        (d) =>
          /b[\/_ -]?l|lading|提单/i.test(d.original_filename) &&
          (d.mime === "application/pdf" || d.original_filename.toLowerCase().endsWith(".pdf"))
      ) ??
      null
    );
  }, [importRecord.documents, blExt]);

  const blFile = useMemo(() => {
    if (!originalBlDoc) return undefined;
    const isPdf =
      originalBlDoc.mime === "application/pdf" ||
      originalBlDoc.original_filename.toLowerCase().endsWith(".pdf");
    return {
      id: originalBlDoc.id,
      name: originalBlDoc.original_filename,
      fileType: (isPdf ? "PDF" : "Excel") as "PDF" | "Excel",
      url: `/api/v1/documents/${originalBlDoc.id}/download`,
      version_number: originalBlDoc.version_number ?? 1,
      classification: originalBlDoc.classification,
    };
  }, [originalBlDoc]);

  const blOptions = useMemo<DocumentSourceOption[]>(() => {
    if (!blFile) return [];
    return [
      {
        key: `${blFile.id}:`,
        id: blFile.id,
        title: blFile.name,
        sheet: null,
        fileType: blFile.fileType,
        name: blFile.name,
        url: blFile.url,
        lines: [],
        version_number: blFile.version_number,
        classification: blFile.classification,
      },
    ];
  }, [blFile]);

  const blNoValue = blExt?.fields.bl_no?.value || blExt?.fields.bill_no?.value || "—";
  const invItemCount = invoiceExt?.items?.length ?? importRecord.items.length;
  const plItemCount = packingExt?.items?.length ?? importRecord.items.length;
  const blItemCount = blExt?.items?.length ?? (blNoValue !== "—" ? 1 : 0);

  const getField = useCallback(
    (key: string): string => {
      if (docTab === "inv" && invoiceExt?.fields[key]?.value) {
        return invoiceExt.fields[key].value;
      }
      if (docTab === "pl" && packingExt?.fields[key]?.value) {
        return packingExt.fields[key].value;
      }
      if (docTab === "bl" && blExt?.fields[key]?.value) {
        return blExt.fields[key].value;
      }
      if (key === "invoice_no") return importRecord.invoice_no;
      if (key === "supplier") return importRecord.supplier || "—";
      if (key === "consignee") return importRecord.consignee || "—";
      if (key === "bl_no") return blNoValue;
      return "—";
    },
    [docTab, invoiceExt, packingExt, blExt, importRecord, blNoValue]
  );

  const invoiceItems = useMemo(() => {
    if (invoiceExt?.items?.length) {
      return invoiceExt.items.map((it, idx) => ({
        lineNo: idx + 1,
        desc: it.fields.description?.value || `Item ${idx + 1}`,
        qty: it.fields.quantity?.value || "",
        unit: it.fields.unit?.value || "KG",
        unitPrice: it.fields.unit_price?.value || "",
        amount: it.fields.amount?.value || "",
      }));
    }
    return importRecord.items.map((it) => {
      const qtyNum = it.quantity ? parseFloat(it.quantity) : 0;
      const amtNum = it.amount ? parseFloat(it.amount) : 0;
      const computedPrice = qtyNum > 0 && amtNum > 0 ? (amtNum / qtyNum).toFixed(2) : "";
      return {
        lineNo: it.line_no,
        desc: it.normalized_description || it.raw_description,
        qty: it.quantity ? String(it.quantity) : "",
        unit: it.unit || "KG",
        unitPrice: computedPrice,
        amount: it.amount ? formatDecimal(it.amount) : "",
      };
    });
  }, [invoiceExt, importRecord]);

  const packingItems = useMemo(() => {
    if (packingExt?.items?.length) {
      return packingExt.items.map((it, idx) => ({
        lineNo: idx + 1,
        desc: it.fields.description?.value || `Item ${idx + 1}`,
        pkgs: it.fields.packages?.value || "",
        qty: it.fields.quantity?.value || "",
        unit: it.fields.unit?.value || "KG",
        nw: it.fields.net_weight?.value || "",
        gw: it.fields.gross_weight?.value || "",
      }));
    }
    return importRecord.items.map((it) => ({
      lineNo: it.line_no,
      desc: it.normalized_description || it.raw_description,
      pkgs: "",
      qty: it.quantity ? String(it.quantity) : "",
      unit: it.unit || "KG",
      nw: "",
      gw: "",
    }));
  }, [packingExt, importRecord]);

  const blItems = useMemo(() => {
    if (blExt?.items?.length) {
      return blExt.items.map((it, idx) => ({
        lineNo: idx + 1,
        container: it.fields.container?.value || importRecord.items[0]?.raw_description || "—",
        seal: it.fields.seal?.value || "—",
        desc: it.fields.description?.value || it.fields.cargo_summary?.value || `Cargo item ${idx + 1}`,
        pkgs: it.fields.packages?.value || "—",
        gw: it.fields.gross_weight?.value || "—",
        meas: it.fields.measurement?.value || "—",
      }));
    }
    return [
      {
        lineNo: 1,
        container: getField("container"),
        seal: getField("seal"),
        desc:
          getField("cargo_summary") !== "—"
            ? getField("cargo_summary")
            : "SAID TO CONTAIN GENERAL CARGO",
        pkgs: getField("packages"),
        gw: getField("gross_weight"),
        meas: getField("measurement"),
      },
    ];
  }, [blExt, importRecord, getField]);

  const filteredInvoiceItems = useMemo(() => {
    if (!searchQuery.trim()) return invoiceItems;
    const q = searchQuery.toLowerCase();
    return invoiceItems.filter(
      (it) => it.desc.toLowerCase().includes(q) || it.unitPrice.includes(q) || it.amount.includes(q)
    );
  }, [invoiceItems, searchQuery]);

  const filteredPackingItems = useMemo(() => {
    if (!searchQuery.trim()) return packingItems;
    const q = searchQuery.toLowerCase();
    return packingItems.filter(
      (it) => it.desc.toLowerCase().includes(q) || it.pkgs.includes(q) || it.gw.includes(q)
    );
  }, [packingItems, searchQuery]);

  const filteredBlItems = useMemo(() => {
    if (!searchQuery.trim()) return blItems;
    const q = searchQuery.toLowerCase();
    return blItems.filter(
      (it) =>
        it.desc.toLowerCase().includes(q) ||
        it.container.toLowerCase().includes(q) ||
        it.seal.toLowerCase().includes(q)
    );
  }, [blItems, searchQuery]);

  const selectedMaster =
    analysis?.selected_master ?? analysis?.analyzed_master ?? (versions.length > 0 ? versions[0] : null);

  const docSwitcherButtons = (
    <div role="group" aria-label="Print document" className="flex gap-1">
      <Button
        type="button"
        size="xs"
        variant={docTab === "inv" ? "default" : "outline"}
        aria-label="INV (Invoice)"
        aria-pressed={docTab === "inv"}
        onClick={() => setDocTab("inv")}
      >
        INV
      </Button>
      <Button
        type="button"
        size="xs"
        variant={docTab === "pl" ? "default" : "outline"}
        aria-label="PL (Packing List)"
        aria-pressed={docTab === "pl"}
        onClick={() => setDocTab("pl")}
      >
        PL
      </Button>
      <Button
        type="button"
        size="xs"
        variant={docTab === "bl" ? "default" : "outline"}
        aria-label="BL (Bill of Lading)"
        aria-pressed={docTab === "bl"}
        onClick={() => setDocTab("bl")}
      >
        BL
      </Button>
    </div>
  );

  return (
    <ResizableSplit
      role="region"
      aria-label="Document Review Studio"
      ariaLabel="Resize document particulars and PDF preview"
      defaultWidth={48}
      minWidth={34}
      maxWidth={74}
      storageKey="harborway:import:doc-split"
      dividerHeightClassName="lg:h-[calc(100vh-5.5rem)] lg:min-h-[780px] xl:min-h-[880px]"
      left={
        <div className="flex flex-col min-w-0">
          {/* Clean aligned utility row matching right studio header */}
          <div className="flex items-center justify-between h-9 px-1 mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Verified Document Particulars
            </span>
          </div>

          {/* Left Studio Panel Card with Top Underline Tab Bar */}
          <div className="rounded-lg border bg-card shadow-2xs overflow-hidden flex flex-col">
            <nav
              className="flex border-b bg-card/60 px-2 overflow-x-auto no-scrollbar"
              aria-label="Select verified document"
            >
              <button
                type="button"
                onClick={() => setDocTab("inv")}
                aria-pressed={docTab === "inv"}
                className={cn(
                  "cursor-pointer border-b-2 px-3.5 py-2.5 text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap",
                  docTab === "inv"
                    ? "border-primary text-primary font-bold"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <FileText className="size-3.5" />
                <span>Commercial Invoice</span>
                {invItemCount > 0 && (
                  <span className="ml-0.5 font-mono text-[11px] text-muted-foreground/80">
                    {invItemCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setDocTab("pl")}
                aria-pressed={docTab === "pl"}
                className={cn(
                  "cursor-pointer border-b-2 px-3.5 py-2.5 text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap",
                  docTab === "pl"
                    ? "border-primary text-primary font-bold"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <Package className="size-3.5" />
                <span>Packing List</span>
                {plItemCount > 0 && (
                  <span className="ml-0.5 font-mono text-[11px] text-muted-foreground/80">
                    {plItemCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setDocTab("bl")}
                aria-pressed={docTab === "bl"}
                className={cn(
                  "cursor-pointer border-b-2 px-3.5 py-2.5 text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap",
                  docTab === "bl"
                    ? "border-primary text-primary font-bold"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <Anchor className="size-3.5" />
                <span>Bill of Lading</span>
                {blItemCount > 0 && (
                  <span className="ml-0.5 font-mono text-[11px] text-muted-foreground/80">
                    {blItemCount}
                  </span>
                )}
              </button>
            </nav>

            {/* Particulars Metadata Grid */}
            <dl className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-3 text-xs">
              <div className="bg-card px-3.5 py-2.5 space-y-0.5 min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Supplier / Shipper
                </dt>
                <dd className="font-medium text-foreground truncate" title={getField("supplier")}>
                  {getField("supplier")}
                </dd>
              </div>
              <div className="bg-card px-3.5 py-2.5 space-y-0.5 min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Consignee
                </dt>
                <dd className="font-medium text-foreground truncate" title={getField("consignee")}>
                  {getField("consignee")}
                </dd>
              </div>
              <div className="bg-card px-3.5 py-2.5 space-y-0.5 min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  B/L Number
                </dt>
                <dd className="font-mono font-medium text-foreground truncate" title={getField("bl_no")}>
                  {getField("bl_no")}
                </dd>
              </div>
              <div className="bg-card px-3.5 py-2.5 space-y-0.5 min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Invoice Date
                </dt>
                <dd className="font-mono text-foreground truncate">
                  {getField("invoice_date")}
                </dd>
              </div>
              <div className="bg-card px-3.5 py-2.5 space-y-0.5 min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Container &amp; Seal
                </dt>
                <dd className="font-mono text-foreground truncate">
                  {getField("container")} {getField("seal") !== "—" ? `/ ${getField("seal")}` : ""}
                </dd>
              </div>
              <div className="bg-card px-3.5 py-2.5 space-y-0.5 min-w-0">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Delivery / Border
                </dt>
                <dd className="font-medium text-foreground truncate">
                  {getField("port") !== "—" ? getField("port") : getField("destination")}
                </dd>
              </div>
            </dl>

            {/* Line Items Table */}
            <div className="overflow-auto">
              {docTab === "inv" ? (
                <Table className="min-w-[460px] text-xs">
                  <TableHeader>
                    <TableRow className="border-b bg-muted/20">
                      <TableHead className="w-10 text-center font-semibold">#</TableHead>
                      <TableHead className="font-semibold">Description</TableHead>
                      <TableHead className="text-right font-semibold w-20">Quantity</TableHead>
                      <TableHead className="text-left font-semibold w-14">Unit</TableHead>
                      <TableHead className="text-right font-semibold w-24">Price (USD)</TableHead>
                      <TableHead className="text-right font-semibold w-28">Amount (USD)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoiceItems.map((item, idx) => (
                      <TableRow key={idx} className="hover:bg-muted/15">
                        <TableCell className="text-center font-mono text-muted-foreground">
                          {item.lineNo}
                        </TableCell>
                        <TableCell className="font-medium text-foreground max-w-[200px] truncate" title={item.desc}>
                          {item.desc}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatFieldValue(item.qty, "quantity")}
                        </TableCell>
                        <TableCell className="text-left text-muted-foreground">{item.unit}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatFieldValue(item.unitPrice, "unit_price")}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {formatFieldValue(item.amount, "amount")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : docTab === "pl" ? (
                <Table className="min-w-[460px] text-xs">
                  <TableHeader>
                    <TableRow className="border-b bg-muted/20">
                      <TableHead className="w-10 text-center font-semibold">#</TableHead>
                      <TableHead className="font-semibold">Description</TableHead>
                      <TableHead className="text-center font-semibold w-16">Pkgs</TableHead>
                      <TableHead className="text-right font-semibold w-24">Quantity</TableHead>
                      <TableHead className="text-right font-semibold w-24">Net Wt (KG)</TableHead>
                      <TableHead className="text-right font-semibold w-24">Gross Wt (KG)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPackingItems.map((item, idx) => (
                      <TableRow key={idx} className="hover:bg-muted/15">
                        <TableCell className="text-center font-mono text-muted-foreground">
                          {item.lineNo}
                        </TableCell>
                        <TableCell className="font-medium text-foreground max-w-[200px] truncate" title={item.desc}>
                          {item.desc}
                        </TableCell>
                        <TableCell className="text-center font-mono font-semibold tabular-nums">
                          {formatFieldValue(item.pkgs, "packages")}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatFieldValue(item.qty, "quantity")} {item.unit}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatFieldValue(item.nw, "net_weight")}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {formatFieldValue(item.gw, "gross_weight")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Table className="min-w-[460px] text-xs">
                  <TableHeader>
                    <TableRow className="border-b bg-muted/20">
                      <TableHead className="w-10 text-center font-semibold">#</TableHead>
                      <TableHead className="font-semibold w-36">Container / Seal</TableHead>
                      <TableHead className="font-semibold">Description of Goods</TableHead>
                      <TableHead className="text-center font-semibold w-20">Packages</TableHead>
                      <TableHead className="text-right font-semibold w-24">Gross Wt (KG)</TableHead>
                      <TableHead className="text-right font-semibold w-20">Meas.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBlItems.map((item, idx) => (
                      <TableRow key={idx} className="hover:bg-muted/15">
                        <TableCell className="text-center font-mono text-muted-foreground">
                          {item.lineNo}
                        </TableCell>
                        <TableCell className="font-mono text-[11px]">
                          {item.container !== "—" ? `${item.container} / ${item.seal}` : "—"}
                        </TableCell>
                        <TableCell className="font-medium text-foreground max-w-[200px] truncate" title={item.desc}>
                          {item.desc}
                        </TableCell>
                        <TableCell className="text-center font-mono font-semibold tabular-nums">
                          {formatFieldValue(item.pkgs, "packages")}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {formatFieldValue(item.gw, "gross_weight")}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {item.meas}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </div>
      }
      right={
        <div className="flex flex-col min-w-0 lg:sticky lg:top-4">
          {/* Clean aligned utility row above right PDF panel */}
          <div className="flex items-center justify-end gap-2 h-9 px-1 mb-2">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={searchInputId}
                type="text"
                placeholder="Search document fields & line items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 pr-7 text-xs bg-white dark:bg-slate-900 border-border/80 rounded-md focus-visible:ring-1 focus-visible:ring-primary shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>

          <div className="flex min-h-[720px] min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-2xs lg:h-[calc(100vh-5.5rem)] lg:min-h-[820px] xl:min-h-[920px]">
            {docTab === "bl" ? (
              blFile ? (
                <DocumentCanvas
                  embedded
                  showBadges={false}
                  hideExcerptToggle
                  file={blFile}
                  options={blOptions}
                  currentKey={blOptions[0]?.key}
                  headerActions={docSwitcherButtons}
                />
              ) : (
                <div className="flex h-full flex-col">
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
                    <span className="text-xs font-semibold">Bill of Lading</span>
                    {docSwitcherButtons}
                  </div>
                  <div className="flex flex-1 items-center justify-center p-6">
                    <Empty>No original Bill of Lading attachment was found for this import.</Empty>
                  </div>
                </div>
              )
            ) : (
              <PermitDraftPreview
                embedded
                showStatusBadge={false}
                searchQuery={searchQuery}
                sheetTab={docTab}
                onSheetTabChange={(tab) => setDocTab(tab)}
                template={template}
                onTemplateChange={setTemplate}
                invoiceExt={invoiceExt}
                packingExt={packingExt}
                blExt={blExt}
                selectedMaster={selectedMaster}
                mappings={saved?.mappings ?? []}
                candidates={saved?.candidates ?? analysis?.candidates ?? []}
                companyName={importRecord.company}
                reference={importRecord.invoice_no}
                state={importRecord.state}
                lineItems={analysis?.line_items ?? []}
                findings={analysis?.findings ?? []}
              />
            )}
          </div>
        </div>
      }
    />
  );
}
