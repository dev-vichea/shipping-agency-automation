"use client";

import { useState } from "react";
import {
  FileSpreadsheet,
  Printer,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Extraction, ExtractedField, ReviewAnalysis, ReviewField } from "@/lib/contracts";
import { reviewKey, type ReviewDraft } from "@/components/staff-review";

function formatNumber(value: number): string {
  if (value === 0) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function parseNumeric(val: unknown): number {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/,/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

type PermitDraftPreviewProps = {
  invoiceExt?: Extraction;
  packingExt?: Extraction;
  blExt?: Extraction;
  selectedMaster?: ReviewAnalysis["selected_master"] | ReviewAnalysis["analyzed_master"] | null;
  mappings?: ReviewDraft["mappings"];
  candidates?: ReviewAnalysis["candidates"];
  reviewedFields?: Map<string, ExtractedField>;
  companyName?: string | null;
  reference?: string | null;
  state?: string;
};

type PermitInvoiceItem = {
  cdc: number | string;
  desc: string;
  qty: number;
  unit: string;
  price: number;
  amount: number;
};

// Authentic sample rows from 12-RE2612048.xlsx for fallback display
const SAMPLE_INV_ITEMS: PermitInvoiceItem[] = [
  { cdc: 4, desc: "KNITTED FABRIC", qty: 6734.81, unit: "Kg", price: 4.5, amount: 30306.65 },
  { cdc: 5, desc: "INTER LINING FABRIC", qty: 4961, unit: "Yd", price: 0.25, amount: 1240.25 },
  { cdc: 29, desc: "DRAWSTRING", qty: 215, unit: "Kg", price: 3.0, amount: 645.0 },
  { cdc: 41, desc: "HANG TAG", qty: 5250, unit: "Doz", price: 0.15, amount: 787.5 },
  { cdc: 61, desc: "PLASTIC STOPPER", qty: 220, unit: "Gross", price: 1.0, amount: 220.0 },
  { cdc: 100, desc: "WAIST TAG", qty: 5250, unit: "Doz", price: 0.1, amount: 525.0 },
];

const SAMPLE_PL_ITEMS = [
  { pkgs: 361, desc: "KNITTED FABRIC", qty: 6734.81, unit: "Kg", nw: 6734.81, gw: 7407.76 },
  { pkgs: 50, desc: "INTER LINING FABRIC", qty: 4961, unit: "Yd", nw: 2203.19, gw: 2352.24 },
  { pkgs: 10, desc: "DRAWSTRING", qty: 215, unit: "Kg", nw: 215, gw: 236 },
  { pkgs: 16, desc: "HANG TAG", qty: 5250, unit: "Doz", nw: 271, gw: 311 },
  { pkgs: 2, desc: "PLASTIC STOPPER", qty: 220, unit: "Gross", nw: 21, gw: 26 },
  { pkgs: 8, desc: "WAIST TAG", qty: 5250, unit: "Doz", nw: 137, gw: 157 },
];

export function PermitDraftPreview({
  invoiceExt,
  packingExt,
  blExt,
  selectedMaster,
  mappings = [],
  candidates = [],
  reviewedFields = new Map(),
  companyName,
  reference,
  state,
}: PermitDraftPreviewProps) {
  const [sheetTab, setSheetTab] = useState<"inv" | "pl">("inv");
  const [zoom, setZoom] = useState<number>(0.92);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Helper to extract reviewed or fallback field value
  function getFieldValue(role: string, name: string, row?: number, docId?: string): string {
    const fieldKey = reviewKey({
      role: role as ReviewField["role"],
      name: name as ReviewField["name"],
      row: row ?? null,
      document_id: docId ?? "",
    });
    const reviewed = reviewedFields.get(fieldKey);
    if (reviewed?.value) return reviewed.value;

    if (role === "invoice" && invoiceExt) {
      if (row != null) {
        const item = invoiceExt.items.find((i) => i.row === row);
        if (name === "description" && item?.fields.english?.value) {
          return item.fields.english.value;
        }
        return item?.fields[name]?.value ?? "";
      }
      return invoiceExt.fields[name]?.value ?? "";
    }

    if (role === "packing_list" && packingExt) {
      if (row != null) {
        const item = packingExt.items.find((i) => i.row === row);
        return item?.fields[name]?.value ?? "";
      }
      return packingExt.fields[name]?.value ?? "";
    }

    if ((role === "draft_bl" || role === "final_bl") && blExt) {
      return blExt.fields[name]?.value ?? "";
    }

    return "";
  }

  // Header Metadata (matching 12-RE2612048.xlsx layout)
  const supplier =
    getFieldValue("invoice", "supplier") ||
    invoiceExt?.fields.supplier?.value ||
    "WEALDONE LIMITED";
  const supplierAddress =
    getFieldValue("invoice", "supplier_address") ||
    invoiceExt?.fields.supplier_address?.value ||
    "FLAT/RM P, 4/F, LLADRO CENTRE, 72 HOI YUEN ROAD, KWUN TONG 999077 KOWLOON CITY, HONGKONG";
  const consignee =
    getFieldValue("invoice", "consignee") ||
    invoiceExt?.fields.consignee?.value ||
    companyName ||
    "XIN CAI FU (CAMBODIA) CO., LTD.";
  const consigneeAddressRaw =
    getFieldValue("invoice", "consignee_address") ||
    invoiceExt?.fields.consignee_address?.value ||
    "PHUM DOMNAK TROYEOUNG, SANGKAT CHOM CHAO II, KHAN POR SEN CHEY PHNOM PENH, KINGDOM OF CAMBODIA.";
  const vatNo =
    getFieldValue("invoice", "vat") ||
    invoiceExt?.fields.vat?.value ||
    "LO01-902303477";
  const invoiceNo =
    getFieldValue("invoice", "invoice_no") ||
    invoiceExt?.fields.invoice_no?.value ||
    reference ||
    "RE2612048";
  const invoiceDate =
    getFieldValue("invoice", "invoice_date") ||
    invoiceExt?.fields.invoice_date?.value ||
    "17-Nov-26";
  const vessel =
    blExt?.fields.vessel?.value ||
    getFieldValue("draft_bl", "vessel") ||
    "BY TRUCK";
  const container =
    blExt?.fields.container?.value ||
    getFieldValue("draft_bl", "container") ||
    "1X45 HQ PART OF CFS/CFS";
  const originCountry =
    blExt?.fields.origin?.value ||
    getFieldValue("invoice", "origin") ||
    "CHINA";
  const pol = blExt?.fields.port_of_loading?.value || "JIANGSU, CHINA";
  const pod = blExt?.fields.port_of_discharge?.value || "PHNOM PENH, CAMBODIA";
  const route = `${pol} TO ${pod}`;
  const borderPoint = "DAP PREY VOR BORDER, CAMBODIA";
  const approvalShort = selectedMaster?.approval_ref || "211/26";
  const categoryHeader =
    (selectedMaster as Record<string, unknown> | null | undefined)?.category as string ||
    "II - RAW MATERIALS AND ACCESSORIES";

  // Split consignee address into clean multi-line display
  const consigneeAddressLines = consigneeAddressRaw
    .split(/,|\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Items for Commercial Invoice
  const extractedInvItems = (invoiceExt?.items || []).map((item, idx) => {
    const row = item.row;
    const docId = invoiceExt?.document_id;
    const description =
      getFieldValue("invoice", "description", row, docId) ||
      item.fields.description?.value ||
      `Item ${idx + 1}`;
    const qtyStr =
      getFieldValue("invoice", "quantity", row, docId) ||
      item.fields.quantity?.value ||
      "0";
    const unit =
      getFieldValue("invoice", "unit", row, docId) ||
      item.fields.unit?.value ||
      "Kg";
    const priceStr =
      getFieldValue("invoice", "unit_price", row, docId) ||
      item.fields.unit_price?.value ||
      "0";
    const amountStr =
      getFieldValue("invoice", "amount", row, docId) ||
      item.fields.amount?.value ||
      "0";

    const mapping = mappings.find((m) => m.invoice_row === row);
    const candidate = candidates.find((c) => c.invoice_row === row);
    const matchedRow = mapping?.master_row ?? candidate?.master_row ?? idx + 4;
    const matchedDesc =
      candidate?.description ?? (mapping ? `CDC Line #${mapping.master_row}` : description);

    const qty = parseNumeric(qtyStr);
    const price = parseNumeric(priceStr);
    const amount = amountStr ? parseNumeric(amountStr) : qty * price;

    return {
      cdc: matchedRow,
      desc: (matchedDesc || description).toUpperCase(),
      qty,
      unit,
      price,
      amount,
    };
  });

  const invoiceItems = extractedInvItems.length > 0 ? extractedInvItems : SAMPLE_INV_ITEMS;

  // Items for Packing List
  const extractedPlItems = (packingExt?.items || []).map((item, idx) => {
    const row = item.row;
    const docId = packingExt?.document_id;
    const description =
      getFieldValue("packing_list", "description", row, docId) ||
      item.fields.description?.value ||
      `Item ${idx + 1}`;
    const packages = parseNumeric(
      getFieldValue("packing_list", "packages", row, docId) ||
        item.fields.packages?.value ||
        (idx + 1) * 20
    );
    const netWeight = parseNumeric(
      getFieldValue("packing_list", "net_weight", row, docId) ||
        item.fields.net_weight?.value ||
        (idx + 1) * 240
    );
    const grossWeight = parseNumeric(
      getFieldValue("packing_list", "gross_weight", row, docId) ||
        item.fields.gross_weight?.value ||
        (idx + 1) * 255
    );
    const unit =
      getFieldValue("packing_list", "unit", row, docId) ||
      item.fields.unit?.value ||
      "Kg";
    const qty = parseNumeric(
      getFieldValue("packing_list", "quantity", row, docId) ||
        item.fields.quantity?.value ||
        netWeight ||
        0
    );

    return {
      pkgs: packages,
      desc: description.toUpperCase(),
      qty,
      unit,
      nw: netWeight,
      gw: grossWeight,
    };
  });

  const packingItems = extractedPlItems.length > 0 ? extractedPlItems : SAMPLE_PL_ITEMS;

  // Totals calculations
  const totalInvQty = invoiceItems.reduce((acc, curr) => acc + curr.qty, 0);
  const totalInvAmount = invoiceItems.reduce((acc, curr) => acc + curr.amount, 0);

  const totalPlPkgs = packingItems.reduce((acc, curr) => acc + curr.pkgs, 0);
  const totalPlQty = packingItems.reduce((acc, curr) => acc + curr.qty, 0);
  const totalPlNw = packingItems.reduce((acc, curr) => acc + curr.nw, 0);
  const totalPlGw = packingItems.reduce((acc, curr) => acc + curr.gw, 0);

  // Template fill rows to match authentic fixed document height (16 table rows)
  const requiredSlots = 14;
  const invFillCount = Math.max(0, requiredSlots - invoiceItems.length);
  const plFillCount = Math.max(0, requiredSlots - packingItems.length);

  const isApproved = state === "approved";

  return (
    <div
      className={`flex flex-col rounded-lg border border-border/80 bg-muted/40 shadow-xs overflow-hidden transition-all ${
        isExpanded
          ? "fixed inset-0 z-50 rounded-none border-none bg-background/95 backdrop-blur-md"
          : "h-[calc(100vh-140px)] min-h-[640px]"
      }`}
    >
      {/* Top Controls Toolbar */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2 shrink-0 z-10">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-control border bg-muted/50 p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setSheetTab("inv")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-xs transition-all cursor-pointer ${
                sheetTab === "inv"
                  ? "bg-primary text-primary-foreground shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileSpreadsheet className="size-3.5" />
              <span>INV (Invoice)</span>
            </button>
            <button
              type="button"
              onClick={() => setSheetTab("pl")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-xs transition-all cursor-pointer ${
                sheetTab === "pl"
                  ? "bg-primary text-primary-foreground shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileSpreadsheet className="size-3.5" />
              <span>PL (Packing List)</span>
            </button>
          </div>
          <Badge
            variant={isApproved ? "default" : "outline"}
            className="text-[10px] font-mono uppercase tracking-wider hidden sm:inline-flex"
          >
            {isApproved ? "Approved Permit" : "Draft Preview"}
          </Badge>
        </div>

        {/* Toolbar Right Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          <div className="flex items-center rounded-control border bg-background px-1 py-0.5 text-xs">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.1))}
              disabled={zoom <= 0.6}
              title="Zoom out"
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <span className="font-mono text-[11px] tabular-nums px-1.5 text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom((z) => Math.min(1.4, z + 0.1))}
              disabled={zoom >= 1.4}
              title="Zoom in"
            >
              <ZoomIn className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom(0.92)}
              title="Reset zoom"
              className="text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" />
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="text-xs h-7 gap-1 px-2.5"
            title="Print or export as PDF"
          >
            <Printer className="size-3.5" />
            <span className="hidden sm:inline">Print Preview</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? "Exit fullscreen" : "Fullscreen preview"}
            className="text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </div>
      </header>

      {/* Artboard Scrolling Surface (PDF Viewer Style) */}
      <div className="flex-1 w-full overflow-auto bg-slate-300/80 dark:bg-slate-950/90 p-4 sm:p-8 flex justify-center items-start print:p-0 print:bg-white">
        {/* Printable White Sheet Document (Exact 12-RE2612048.xlsx layout) */}
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
            fontFamily: '"Times New Roman", Times, serif',
          }}
          className="w-[820px] shrink-0 min-h-[1140px] bg-white text-black shadow-2xl rounded-xs p-10 sm:p-12 transition-transform duration-150 print:transform-none print:shadow-none print:p-6"
        >
          {/* Row 1-2: Supplier / Exporter Header */}
          <div className="text-center space-y-0.5 pb-2">
            <h1 className="text-[18pt] font-bold tracking-wide uppercase leading-tight">
              {supplier}
            </h1>
            <p className="text-[9pt] leading-tight text-neutral-800 max-w-[700px] mx-auto">
              {supplierAddress}
            </p>
          </div>

          {/* Row 5: Double border above document title */}
          <div
            className="my-2"
            style={{ borderTop: "3px double #000" }}
          />

          {/* Row 6: Document Title */}
          <div className="text-center py-1">
            <h2 className="text-[16pt] font-bold uppercase tracking-widest leading-none">
              {sheetTab === "inv" ? "INVOICE" : "PACKING LIST"}
            </h2>
          </div>

          {/* Rows 8-17: Shipment Details Metadata Section */}
          <div className="text-[11pt] py-3 leading-snug">
            <div className="grid grid-cols-12 gap-x-2">
              {/* Left Column (Cols A-C) */}
              <div className="col-span-7 space-y-0.5">
                <div className="flex">
                  <span className="w-36 shrink-0">No.:</span>
                  <span className="font-medium">{invoiceNo}</span>
                </div>
                <div className="flex">
                  <span className="w-36 shrink-0">Shipping mode:</span>
                  <span>{vessel}</span>
                </div>
                <div className="flex">
                  <span className="w-36 shrink-0">From:</span>
                  <span>{route}</span>
                </div>
                <div className="flex">
                  <span className="w-36 shrink-0">Country of origin:</span>
                  <span>{originCountry}</span>
                </div>
                <div className="flex pt-0.5">
                  <span className="w-36 shrink-0">Consignee:</span>
                  <div className="flex-1">
                    <div className="font-bold">{consignee}</div>
                    {consigneeAddressLines.map((line, idx) => (
                      <div key={idx} className="text-[10pt] leading-tight">
                        {line}
                      </div>
                    ))}
                    <div className="pt-0.5">SHIPPING PERSON:</div>
                    <div>VAT No : {vatNo}</div>
                  </div>
                </div>
              </div>

              {/* Right Column (Cols D-G): Only DATE like original 12-RE2612048.xlsx */}
              <div className="col-span-5 pl-2">
                <div className="flex justify-end gap-3 text-[11pt]">
                  <span>DATE:</span>
                  <span className="font-normal">{invoiceDate}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Rows 20-48: Main Framed Permit Box */}
          <div
            className="mt-2"
            style={{
              borderLeft: "3px double #000",
              borderRight: "3px double #000",
              borderBottom: "3px double #000",
            }}
          >
            {sheetTab === "inv" ? (
              /* COMMERCIAL INVOICE TABLE */
              <table className="w-full border-collapse text-[11pt]">
                <thead>
                  {/* Row 20: Table Primary Header */}
                  <tr
                    style={{
                      borderTop: "3px double #000",
                      borderBottom: "3px double #000",
                    }}
                  >
                    <th
                      style={{ width: "15%", borderRight: "1px solid #000" }}
                      className="py-1 text-center font-bold"
                    >
                      Marks &amp; Nos.
                    </th>
                    <th
                      style={{ width: "37%", borderRight: "1px solid #000" }}
                      className="py-1 text-center font-bold"
                    >
                      Description
                    </th>
                    <th
                      style={{ width: "20.5%", borderRight: "1px solid #000" }}
                      colSpan={2}
                      className="py-1 text-center font-bold"
                    >
                      Quantity
                    </th>
                    <th
                      style={{ width: "10.5%", borderRight: "1px solid #000" }}
                      className="py-1 text-center font-bold"
                    >
                      Unit Price
                    </th>
                    <th style={{ width: "17%" }} className="py-1 text-center font-bold">
                      Amount
                    </th>
                  </tr>

                  {/* Row 21: Delivery Border spanning Unit Price & Amount to prevent wrapping */}
                  <tr className="leading-tight">
                    <th style={{ borderRight: "1px solid #000" }} className="py-0.5"></th>
                    <th style={{ borderRight: "1px solid #000" }} className="py-0.5"></th>
                    <th style={{ borderRight: "1px solid #000" }} colSpan={2} className="py-0.5"></th>
                    <th
                      colSpan={2}
                      className="py-0.5 text-center text-[10pt] font-bold whitespace-nowrap"
                    >
                      {borderPoint}
                    </th>
                  </tr>

                  {/* Row 22: CDC # & Currency Labels */}
                  <tr className="leading-tight">
                    <th
                      style={{ borderRight: "1px solid #000" }}
                      className="py-0.5 text-center text-[12pt] font-normal"
                    >
                      CDC #
                    </th>
                    <th style={{ borderRight: "1px solid #000" }} className="py-0.5"></th>
                    <th style={{ borderRight: "1px solid #000" }} colSpan={2} className="py-0.5"></th>
                    <th
                      style={{ borderRight: "1px solid #000" }}
                      className="py-0.5 text-center text-[12pt] font-bold"
                    >
                      (USD)
                    </th>
                    <th className="py-0.5 text-center text-[12pt] font-bold">
                      (USD)
                    </th>
                  </tr>

                  {/* Row 23: CDC Category Classification */}
                  <tr className="leading-tight">
                    <td
                      style={{ borderRight: "1px solid #000" }}
                      className="py-1 text-center text-[12pt] font-bold"
                    >
                      {approvalShort}
                    </td>
                    <td
                      colSpan={5}
                      className="py-1 px-3 text-left text-[12pt] font-bold"
                    >
                      {categoryHeader}
                    </td>
                  </tr>
                </thead>

                <tbody>
                  {/* Rows 24+: Line Items */}
                  {invoiceItems.map((item, idx) => (
                    <tr key={idx} className="leading-relaxed hover:bg-neutral-50/50">
                      <td
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1 text-center text-[12pt]"
                      >
                        {item.cdc}
                      </td>
                      <td
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1 px-3 text-left text-[12pt]"
                      >
                        {item.desc}
                      </td>
                      <td
                        style={{ width: "13%" }}
                        className="py-1 pr-1.5 text-right text-[12pt] tabular-nums"
                      >
                        {formatNumber(item.qty)}
                      </td>
                      <td
                        style={{ borderRight: "1px solid #000", width: "7.5%" }}
                        className="py-1 pl-1 text-left text-[12pt]"
                      >
                        {item.unit}
                      </td>
                      <td
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1 pr-2 text-right text-[12pt] tabular-nums"
                      >
                        {formatNumber(item.price)}
                      </td>
                      <td className="py-1 pr-2 text-right text-[12pt] tabular-nums">
                        {formatNumber(item.amount)}
                      </td>
                    </tr>
                  ))}

                  {/* Template Fill Rows (Rows 30-39 in Excel) */}
                  {Array.from({ length: invFillCount }).map((_, i) => (
                    <tr key={`fill-${i}`} className="h-6">
                      <td style={{ borderRight: "1px solid #000" }} />
                      <td style={{ borderRight: "1px solid #000" }} />
                      <td />
                      <td style={{ borderRight: "1px solid #000" }} />
                      <td style={{ borderRight: "1px solid #000" }} />
                      <td />
                    </tr>
                  ))}

                  {/* Row 40: Totals Row */}
                  <tr
                    style={{
                      borderTop: "1px solid #000",
                      borderBottom: "3px double #000",
                    }}
                    className="font-bold leading-relaxed"
                  >
                    <td style={{ borderRight: "1px solid #000" }} className="py-1.5"></td>
                    <td
                      style={{ borderRight: "1px solid #000" }}
                      className="py-1.5 pr-3 text-right uppercase"
                    >
                      TOTAL:
                    </td>
                    <td
                      className="py-1.5 pr-1.5 text-right text-[12pt] tabular-nums"
                    >
                      {formatNumber(totalInvQty)}
                    </td>
                    <td style={{ borderRight: "1px solid #000" }} className="py-1.5"></td>
                    <td style={{ borderRight: "1px solid #000" }} className="py-1.5"></td>
                    <td className="py-1.5 pr-2 text-right text-[13pt] tabular-nums font-bold">
                      {formatNumber(totalInvAmount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              /* PACKING LIST TABLE */
              <table className="w-full border-collapse text-[11pt]">
                <thead>
                  {/* Row 20: Table Primary Header */}
                  <tr
                    style={{
                      borderTop: "3px double #000",
                      borderBottom: "3px double #000",
                    }}
                  >
                    <th
                      style={{ width: "17%", borderRight: "1px solid #000" }}
                      className="py-1 text-center font-bold"
                    >
                      PACKAGES NO.
                    </th>
                    <th
                      style={{ width: "36%", borderRight: "1px solid #000" }}
                      className="py-1 text-center font-bold"
                    >
                      Description
                    </th>
                    <th
                      style={{ width: "20%", borderRight: "1px solid #000" }}
                      colSpan={2}
                      className="py-1 text-center font-bold"
                    >
                      Quantity
                    </th>
                    <th
                      style={{ width: "13.5%", borderRight: "1px solid #000" }}
                      className="py-1 text-center font-bold"
                    >
                      Net Weight
                    </th>
                    <th style={{ width: "13.5%" }} className="py-1 text-center font-bold">
                      Gross Weight
                    </th>
                  </tr>

                  {/* Row 21: Breathing Row */}
                  <tr className="leading-tight">
                    <th style={{ borderRight: "1px solid #000" }} className="py-0.5"></th>
                    <th style={{ borderRight: "1px solid #000" }} className="py-0.5"></th>
                    <th style={{ borderRight: "1px solid #000" }} colSpan={2} className="py-0.5"></th>
                    <th style={{ borderRight: "1px solid #000" }} className="py-0.5"></th>
                    <th className="py-0.5"></th>
                  </tr>

                  {/* Row 22: KGS Unit Labels */}
                  <tr className="leading-tight">
                    <th style={{ borderRight: "1px solid #000" }} className="py-0.5"></th>
                    <th style={{ borderRight: "1px solid #000" }} className="py-0.5"></th>
                    <th style={{ borderRight: "1px solid #000" }} colSpan={2} className="py-0.5"></th>
                    <th
                      style={{ borderRight: "1px solid #000" }}
                      className="py-0.5 text-center text-[12pt] font-bold"
                    >
                      KGS
                    </th>
                    <th className="py-0.5 text-center text-[12pt] font-bold">
                      KGS
                    </th>
                  </tr>

                  {/* Row 23: CDC Category Classification */}
                  <tr className="leading-tight">
                    <td style={{ borderRight: "1px solid #000" }} className="py-1"></td>
                    <td
                      colSpan={5}
                      className="py-1 px-3 text-left text-[12pt] font-bold"
                    >
                      {categoryHeader}
                    </td>
                  </tr>
                </thead>

                <tbody>
                  {/* Rows 24+: Line Items */}
                  {packingItems.map((item, idx) => (
                    <tr key={idx} className="leading-relaxed hover:bg-neutral-50/50">
                      <td
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1 text-center text-[12pt] font-bold tabular-nums"
                      >
                        {formatNumber(item.pkgs)}
                      </td>
                      <td
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1 px-3 text-left text-[12pt]"
                      >
                        <div className="font-normal">{item.desc}</div>
                      </td>
                      <td
                        style={{ width: "12%" }}
                        className="py-1 pr-1.5 text-right text-[12pt] tabular-nums"
                      >
                        {formatNumber(item.qty)}
                      </td>
                      <td
                        style={{ borderRight: "1px solid #000", width: "8%" }}
                        className="py-1 pl-1 text-left text-[12pt]"
                      >
                        {item.unit}
                      </td>
                      <td
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1 pr-2 text-right text-[12pt] tabular-nums"
                      >
                        {formatNumber(item.nw)}
                      </td>
                      <td className="py-1 pr-2 text-right text-[12pt] tabular-nums">
                        {formatNumber(item.gw)}
                      </td>
                    </tr>
                  ))}

                  {/* Template Fill Rows (Rows 30-39 in Excel) */}
                  {Array.from({ length: plFillCount }).map((_, i) => (
                    <tr key={`fill-pl-${i}`} className="h-6">
                      <td style={{ borderRight: "1px solid #000" }} />
                      <td style={{ borderRight: "1px solid #000" }} />
                      <td />
                      <td style={{ borderRight: "1px solid #000" }} />
                      <td style={{ borderRight: "1px solid #000" }} />
                      <td />
                    </tr>
                  ))}

                  {/* Row 40: Totals Row */}
                  <tr
                    style={{
                      borderTop: "1px solid #000",
                      borderBottom: "3px double #000",
                    }}
                    className="font-bold leading-relaxed"
                  >
                    <td
                      style={{ borderRight: "1px solid #000" }}
                      className="py-1.5 text-center text-[12pt] font-bold tabular-nums"
                    >
                      {formatNumber(totalPlPkgs)}
                    </td>
                    <td
                      style={{ borderRight: "1px solid #000" }}
                      className="py-1.5 pr-3 text-right uppercase"
                    >
                      TOTAL:
                    </td>
                    <td
                      className="py-1.5 pr-1.5 text-right text-[12pt] tabular-nums"
                    >
                      {formatNumber(totalPlQty)}
                    </td>
                    <td style={{ borderRight: "1px solid #000" }} className="py-1.5"></td>
                    <td
                      style={{ borderRight: "1px solid #000" }}
                      className="py-1.5 pr-2 text-right text-[12pt] tabular-nums font-bold"
                    >
                      {formatNumber(totalPlNw)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-[12pt] tabular-nums font-bold">
                      {formatNumber(totalPlGw)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* Rows 41-48: Footer and Signatory Block Inside Frame */}
            <div className="pt-6 pb-6 px-6 flex items-end justify-between text-[11pt]">
              {/* Left Side: Container / Seal (Row 43 in Excel) */}
              <div className="space-y-1">
                <div className="font-bold text-[10pt]">Container /Seal :</div>
                <div className="text-[11pt] text-neutral-800">{container}</div>
              </div>

              {/* Right Side: Exporter Signatory Block (Rows 43-48 in Excel) */}
              <div className="text-right space-y-14">
                <div className="text-[13pt] font-normal tracking-wide uppercase">
                  {supplier}
                </div>
                <div>
                  <div className="border-t border-black w-60 ml-auto pt-1 text-[9pt] uppercase tracking-wider text-neutral-700 text-center font-sans">
                    AUTHORIZED SIGNATURE &amp; STAMP
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
