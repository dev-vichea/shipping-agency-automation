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
import type { Extraction, ExtractedField, ReviewAnalysis, ReviewField } from "@/lib/contracts";
import { reviewKey, type ReviewDraft } from "@/components/staff-review";

export type PermitTemplate = "cdc_classic" | "freight_agency" | "commercial_billing";

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

function numberToWordsUSD(amount: number): string {
  if (amount <= 0 || isNaN(amount)) return "US Dollars Zero Only";

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
  ];

  function convertGroup(n: number): string {
    let str = "";
    if (n >= 100) {
      str += ones[Math.floor(n / 100)] + " Hundred ";
      n %= 100;
    }
    if (n >= 20) {
      str += tens[Math.floor(n / 10)];
      if (n % 10 > 0) {
        str += "-" + ones[n % 10];
      }
      str += " ";
    } else if (n > 0) {
      str += ones[n] + " ";
    }
    return str.trim();
  }

  const whole = Math.floor(amount);
  const cents = Math.round((amount - whole) * 100);

  const billions = Math.floor(whole / 1000000000);
  const millions = Math.floor((whole % 1000000000) / 1000000);
  const thousands = Math.floor((whole % 1000000) / 1000);
  const remainder = whole % 1000;

  let words = "";
  if (billions > 0) words += convertGroup(billions) + " Billion ";
  if (millions > 0) words += convertGroup(millions) + " Million ";
  if (thousands > 0) words += convertGroup(thousands) + " Thousand ";
  if (remainder > 0 || words === "") words += convertGroup(remainder) + " ";

  words = words.trim();
  if (cents > 0) {
    return `US Dollars ${words} and Cents ${convertGroup(cents)} Only`;
  }
  return `US Dollars ${words} Only`;
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
  const [template, setTemplate] = useState<PermitTemplate>("cdc_classic");
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
  const blNo =
    blExt?.fields.bl_no?.value ||
    getFieldValue("draft_bl", "bl_no") ||
    "KEEPNH19080037";
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

  // Template fill rows to match authentic fixed document height (14 table rows)
  const requiredSlots = 14;
  const invFillCount = Math.max(0, requiredSlots - invoiceItems.length);
  const plFillCount = Math.max(0, requiredSlots - packingItems.length);

  // Fill counts for freight agency & commercial billing templates to ensure full-page presence
  const freightInvFillCount = Math.max(0, 11 - invoiceItems.length);
  const freightPlFillCount = Math.max(0, 11 - packingItems.length);
  const billingInvFillCount = Math.max(0, 9 - invoiceItems.length);
  const billingPlFillCount = Math.max(0, 9 - packingItems.length);

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
        <div className="flex flex-wrap items-center gap-2">
          {/* Sheet Switcher */}
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

          {/* Template Selector Dropdown */}
          <div className="flex items-center gap-1.5 border-l pl-2 text-xs">
            <span className="text-[11px] font-medium text-muted-foreground hidden sm:inline">
              Template:
            </span>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as PermitTemplate)}
              className="h-7 rounded-control border border-input bg-background px-2 text-xs font-medium text-foreground cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-primary shadow-2xs"
            >
              <option value="cdc_classic">CDC Classic (12-RE2612048)</option>
              <option value="freight_agency">Freight Agency (Global Wing Format)</option>
              <option value="commercial_billing">Commercial Billing (Corporate Standard)</option>
            </select>
          </div>

          {/* Clean Monochrome Status Pill */}
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground border px-2 py-0.5 rounded-xs hidden lg:inline">
            {isApproved ? "Approved Record" : "Draft Preview"}
          </span>
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

      {/* Artboard Scrolling Surface (Monochrome PDF Viewer) */}
      <div className="flex-1 w-full overflow-auto bg-neutral-200/90 dark:bg-neutral-900/95 p-4 sm:p-8 flex justify-center items-start print:p-0 print:bg-white">
        {/* Printable White Sheet Document */}
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
            fontFamily:
              template === "cdc_classic"
                ? '"Times New Roman", Times, serif'
                : 'Arial, "Helvetica Neue", Helvetica, sans-serif',
          }}
          className="w-[820px] shrink-0 min-h-[1140px] bg-white text-black shadow-2xl rounded-xs p-10 sm:p-12 transition-transform duration-150 print:transform-none print:shadow-none print:p-6"
        >
          {/* ============================================================== */}
          {/* TEMPLATE 1: CDC CLASSIC (Exact 12-RE2612048.xlsx Format)     */}
          {/* ============================================================== */}
          {template === "cdc_classic" && (
            <>
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
              <div className="my-2" style={{ borderTop: "3px double #000" }} />

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

                      {/* Row 21: Delivery Border spanning Unit Price & Amount */}
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
                          {/* Quantity value with NO vertical line before unit */}
                          <td
                            style={{ width: "13%" }}
                            className="py-1 pr-1.5 text-right text-[12pt] tabular-nums"
                          >
                            {formatNumber(item.qty)}
                          </td>
                          {/* Unit cell with outer divider to price */}
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
                        <td className="py-1.5 pr-1.5 text-right text-[12pt] tabular-nums">
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
                            {item.desc}
                          </td>
                          {/* Quantity value with NO line before unit */}
                          <td
                            style={{ width: "12%" }}
                            className="py-1 pr-1.5 text-right text-[12pt] tabular-nums"
                          >
                            {formatNumber(item.qty)}
                          </td>
                          {/* Unit cell with outer divider to weight */}
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
                        <td className="py-1.5 pr-1.5 text-right text-[12pt] tabular-nums">
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
            </>
          )}

          {/* ============================================================== */}
          {/* TEMPLATE 2: FREIGHT AGENCY (Global Wing Cam Pte Ltd Format)    */}
          {/* ============================================================== */}
          {template === "freight_agency" && (
            <div className="space-y-3 text-[10pt]">
              {/* Centered Agency / Exporter Header */}
              <div className="text-center space-y-0.5">
                <h1 className="text-[17pt] font-black uppercase tracking-wider text-black">
                  {supplier}
                </h1>
                <p className="text-[9pt] leading-tight text-neutral-800 max-w-[650px] mx-auto">
                  {supplierAddress}
                </p>
                <p className="text-[8.5pt] text-neutral-700">
                  Tel: +855 23 890 781 / 782 &nbsp;&nbsp;&nbsp;&nbsp; Fax: +855 23 890 783
                </p>
              </div>

              {/* Thin Separator and VAT Line */}
              <div className="pt-1">
                <div className="border-b border-black" />
                <div className="text-right text-[8.5pt] font-medium text-neutral-800 pt-0.5">
                  VAT TIN No. {vatNo}
                </div>
              </div>

              {/* 2-Column Unboxed Shipping Particulars */}
              <div className="grid grid-cols-12 gap-x-6 text-[9.5pt] pt-1">
                {/* Left Column: Bill to */}
                <div className="col-span-7 space-y-1">
                  <div className="flex items-start">
                    <span className="w-16 shrink-0 font-medium text-neutral-700">Bill to:</span>
                    <div className="flex-1">
                      <div className="font-bold text-black uppercase">{consignee}</div>
                      {consigneeAddressLines.map((line, idx) => (
                        <div key={idx} className="text-[9pt] text-neutral-800 leading-tight">
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center pt-0.5">
                    <span className="w-16 shrink-0 font-medium text-neutral-700">VAT:</span>
                    <span className="font-mono">{vatNo}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="w-16 shrink-0 font-medium text-neutral-700">Attn:</span>
                    <span className="text-neutral-800">Shipping &amp; Import Dept</span>
                  </div>
                </div>

                {/* Right Column: Invoice, Date, ETD, Container, BL */}
                <div className="col-span-5 space-y-1 pl-2">
                  <div className="flex justify-between">
                    <span className="font-medium text-neutral-700">Invoice No:</span>
                    <span className="font-mono font-bold">{invoiceNo}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-neutral-700">Date:</span>
                    <span>{invoiceDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-neutral-700">ETD / Mode:</span>
                    <span>{vessel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-neutral-700">Container:</span>
                    <span className="font-mono text-[9pt]">{container}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium text-neutral-700">B/L No:</span>
                    <span className="font-mono font-bold">{blNo}</span>
                  </div>
                </div>
              </div>

              {/* Centered Document Title */}
              <div className="text-center py-2">
                <h2 className="text-[15pt] font-black uppercase tracking-widest leading-none">
                  {sheetTab === "inv" ? "INVOICE" : "PACKING LIST"}
                </h2>
              </div>

              {/* Full Height Ledger Table with Continuous Vertical Lines */}
              {sheetTab === "inv" ? (
                <table className="w-full border-collapse border border-black text-[9.5pt]">
                  <thead>
                    <tr
                      style={{ borderBottom: "3px double #000" }}
                      className="font-bold text-[9pt] uppercase"
                    >
                      <th style={{ borderRight: "1px solid #000" }} className="py-1 px-1 text-center w-12">
                        S/no.
                      </th>
                      <th style={{ borderRight: "1px solid #000" }} className="py-1 px-3 text-left">
                        DESCRIPTION
                      </th>
                      {/* Quantity & Unit header spanning without dividing line */}
                      <th
                        colSpan={2}
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1 px-2 text-right w-32"
                      >
                        QUANTITY
                      </th>
                      <th style={{ borderRight: "1px solid #000" }} className="py-1 px-2 text-right w-24">
                        UNIT PRICE USD
                      </th>
                      <th className="py-1 px-2 text-right w-28">
                        TOTAL USD
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceItems.map((item, idx) => (
                      <tr key={idx} className="leading-snug">
                        <td
                          style={{ borderRight: "1px solid #000" }}
                          className="py-1.5 text-center font-medium tabular-nums"
                        >
                          {idx + 1}
                        </td>
                        <td
                          style={{ borderRight: "1px solid #000" }}
                          className="py-1.5 px-3 text-left"
                        >
                          {item.desc}
                        </td>
                        {/* Quantity and Unit with NO vertical line in between */}
                        <td className="py-1.5 pr-1 text-right tabular-nums w-20">
                          {formatNumber(item.qty)}
                        </td>
                        <td
                          style={{ borderRight: "1px solid #000" }}
                          className="py-1.5 pl-1 text-left text-neutral-800 w-12"
                        >
                          {item.unit}
                        </td>
                        <td
                          style={{ borderRight: "1px solid #000" }}
                          className="py-1.5 px-2 text-right tabular-nums"
                        >
                          {formatNumber(item.price)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-medium">
                          {formatNumber(item.amount)}
                        </td>
                      </tr>
                    ))}

                    {/* Continuous vertical grid filler rows (Global Wing style) */}
                    {Array.from({ length: freightInvFillCount }).map((_, i) => (
                      <tr key={`freight-fill-inv-${i}`} className="h-6">
                        <td style={{ borderRight: "1px solid #000" }} />
                        <td style={{ borderRight: "1px solid #000" }} />
                        <td />
                        <td style={{ borderRight: "1px solid #000" }} />
                        <td style={{ borderRight: "1px solid #000" }} />
                        <td />
                      </tr>
                    ))}

                    {/* Grand Total Row with double line */}
                    <tr
                      style={{
                        borderTop: "1px solid #000",
                        borderBottom: "3px double #000",
                      }}
                      className="font-bold leading-relaxed"
                    >
                      <td style={{ borderRight: "1px solid #000" }} />
                      <td
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1.5 px-3 text-right uppercase"
                      >
                        GRAND TOTAL :
                      </td>
                      <td className="py-1.5 pr-1 text-right tabular-nums">
                        {formatNumber(totalInvQty)}
                      </td>
                      <td style={{ borderRight: "1px solid #000" }} className="py-1.5 pl-1 text-left">
                        {invoiceItems[0]?.unit || "KG"}
                      </td>
                      <td style={{ borderRight: "1px solid #000" }} />
                      <td className="py-1.5 px-2 text-right tabular-nums font-black text-[10pt]">
                        ${formatNumber(totalInvAmount)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <table className="w-full border-collapse border border-black text-[9.5pt]">
                  <thead>
                    <tr
                      style={{ borderBottom: "3px double #000" }}
                      className="font-bold text-[9pt] uppercase"
                    >
                      <th style={{ borderRight: "1px solid #000" }} className="py-1 px-1 text-center w-12">
                        S/no.
                      </th>
                      <th style={{ borderRight: "1px solid #000" }} className="py-1 px-3 text-left">
                        DESCRIPTION
                      </th>
                      <th style={{ borderRight: "1px solid #000" }} className="py-1 px-2 text-center w-20">
                        PACKAGES
                      </th>
                      <th
                        colSpan={2}
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1 px-2 text-right w-28"
                      >
                        QUANTITY
                      </th>
                      <th style={{ borderRight: "1px solid #000" }} className="py-1 px-2 text-right w-24">
                        GROSS WEIGHT KG
                      </th>
                      <th className="py-1 px-2 text-right w-24">
                        CHRG WEIGHT KG
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {packingItems.map((item, idx) => (
                      <tr key={idx} className="leading-snug">
                        <td
                          style={{ borderRight: "1px solid #000" }}
                          className="py-1.5 text-center font-medium tabular-nums"
                        >
                          {idx + 1}
                        </td>
                        <td
                          style={{ borderRight: "1px solid #000" }}
                          className="py-1.5 px-3 text-left"
                        >
                          {item.desc}
                        </td>
                        <td
                          style={{ borderRight: "1px solid #000" }}
                          className="py-1.5 text-center tabular-nums"
                        >
                          {formatNumber(item.pkgs)}
                        </td>
                        {/* Quantity and Unit with NO vertical line in between */}
                        <td className="py-1.5 pr-1 text-right tabular-nums w-18">
                          {formatNumber(item.qty)}
                        </td>
                        <td
                          style={{ borderRight: "1px solid #000" }}
                          className="py-1.5 pl-1 text-left text-neutral-800 w-10"
                        >
                          {item.unit}
                        </td>
                        <td
                          style={{ borderRight: "1px solid #000" }}
                          className="py-1.5 px-2 text-right tabular-nums"
                        >
                          {formatNumber(item.gw)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-medium">
                          {formatNumber(item.nw)}
                        </td>
                      </tr>
                    ))}

                    {/* Continuous vertical grid filler rows */}
                    {Array.from({ length: freightPlFillCount }).map((_, i) => (
                      <tr key={`freight-fill-pl-${i}`} className="h-6">
                        <td style={{ borderRight: "1px solid #000" }} />
                        <td style={{ borderRight: "1px solid #000" }} />
                        <td style={{ borderRight: "1px solid #000" }} />
                        <td />
                        <td style={{ borderRight: "1px solid #000" }} />
                        <td style={{ borderRight: "1px solid #000" }} />
                        <td />
                      </tr>
                    ))}

                    {/* Grand Total Row with double line */}
                    <tr
                      style={{
                        borderTop: "1px solid #000",
                        borderBottom: "3px double #000",
                      }}
                      className="font-bold leading-relaxed"
                    >
                      <td style={{ borderRight: "1px solid #000" }} />
                      <td
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1.5 px-3 text-right uppercase"
                      >
                        GRAND TOTAL :
                      </td>
                      <td
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1.5 text-center tabular-nums font-bold"
                      >
                        {formatNumber(totalPlPkgs)}
                      </td>
                      <td className="py-1.5 pr-1 text-right tabular-nums">
                        {formatNumber(totalPlQty)}
                      </td>
                      <td style={{ borderRight: "1px solid #000" }} className="py-1.5 pl-1 text-left">
                        {packingItems[0]?.unit || "KG"}
                      </td>
                      <td
                        style={{ borderRight: "1px solid #000" }}
                        className="py-1.5 px-2 text-right tabular-nums font-bold"
                      >
                        {formatNumber(totalPlGw)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-bold">
                        {formatNumber(totalPlNw)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}

              {/* Total Amount in Words (Authentic Cambodian Freight Style) */}
              <div className="pt-3 space-y-0.5">
                <div className="text-[9pt] font-bold uppercase tracking-wider text-black">
                  TOTAL AMOUNT:
                </div>
                <div className="text-[10pt] font-serif italic text-neutral-900 pl-4">
                  &ldquo; {numberToWordsUSD(sheetTab === "inv" ? totalInvAmount : totalPlNw)} &rdquo;
                </div>
              </div>

              {/* Bottom Agency Instructions & Signature (NO border boxes) */}
              <div className="grid grid-cols-2 pt-4 gap-6 text-[9pt]">
                <div className="space-y-1 text-neutral-800">
                  <div className="text-[8.5pt] leading-tight">
                    Cheques should be crossed and made payable to:
                    <div className="font-bold uppercase text-black pt-0.5">{supplier}</div>
                  </div>
                  <div className="text-[8pt] text-neutral-600 pt-1 leading-snug">
                    <div>CDC Duty Exemption under Master List approval #{approvalShort}</div>
                    <div>Port of Delivery: {borderPoint}</div>
                  </div>
                </div>

                <div className="text-right space-y-12">
                  <div className="text-[10pt] font-bold uppercase tracking-wide">
                    {supplier}
                  </div>
                  <div>
                    <div className="border-t border-black w-60 ml-auto pt-1 text-[8.5pt] text-center text-neutral-800 font-sans">
                      <div className="text-[8pt] text-neutral-600">As Authorized Agent / Shipper</div>
                      <div className="font-semibold uppercase tracking-wider">Authorized Signatory</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TEMPLATE 3: COMMERCIAL BILLING (Discovery Research / TK Style)  */}
          {/* ============================================================== */}
          {template === "commercial_billing" && (
            <div className="space-y-4 text-[9.5pt]">
              {/* Header: Company & Clean Mini Reference Box */}
              <div className="flex justify-between items-start pb-2">
                <div>
                  <h1 className="text-[17pt] font-black uppercase tracking-tight text-black">
                    {supplier}
                  </h1>
                  <p className="text-[8.5pt] text-neutral-700 max-w-[380px] leading-tight pt-0.5">
                    {supplierAddress}
                  </p>
                  <p className="text-[8.5pt] text-neutral-600 pt-1">
                    Tel: +855 23 890 781 &nbsp;|&nbsp; Email: billing@wealdone.com
                  </p>
                </div>

                <div className="text-right">
                  <h2 className="text-[20pt] font-black uppercase tracking-wide text-neutral-900 leading-tight">
                    {sheetTab === "inv" ? "INVOICE" : "PACKING LIST"}
                  </h2>
                  <div className="border border-black text-[8.5pt] mt-1.5 w-52 ml-auto">
                    <div className="flex border-b border-black">
                      <span className="w-20 bg-neutral-100 px-2 py-0.5 font-medium border-r border-black text-left text-neutral-700">
                        Date:
                      </span>
                      <span className="px-2 py-0.5 font-mono text-left flex-1">{invoiceDate}</span>
                    </div>
                    <div className="flex border-b border-black">
                      <span className="w-20 bg-neutral-100 px-2 py-0.5 font-medium border-r border-black text-left text-neutral-700">
                        Invoice #:
                      </span>
                      <span className="px-2 py-0.5 font-mono font-bold text-left flex-1">{invoiceNo}</span>
                    </div>
                    <div className="flex">
                      <span className="w-20 bg-neutral-100 px-2 py-0.5 font-medium border-r border-black text-left text-neutral-700">
                        CDC Ref:
                      </span>
                      <span className="px-2 py-0.5 font-mono text-left flex-1">{approvalShort}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Customer / Consignee Underlined Block (Discovery Research style) */}
              <div className="border-b-2 border-black pb-2 text-[9pt]">
                <div className="text-[8pt] font-bold uppercase tracking-wider text-neutral-600">
                  Customer / Consignee:
                </div>
                <div className="font-bold text-[10.5pt] text-black uppercase pt-0.5">
                  {consignee}
                </div>
                <div className="text-[8.5pt] text-neutral-700 leading-tight">
                  {consigneeAddressRaw}
                </div>
                <div className="text-[8.5pt] pt-0.5 text-neutral-800">
                  <span className="font-medium">VAT TIN:</span> <span className="font-mono">{vatNo}</span>
                  &nbsp;&bull;&nbsp;
                  <span className="font-medium">Delivery:</span> {borderPoint}
                </div>
              </div>

              {/* Data Table with Filler Rows */}
              {sheetTab === "inv" ? (
                <table className="w-full border-collapse border border-black text-[9pt]">
                  <thead>
                    <tr className="border-b border-black bg-neutral-100 font-bold uppercase text-[8.5pt]">
                      <th className="border-r border-black py-1.5 px-2 text-center w-10">No.</th>
                      <th className="border-r border-black py-1.5 px-2 text-left">Description</th>
                      <th colSpan={2} className="border-r border-black py-1.5 px-2 text-right w-28">
                        Quantity &amp; Unit
                      </th>
                      <th className="border-r border-black py-1.5 px-2 text-right w-24">Unit Price ($)</th>
                      <th className="py-1.5 px-2 text-right w-28">Amount ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceItems.map((item, idx) => (
                      <tr key={idx} className="border-b border-neutral-300">
                        <td className="border-r border-black py-1.5 text-center text-neutral-600 font-mono">
                          {idx + 1}
                        </td>
                        <td className="border-r border-black py-1.5 px-2 text-left font-medium">
                          {item.desc}
                        </td>
                        {/* Quantity and Unit with NO dividing line */}
                        <td className="py-1.5 pr-1 text-right tabular-nums w-18">
                          {formatNumber(item.qty)}
                        </td>
                        <td className="border-r border-black py-1.5 pl-1 text-left text-neutral-700 w-10">
                          {item.unit}
                        </td>
                        <td className="border-r border-black py-1.5 px-2 text-right tabular-nums">
                          {formatNumber(item.price)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-medium">
                          {formatNumber(item.amount)}
                        </td>
                      </tr>
                    ))}

                    {/* Filler Rows to eliminate awkward bottom gap */}
                    {Array.from({ length: billingInvFillCount }).map((_, i) => (
                      <tr key={`billing-fill-inv-${i}`} className="h-6 border-b border-neutral-200">
                        <td className="border-r border-black" />
                        <td className="border-r border-black" />
                        <td />
                        <td className="border-r border-black" />
                        <td className="border-r border-black" />
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full border-collapse border border-black text-[9pt]">
                  <thead>
                    <tr className="border-b border-black bg-neutral-100 font-bold uppercase text-[8.5pt]">
                      <th className="border-r border-black py-1.5 px-2 text-center w-10">No.</th>
                      <th className="border-r border-black py-1.5 px-2 text-left">Description</th>
                      <th className="border-r border-black py-1.5 px-2 text-center w-20">Packages</th>
                      <th colSpan={2} className="border-r border-black py-1.5 px-2 text-right w-24">
                        Quantity &amp; Unit
                      </th>
                      <th className="border-r border-black py-1.5 px-2 text-right w-24">Net Wt (KG)</th>
                      <th className="py-1.5 px-2 text-right w-24">Gross Wt (KG)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packingItems.map((item, idx) => (
                      <tr key={idx} className="border-b border-neutral-300">
                        <td className="border-r border-black py-1.5 text-center text-neutral-600 font-mono">
                          {idx + 1}
                        </td>
                        <td className="border-r border-black py-1.5 px-2 text-left font-medium">
                          {item.desc}
                        </td>
                        <td className="border-r border-black py-1.5 text-center font-bold tabular-nums">
                          {formatNumber(item.pkgs)}
                        </td>
                        {/* Quantity and Unit with NO dividing line */}
                        <td className="py-1.5 pr-1 text-right tabular-nums w-16">
                          {formatNumber(item.qty)}
                        </td>
                        <td className="border-r border-black py-1.5 pl-1 text-left text-neutral-700 w-8">
                          {item.unit}
                        </td>
                        <td className="border-r border-black py-1.5 px-2 text-right tabular-nums">
                          {formatNumber(item.nw)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-medium">
                          {formatNumber(item.gw)}
                        </td>
                      </tr>
                    ))}

                    {/* Filler Rows to eliminate awkward bottom gap */}
                    {Array.from({ length: billingPlFillCount }).map((_, i) => (
                      <tr key={`billing-fill-pl-${i}`} className="h-6 border-b border-neutral-200">
                        <td className="border-r border-black" />
                        <td className="border-r border-black" />
                        <td className="border-r border-black" />
                        <td />
                        <td className="border-r border-black" />
                        <td className="border-r border-black" />
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Bottom Summary & Notes (Discovery Research style) */}
              <div className="grid grid-cols-12 gap-6 pt-2">
                {/* Notes box on Left */}
                <div className="col-span-7 border border-black text-[8.5pt]">
                  <div className="bg-neutral-100 font-bold px-2.5 py-1 border-b border-black uppercase text-[8pt] tracking-wider text-neutral-800">
                    Other Comments &amp; Particulars
                  </div>
                  <div className="p-2 space-y-1 text-neutral-700">
                    <div>1. CDC Duty Exemption under QIP Master List #{approvalShort}.</div>
                    <div>2. Shipping via {vessel} &bull; B/L: {blNo}.</div>
                    <div>3. Container: {container}.</div>
                  </div>
                </div>

                {/* Totals Summary Box on Right */}
                <div className="col-span-5 border border-black text-[9pt]">
                  {sheetTab === "inv" ? (
                    <>
                      <div className="flex justify-between px-2.5 py-1 border-b border-neutral-300">
                        <span className="text-neutral-600 font-medium">Sub Total:</span>
                        <span className="font-mono tabular-nums">${formatNumber(totalInvAmount)}</span>
                      </div>
                      <div className="flex justify-between px-2.5 py-1 border-b border-neutral-300">
                        <span className="text-neutral-600 font-medium">CDC Exemption:</span>
                        <span className="font-mono text-neutral-500">$0.00</span>
                      </div>
                      <div className="flex justify-between px-2.5 py-1.5 bg-neutral-100 font-bold border-t-2 border-black">
                        <span>Balance Due:</span>
                        <span className="font-mono tabular-nums text-[10.5pt] font-black">
                          ${formatNumber(totalInvAmount)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between px-2.5 py-1 border-b border-neutral-300">
                        <span className="text-neutral-600 font-medium">Total Packages:</span>
                        <span className="font-mono tabular-nums font-bold">{formatNumber(totalPlPkgs)}</span>
                      </div>
                      <div className="flex justify-between px-2.5 py-1 border-b border-neutral-300">
                        <span className="text-neutral-600 font-medium">Total Net Weight:</span>
                        <span className="font-mono tabular-nums font-bold">{formatNumber(totalPlNw)} KG</span>
                      </div>
                      <div className="flex justify-between px-2.5 py-1.5 bg-neutral-100 font-bold border-t-2 border-black">
                        <span>Total Gross Weight:</span>
                        <span className="font-mono tabular-nums text-[10pt] font-black">
                          {formatNumber(totalPlGw)} KG
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Signature Block */}
              <div className="pt-6 flex justify-end">
                <div className="text-center w-60 space-y-12">
                  <div className="text-[8.5pt] uppercase tracking-wider text-neutral-600">
                    Authorized Signature
                  </div>
                  <div>
                    <div className="border-t border-black pt-1 font-sans">
                      <div className="font-bold text-[9pt] uppercase">{supplier}</div>
                      <div className="text-[8pt] text-neutral-600">Chief Customs Officer</div>
                      <div className="text-[7.5pt] text-neutral-500">Date: {invoiceDate}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
