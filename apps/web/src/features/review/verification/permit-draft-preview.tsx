"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Printer, Maximize2, Minimize2 } from "lucide-react";
import { PdfFileIcon } from "@/components/ui/file-icon";
import { DocumentCanvasControls, DocumentCanvasSurface, documentCanvasPaper } from "@/features/review/document-canvas-surface";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { highlightMatch } from "../highlight-match";
import type { Extraction, ExtractedField, Finding, ReviewAnalysis, ReviewField } from "@/lib/contracts";
import { reviewKey, type ReviewDraft } from "@/features/review/staff-review";
import { findMatchingInvoiceRow, splitPartyAndAddress } from "@/features/review/verification/verification-review";

export type PermitTemplate = "cdc_classic" | "freight_agency" | "commercial_billing";

const templateOptions = [
  {
    id: "cdc_classic" as const,
    name: "CDC Classic",
    title: "CDC Classic (12-RE2612048)",
    thumbnail: (
      <div className="flex h-full w-full flex-col justify-between overflow-hidden rounded-3xs bg-white p-1 text-slate-800 shadow-2xs dark:bg-slate-950 dark:text-slate-200">
        {/* Centered serif header */}
        <div className="flex flex-col items-center gap-0.5 pt-0.5">
          <div className="h-0.5 w-6 rounded-full bg-slate-900 dark:bg-slate-100" />
          <div className="h-px w-4 rounded-full bg-slate-500" />
          <div className="mt-0.5 h-px w-5 rounded-full bg-slate-700 dark:bg-slate-300" />
        </div>
        {/* Classical double-border ledger table */}
        <div className="my-auto space-y-0.5 border-y border-double border-slate-700 py-0.5 dark:border-slate-300">
          <div className="grid grid-cols-4 gap-0.5">
            <div className="h-px bg-slate-700 dark:bg-slate-300" />
            <div className="col-span-2 h-px bg-slate-500 dark:bg-slate-400" />
            <div className="h-px bg-slate-700 dark:bg-slate-300" />
          </div>
          <div className="grid grid-cols-4 gap-0.5">
            <div className="h-px bg-slate-300 dark:bg-slate-700" />
            <div className="col-span-2 h-px bg-slate-300 dark:bg-slate-700" />
            <div className="h-px bg-slate-300 dark:bg-slate-700" />
          </div>
          <div className="grid grid-cols-4 gap-0.5">
            <div className="h-px bg-slate-300 dark:bg-slate-700" />
            <div className="col-span-2 h-px bg-slate-300 dark:bg-slate-700" />
            <div className="h-px bg-slate-300 dark:bg-slate-700" />
          </div>
          <div className="grid grid-cols-4 gap-0.5">
            <div className="h-px bg-slate-300 dark:bg-slate-700" />
            <div className="col-span-2 h-px bg-slate-300 dark:bg-slate-700" />
            <div className="h-px bg-slate-300 dark:bg-slate-700" />
          </div>
        </div>
        {/* Double-line footer */}
        <div className="flex justify-between border-t border-double border-slate-700 pt-0.5 dark:border-slate-300">
          <div className="h-px w-3 bg-slate-500" />
          <div className="h-px w-3 bg-slate-900 dark:bg-slate-100" />
        </div>
      </div>
    ),
  },
  {
    id: "freight_agency" as const,
    name: "Freight Agency",
    title: "Freight Agency (Global Wing Format)",
    thumbnail: (
      <div className="flex h-full w-full flex-col justify-between overflow-hidden rounded-3xs bg-white p-1 shadow-2xs dark:bg-slate-950">
        {/* Bold top agency banner */}
        <div className="flex flex-col gap-0.5 border-b border-primary/40 bg-primary/15 px-1 py-0.5 rounded-3xs">
          <div className="h-0.5 w-6 rounded-full bg-primary" />
          <div className="h-px w-3 rounded-full bg-primary/70" />
        </div>
        {/* Metadata & modern table */}
        <div className="space-y-0.5 py-0.5">
          <div className="flex justify-between gap-1">
            <div className="h-px w-3 bg-slate-400 dark:bg-slate-500" />
            <div className="h-px w-3 bg-slate-400 dark:bg-slate-500" />
          </div>
          <div className="h-px w-full bg-slate-200 dark:bg-slate-800" />
          <div className="h-px w-full bg-slate-300 dark:bg-slate-700" />
          <div className="h-px w-full bg-slate-200 dark:bg-slate-800" />
          <div className="h-px w-full bg-slate-300 dark:bg-slate-700" />
        </div>
        {/* Right-aligned boxed summary */}
        <div className="flex justify-end">
          <div className="rounded-3xs border border-slate-400 bg-slate-100 px-1 py-0.2 dark:border-slate-600 dark:bg-slate-800">
            <div className="h-0.5 w-3 bg-slate-800 dark:bg-slate-200" />
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "commercial_billing" as const,
    name: "Corporate",
    title: "Commercial Billing (Corporate Standard)",
    thumbnail: (
      <div className="flex h-full w-full flex-col justify-between overflow-hidden rounded-3xs bg-white p-1 shadow-2xs dark:bg-slate-950">
        {/* Split corporate header: logo left, box right */}
        <div className="flex items-start justify-between">
          <div className="space-y-0.5">
            <div className="h-0.5 w-4 rounded-full bg-slate-800 dark:bg-slate-200" />
            <div className="h-px w-2.5 rounded-full bg-slate-400 dark:bg-slate-500" />
          </div>
          <div className="rounded-3xs border border-slate-300 bg-slate-50 px-0.5 dark:border-slate-700 dark:bg-slate-900">
            <div className="h-px w-2 bg-slate-600 dark:bg-slate-400" />
          </div>
        </div>
        {/* Minimal clean horizontal rules */}
        <div className="space-y-0.5 py-0.5">
          <div className="h-px w-full bg-slate-300 dark:bg-slate-700" />
          <div className="h-px w-full bg-slate-200 dark:bg-slate-800" />
          <div className="h-px w-full bg-slate-300 dark:bg-slate-700" />
          <div className="h-px w-full bg-slate-200 dark:bg-slate-800" />
        </div>
        {/* Clean footer line */}
        <div className="flex justify-between border-t border-slate-300 pt-0.5 dark:border-slate-700">
          <div className="h-px w-2 bg-slate-400" />
          <div className="h-px w-3 bg-slate-700 dark:bg-slate-300" />
        </div>
      </div>
    ),
  },
];

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
  sheetTab?: "inv" | "pl";
  onSheetTabChange?: (tab: "inv" | "pl") => void;
  template?: PermitTemplate;
  onTemplateChange?: (template: PermitTemplate) => void;
  switchingDisabled?: boolean;
  embedded?: boolean;
  searchQuery?: string;
  onMatchCountChange?: (count: number) => void;
  lineItems?: ReviewAnalysis["line_items"];
  findings?: Finding[];
};

type PermitInvoiceItem = {
  cdc: number | string;
  desc: string;
  qty: number;
  unit: string;
  price: number;
  amount: number;
};

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
  sheetTab: controlledSheetTab = "inv",
  onSheetTabChange,
  switchingDisabled,
  template: controlledTemplate,
  onTemplateChange,
  embedded = false,
  searchQuery,
  onMatchCountChange,
  lineItems,
  findings,
}: PermitDraftPreviewProps) {
  const sheetTab = controlledSheetTab;
  const [internalTemplate, setInternalTemplate] = useState<PermitTemplate>("cdc_classic");
  const template = controlledTemplate ?? internalTemplate;
  const setTemplate = (next: PermitTemplate) => {
    if (onTemplateChange) onTemplateChange(next);
    else setInternalTemplate(next);
  };
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(100);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const viewport = useRef<HTMLDivElement>(null);
  const fitZoom = useRef(100);
  const userZoomed = useRef(false);

  function handleZoom(next: number) {
    userZoomed.current = true;
    setZoom(Math.max(40, Math.min(250, Math.round(next))));
  }

  const handleZoomDelta = useCallback((delta: number) => {
    userZoomed.current = true;
    setZoom((prev) => Math.max(40, Math.min(250, Math.round((prev + delta) * 10) / 10)));
  }, []);

  function handleResetZoom() {
    userZoomed.current = false;
    setZoom(embedded ? fitZoom.current : 100);
  }

  useEffect(() => {
    userZoomed.current = false;
  }, [isExpanded]);

  useEffect(() => {
    const element = viewport.current;
    if (!embedded || !element) return;
    let previousWidth = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === previousWidth) return;
      previousWidth = element.clientWidth;
      const style = getComputedStyle(element);
      const availableWidth =
        element.clientWidth -
        parseFloat(style.paddingLeft || "0") -
        parseFloat(style.paddingRight || "0");
      fitZoom.current = Math.max(40, Math.min(100, Math.round(((availableWidth - 16) / 820) * 100)));
      if (!userZoomed.current) {
        setZoom(fitZoom.current);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [embedded, isExpanded]);


  useEffect(() => {
    if (!isExpanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isExpanded]);

  const hl = (val: unknown) => highlightMatch(val, searchQuery);

  // Helper to extract reviewed or fallback field value
  function getFieldValue(role: string, name: string, row?: number, docId?: string): string {
    const fieldKey = reviewKey({
      role: role as ReviewField["role"],
      name: name as ReviewField["name"],
      row: row ?? null,
      document_id: docId ?? (role === "invoice" ? invoiceExt : role === "packing_list" ? packingExt : blExt)?.document_id ?? "",
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

  // Shared shipment headers use the active document's saved review values.
  const header = (name: string) => getFieldValue(sheetTab === "inv" ? "invoice" : "packing_list", name) || getFieldValue("invoice", name);
  const bill = (name: string) => getFieldValue(blExt?.role ?? "draft_bl", name);
  const supplierRaw = header("supplier");
  const { name: splitSupName, address: splitSupAddr } = splitPartyAndAddress(supplierRaw);
  const supplier = splitSupName || supplierRaw || "—";
  const supplierAddress = header("supplier_address") || splitSupAddr || undefined;

  const consigneeRaw = header("consignee");
  const { name: splitCneeName, address: splitCneeAddr } = splitPartyAndAddress(consigneeRaw);
  const consignee = splitCneeName || consigneeRaw || companyName || "—";
  const consigneeAddressRaw = header("consignee_address") || splitCneeAddr || "";
  const vatNo = header("vat") || "—";
  const invoiceNo = header("invoice_no") || reference || "—";
  const invoiceDate = header("invoice_date") || "—";
  const blNo = bill("bl_no") || "—";
  const vessel = header("shipping_mode") || bill("shipping_mode") || bill("vessel") || "—";
  const container = bill("container") || header("container") || "";
  const originCountry = header("country_of_origin") || header("origin") || bill("origin") || "—";
  const pol = header("origin") || bill("port_of_loading") || "—";
  const pod = header("destination") || bill("port_of_discharge") || "—";
  const route = `${pol} TO ${pod}`;
  const borderPoint = [header("incoterms"), header("port") || bill("port")].filter(Boolean).join(" ") || "—";
  const approvalShort = selectedMaster?.approval_ref || "—";
  const categoryHeader =
    (selectedMaster as Record<string, unknown> | null | undefined)?.category as string ||
    "II - RAW MATERIALS AND ACCESSORIES";

  // Split consignee address into clean multi-line display
  const consigneeAddressLines = consigneeAddressRaw
    .split(/,|\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Items for Commercial Invoice
  const extractedInvItems: PermitInvoiceItem[] = (invoiceExt?.items || []).map((item, idx) => {
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
      "";
    const priceStr =
      getFieldValue("invoice", "unit_price", row, docId) ||
      item.fields.unit_price?.value ||
      "0";
    const amountStr =
      getFieldValue("invoice", "amount", row, docId) ||
      item.fields.amount?.value ||
      "0";

    const mapping = mappings.find((m) => m.invoice_row === row);
    const candidate =
      mapping &&
      candidates.find(
        (entry) =>
          entry.invoice_document_id === docId &&
          entry.invoice_row === row &&
          entry.master_row === mapping.master_row
      );
    const rowCandidates = candidates.filter(
      (entry) => entry.invoice_document_id === docId && entry.invoice_row === row
    );
    const topCandidate = rowCandidates[0];
    const matchedRow =
      candidate?.serial ??
      mapping?.master_row ??
      topCandidate?.serial ??
      topCandidate?.master_row ??
      "";

    const qty = parseNumeric(qtyStr);
    const price = parseNumeric(priceStr);
    const amount = amountStr ? parseNumeric(amountStr) : qty * price;

    return {
      cdc: matchedRow,
      desc: description.toUpperCase(),
      qty,
      unit,
      price,
      amount,
    };
  });

  const invoiceItems = extractedInvItems;

  // Items for Packing List
  const extractedPlItems = (packingExt?.items || []).map((item, idx) => {
    const row = item.row;
    const docId = packingExt?.document_id;
    const matchingInvRow = findMatchingInvoiceRow(row, packingExt, invoiceExt, lineItems, findings);
    const invoiceDesc = matchingInvRow != null
      ? getFieldValue("invoice", "description", matchingInvRow, invoiceExt?.document_id)
      : "";
    const invoiceUnit = matchingInvRow != null
      ? getFieldValue("invoice", "unit", matchingInvRow, invoiceExt?.document_id)
      : "";

    const hasInvoiceDescReview = matchingInvRow != null && invoiceExt?.document_id
      ? reviewedFields.has(reviewKey({ role: "invoice", name: "description", row: matchingInvRow, document_id: invoiceExt.document_id }))
      : false;
    const hasInvoiceUnitReview = matchingInvRow != null && invoiceExt?.document_id
      ? reviewedFields.has(reviewKey({ role: "invoice", name: "unit", row: matchingInvRow, document_id: invoiceExt.document_id }))
      : false;

    const description =
      getFieldValue("packing_list", "description", row, docId) ||
      (hasInvoiceDescReview ? invoiceDesc : "") ||
      item.fields.description?.value ||
      invoiceDesc ||
      `Item ${idx + 1}`;
    const packages = parseNumeric(
      getFieldValue("packing_list", "packages", row, docId) ||
        item.fields.packages?.value ||
        0
    );
    const netWeight = parseNumeric(
      getFieldValue("packing_list", "net_weight", row, docId) ||
        item.fields.net_weight?.value ||
        0
    );
    const grossWeight = parseNumeric(
      getFieldValue("packing_list", "gross_weight", row, docId) ||
        item.fields.gross_weight?.value ||
        0
    );
    const unit =
      getFieldValue("packing_list", "unit", row, docId) ||
      (hasInvoiceUnitReview ? invoiceUnit : "") ||
      item.fields.unit?.value ||
      invoiceUnit ||
      "";
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

  const packingItems = extractedPlItems;

  // Totals calculations
  const invHeader = (name: string) => getFieldValue("invoice", name, undefined, invoiceExt?.document_id);
  const plHeader = (name: string) => getFieldValue("packing_list", name, undefined, packingExt?.document_id);

  const totalInvQty = invoiceItems.reduce((acc, curr) => acc + curr.qty, 0);
  const totalInvAmount = parseNumeric(invHeader("amount")) || invoiceItems.reduce((acc, curr) => acc + curr.amount, 0);

  const totalPlPkgs = parseNumeric(plHeader("packages")) || packingItems.reduce((acc, curr) => acc + curr.pkgs, 0);
  const totalPlQty = packingItems.reduce((acc, curr) => acc + curr.qty, 0);
  const totalPlNw = parseNumeric(plHeader("net_weight")) || packingItems.reduce((acc, curr) => acc + curr.nw, 0);
  const totalPlGw = parseNumeric(plHeader("gross_weight")) || packingItems.reduce((acc, curr) => acc + curr.gw, 0);

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

  // Calculate search matches and notify parent
  useEffect(() => {
    if (!onMatchCountChange) return;
    if (!searchQuery || !searchQuery.trim()) {
      onMatchCountChange(0);
      return;
    }
    const q = searchQuery.trim().toLowerCase();
    let count = 0;
    const checkText = (text: unknown) => {
      if (text == null) return;
      const str = String(text).toLowerCase();
      let pos = str.indexOf(q);
      while (pos !== -1) {
        count++;
        pos = str.indexOf(q, pos + q.length);
      }
    };

    checkText(supplier);
    checkText(supplierAddress);
    checkText(consignee);
    checkText(consigneeAddressRaw);
    checkText(invoiceNo);
    checkText(invoiceDate);
    checkText(vessel);
    checkText(route);
    checkText(originCountry);
    checkText(vatNo);
    checkText(blNo);

    if (sheetTab === "inv") {
      invoiceItems.forEach((i) => {
        checkText(i.cdc);
        checkText(i.desc);
        checkText(i.qty);
        checkText(i.unit);
        checkText(i.price);
        checkText(i.amount);
      });
      checkText(totalInvQty);
      checkText(totalInvAmount);
    } else {
      packingItems.forEach((i) => {
        checkText(i.pkgs);
        checkText(i.desc);
        checkText(i.qty);
        checkText(i.unit);
        checkText(i.nw);
        checkText(i.gw);
      });
      checkText(totalPlPkgs);
      checkText(totalPlQty);
      checkText(totalPlNw);
      checkText(totalPlGw);
    }

    onMatchCountChange(count);
  }, [
    searchQuery,
    sheetTab,
    supplier,
    supplierAddress,
    consignee,
    consigneeAddressRaw,
    invoiceNo,
    invoiceDate,
    vessel,
    route,
    originCountry,
    vatNo,
    blNo,
    invoiceItems,
    packingItems,
    totalInvQty,
    totalInvAmount,
    totalPlPkgs,
    totalPlQty,
    totalPlNw,
    totalPlGw,
    onMatchCountChange,
  ]);

  // Scroll to first match if search query is entered
  useEffect(() => {
    if (searchQuery && searchQuery.trim()) {
      const timer = setTimeout(() => {
        const mark = viewport.current?.querySelector("mark");
        if (mark) {
          mark.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [searchQuery]);

  const preview = (
    <div
      className={`flex flex-col rounded-lg border border-border/80 bg-muted/40 shadow-xs overflow-hidden transition-all ${
        isExpanded
          ? "fixed inset-0 z-[100] rounded-none border-none bg-background shadow-none"
          : embedded ? "h-full min-h-0 rounded-none border-0 shadow-none" : "h-[calc(100vh-140px)] min-h-[640px]"
      }`}
    >
      <header className="z-20 shrink-0 border-b border-slate-200/80 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <PdfFileIcon size="sm" />
            <span className="truncate text-xs font-semibold">{sheetTab === "inv" ? "Invoice" : "Packing List"} · {invoiceNo}</span>
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">{isApproved ? "Approved" : "Draft"}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {onSheetTabChange && (
              <div role="group" aria-label="Print document" className="flex gap-1">
                <Button
                  type="button"
                  size="xs"
                  variant={sheetTab === "inv" ? "default" : "outline"}
                  aria-label="INV (Invoice)"
                  aria-pressed={sheetTab === "inv"}
                  disabled={switchingDisabled}
                  onClick={() => onSheetTabChange("inv")}
                >
                  INV
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={sheetTab === "pl" ? "default" : "outline"}
                  aria-label="PL (Packing List)"
                  aria-pressed={sheetTab === "pl"}
                  disabled={switchingDisabled}
                  onClick={() => onSheetTabChange("pl")}
                >
                  PL
                </Button>
              </div>
            )}
            <Button type="button" variant="outline" size="xs" onClick={() => window.print()} title="Print or export as PDF" aria-label="Print Preview" className="h-7 gap-1.5 text-xs"><Printer className="size-3.5" /><span className="hidden sm:inline">Print Preview</span></Button>
            <Button type="button" variant="outline" size="icon-xs" onClick={() => setIsExpanded(!isExpanded)} title={isExpanded ? "Exit fullscreen" : "Fullscreen preview"} className="size-7">{isExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</Button>
          </div>
        </div>
      </header>
      <DocumentCanvasSurface
        viewportRef={viewport}
        viewportLabel="Print preview canvas"
        viewportClassName="p-3 pt-6 sm:p-4 sm:pt-6 md:p-6 md:pt-8"
        onWheelZoom={handleZoomDelta}
        controls={
          <>
            {/* Hover-to-expand vertical card with rotated label "TEMPLATE" */}
            <div
              className="absolute left-0 top-4 z-30 flex items-stretch select-none print:hidden shadow-md h-[344px]"
              onMouseEnter={() => setTemplateDrawerOpen(true)}
              onMouseLeave={() => setTemplateDrawerOpen(false)}
            >
              {/* Body with 3 templates (on the left, docked to left-0) */}
              <div
                className={cn(
                  "flex flex-col justify-between gap-1.5 border-y border-l-0 border-slate-300/90 bg-white/95 backdrop-blur-md transition-all duration-200 ease-out dark:border-slate-700 dark:bg-slate-900/95 overflow-hidden h-full",
                  templateDrawerOpen
                    ? "max-w-[200px] p-1.5 opacity-100 pointer-events-auto"
                    : "max-w-0 p-0 border-y-0 opacity-0 pointer-events-none"
                )}
                role="radiogroup"
                aria-label="Select permit template"
              >
                {templateOptions.map((tpl) => {
                  const selected = template === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setTemplate(tpl.id)}
                      title={tpl.title}
                      className={cn(
                        "group/thumb relative flex flex-col items-center w-[70px] shrink-0 rounded-md border p-1 text-left transition-colors cursor-pointer overflow-hidden",
                        selected
                          ? "border-2 border-primary bg-primary/5 shadow-2xs opacity-100 dark:bg-primary/10"
                          : "border-slate-200 bg-white opacity-80 hover:opacity-100 hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                      )}
                    >
                      <div className="w-full aspect-[3/4] overflow-hidden rounded-xs border border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-950">
                        {tpl.thumbnail}
                      </div>
                      {selected && (
                        <span
                          className="absolute right-1 top-1 z-10 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs"
                          aria-hidden
                        >
                          <Check className="size-2.5" strokeWidth={3.5} />
                        </span>
                      )}
                      <span
                        className={cn(
                          "mt-0.5 text-[8px] font-semibold leading-tight text-center w-full truncate",
                          selected ? "text-primary font-bold" : "text-slate-600 dark:text-slate-400"
                        )}
                      >
                        {tpl.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* TEMPLATE Handle Tab (same width & height collapsed/expanded, no dot no icon) */}
              <button
                type="button"
                aria-expanded={templateDrawerOpen}
                aria-label="Permit templates"
                onClick={() => setTemplateDrawerOpen((prev) => !prev)}
                className={cn(
                  "flex flex-col items-center justify-center w-6 h-full border border-l-0 border-slate-300/90 bg-white/95 backdrop-blur-md transition-colors cursor-pointer dark:border-slate-700 dark:bg-slate-900/95 shrink-0 rounded-r-md select-none",
                  templateDrawerOpen
                    ? "border-l border-slate-200/90 bg-slate-50 dark:border-slate-800 dark:bg-slate-850"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800"
                )}
              >
                <span className="[writing-mode:vertical-rl] rotate-180 text-[9.5px] font-bold uppercase text-slate-700 dark:text-slate-300 tracking-[1.55em] select-none py-1">
                  TEMPLATE
                </span>
              </button>
            </div>

            <DocumentCanvasControls
              zoom={zoom}
              expanded={isExpanded}
              onExpand={() => setIsExpanded(!isExpanded)}
              onZoomIn={() => handleZoom(zoom + 15)}
              onZoomOut={() => handleZoom(zoom - 15)}
              zoomInDisabled={zoom >= 250}
              zoomOutDisabled={zoom <= 40}
              onReset={handleResetZoom}
            />
          </>
        }
      >
        {/* Printable White Sheet Document */}
        <div
          data-permit-print-sheet={sheetTab}
          style={{
            zoom: zoom / 100,
            fontFamily:
              template === "cdc_classic"
                ? '"Times New Roman", Times, serif'
                : 'Arial, "Helvetica Neue", Helvetica, sans-serif',
          }}
          className={cn(documentCanvasPaper, "mx-auto min-h-[1140px] w-[820px] shrink-0 p-10 text-black sm:p-12 print:[zoom:1] print:shadow-none print:p-6")}
        >
          {/* ============================================================== */}
          {/* TEMPLATE 1: CDC CLASSIC (Exact 12-RE2612048.xlsx Format)     */}
          {/* ============================================================== */}
          {template === "cdc_classic" && (
            <>
              {/* Row 1-2: Supplier / Exporter Header */}
              <div className="text-center space-y-0.5 pb-2">
                <h1 className="text-[18pt] font-bold tracking-wide uppercase leading-tight">
                  {hl(supplier)}
                </h1>
                <p className="text-[9pt] leading-tight text-neutral-800 max-w-[700px] mx-auto">
                  {hl(supplierAddress)}
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
                      <span className="font-medium">{hl(invoiceNo)}</span>
                    </div>
                    <div className="flex">
                      <span className="w-36 shrink-0">Shipping mode:</span>
                      <span>{hl(vessel)}</span>
                    </div>
                    <div className="flex">
                      <span className="w-36 shrink-0">From:</span>
                      <span>{hl(route)}</span>
                    </div>
                    <div className="flex">
                      <span className="w-36 shrink-0">Country of origin:</span>
                      <span>{hl(originCountry)}</span>
                    </div>
                    <div className="flex pt-0.5">
                      <span className="w-36 shrink-0">Consignee:</span>
                      <div className="flex-1">
                        <div className="font-bold">{hl(consignee)}</div>
                        {consigneeAddressLines.map((line, idx) => (
                          <div key={idx} className="text-[10pt] leading-tight">
                            {hl(line)}
                          </div>
                        ))}
                        <div className="pt-0.5">SHIPPING PERSON:</div>
                        <div>VAT No : {hl(vatNo)}</div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column (Cols D-G): Only DATE like original 12-RE2612048.xlsx */}
                  <div className="col-span-5 pl-2">
                    <div className="flex justify-end gap-3 text-[11pt]">
                      <span>DATE:</span>
                      <span className="font-normal">{hl(invoiceDate)}</span>
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
                            {hl(item.cdc)}
                          </td>
                          <td
                            style={{ borderRight: "1px solid #000" }}
                            className="py-1 px-3 text-left text-[12pt]"
                          >
                            {hl(item.desc)}
                          </td>
                          {/* Quantity value with NO vertical line before unit */}
                          <td
                            style={{ width: "13%" }}
                            className="py-1 pr-1.5 text-right text-[12pt] tabular-nums"
                          >
                            {hl(formatNumber(item.qty))}
                          </td>
                          {/* Unit cell with outer divider to price */}
                          <td
                            style={{ borderRight: "1px solid #000", width: "7.5%" }}
                            className="py-1 pl-1 text-left text-[12pt]"
                          >
                            {hl(item.unit)}
                          </td>
                          <td
                            style={{ borderRight: "1px solid #000" }}
                            className="py-1 pr-2 text-right text-[12pt] tabular-nums"
                          >
                            {hl(formatNumber(item.price))}
                          </td>
                          <td className="py-1 pr-2 text-right text-[12pt] tabular-nums">
                            {hl(formatNumber(item.amount))}
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
                          {hl(formatNumber(totalInvQty))}
                        </td>
                        <td style={{ borderRight: "1px solid #000" }} className="py-1.5"></td>
                        <td style={{ borderRight: "1px solid #000" }} className="py-1.5"></td>
                        <td className="py-1.5 pr-2 text-right text-[13pt] tabular-nums font-bold">
                          {hl(formatNumber(totalInvAmount))}
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
                            {hl(formatNumber(item.pkgs))}
                          </td>
                          <td
                            style={{ borderRight: "1px solid #000" }}
                            className="py-1 px-3 text-left text-[12pt]"
                          >
                            {hl(item.desc)}
                          </td>
                          {/* Quantity value with NO line before unit */}
                          <td
                            style={{ width: "12%" }}
                            className="py-1 pr-1.5 text-right text-[12pt] tabular-nums"
                          >
                            {hl(formatNumber(item.qty))}
                          </td>
                          {/* Unit cell with outer divider to weight */}
                          <td
                            style={{ borderRight: "1px solid #000", width: "8%" }}
                            className="py-1 pl-1 text-left text-[12pt]"
                          >
                            {hl(item.unit)}
                          </td>
                          <td
                            style={{ borderRight: "1px solid #000" }}
                            className="py-1 pr-2 text-right text-[12pt] tabular-nums"
                          >
                            {hl(formatNumber(item.nw))}
                          </td>
                          <td className="py-1 pr-2 text-right text-[12pt] tabular-nums">
                            {hl(formatNumber(item.gw))}
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
                          {hl(formatNumber(totalPlPkgs))}
                        </td>
                        <td
                          style={{ borderRight: "1px solid #000" }}
                          className="py-1.5 pr-3 text-right uppercase"
                        >
                          TOTAL:
                        </td>
                        <td className="py-1.5 pr-1.5 text-right text-[12pt] tabular-nums">
                          {hl(formatNumber(totalPlQty))}
                        </td>
                        <td style={{ borderRight: "1px solid #000" }} className="py-1.5"></td>
                        <td
                          style={{ borderRight: "1px solid #000" }}
                          className="py-1.5 pr-2 text-right text-[12pt] tabular-nums font-bold"
                        >
                          {hl(formatNumber(totalPlNw))}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-[12pt] tabular-nums font-bold">
                          {hl(formatNumber(totalPlGw))}
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
      </DocumentCanvasSurface>
    </div>
  );
  return isExpanded ? createPortal(preview, document.body) : preview;
}
