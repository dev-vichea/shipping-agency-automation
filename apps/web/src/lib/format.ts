import type { Evidence, ExtractedField } from "./contracts";

const time = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Phnom_Penh",
});

export function timestamp(value: string | null) {
  return value ? time.format(new Date(value)) : "—";
}

export function location(item: Evidence) {
  if (item.sheet) return [item.sheet, item.cell || (item.row && `Row ${item.row}`)].filter(Boolean).join(" · ");
  return [item.page && `Page ${item.page}`, item.line && `Line ${item.line}`].filter(Boolean).join(" · ") || "Source";
}

const documentFields: Record<string, string> = {
  shipper: "Shipper",
  shipper_address: "Shipper Address",
  supplier: "Supplier",
  supplier_address: "Supplier Address",
  consignee: "Consignee",
  consignee_address: "Consignee Address",
  vat: "VAT",
  bl_no: "B/L Number",
  booking_no: "Booking Number",
  invoice_no: "Invoice Number",
  invoice_date: "Invoice Date",
  issue_date: "Issue Date",
  origin: "Origin",
  port: "Port / Border",
  route_legs: "Route",
  destination: "Destination",
  shipping_mode: "Transport Mode",
  cargo_summary: "Description of Goods",
  packages: "Total Packages",
  gross_weight: "Gross Weight",
  net_weight: "Net Weight",
  amount: "Amount",
  currency: "Currency",
  hs_code: "HS Code",
  english_description: "English Description",
  description: "Goods Description",
  unit_price: "Unit Price",
  unit: "Unit of Measure",
  etd: "ETD",
  eta: "ETA",
};

export function documentFieldLabel(key: string) {
  return documentFields[key] ?? key.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function sourceValue(field?: { value: string | null; unit: string | null; currency: string | null }) {
  return field?.value ? [field.value, field.currency, field.unit].filter(Boolean).join(" ") : "—";
}

export function intakeField(field?: ExtractedField) {
  const english = field?.english;
  const source = sourceValue(field);
  if (english?.value && ["source", "staff_verified", "verified_company_alias", "proposed"].includes(english.status)) {
    return {
      value: [english.value, field?.currency, field?.unit].filter(Boolean).join(" "),
      evidence: english.evidence[0] ?? field?.evidence[0],
      label: english.status === "proposed" ? "English proposal"
        : english.status === "verified_company_alias" ? "Verified English alias" : undefined,
    };
  }
  if (english && source !== "—") {
    return {
      value: english.status === "pending" ? "English translation pending" : "English needs review",
      evidence: field?.evidence[0], label: undefined,
    };
  }
  return { value: source, evidence: field?.evidence[0], label: undefined };
}

export function invoiceReference(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed && /\p{Nd}/u.test(trimmed) ? trimmed : null;
}

/**
 * Format numeric field values according to domain conventions:
 * - Packages (`packages`, `pkgs`, `package`): discrete integer count, never decimal (e.g. 531.0 -> 531).
 * - Quantity & Weights (`quantity`, `qty`, `gross_weight`, `net_weight`, `measurement`, `cbm`, etc.):
 *   Whole numbers have no decimals (e.g. 12724.0 -> 12724, 25117.0 -> 25117).
 *   Fractional numbers keep up to 2 decimal places, cutting floating-point noise (e.g. 1679.8000012 -> 1679.8, .1000012414 -> .10).
 * - Money / Prices / Amounts (`unit_price`, `price`, `amount`, `total`, `total_amount`, `subtotal`, `approved_value`, `remaining_value`):
 *   Always 2 decimal places with .00 (e.g. 3.5 -> 3.50, 44534.0 -> 44534.00, 419.95 -> 419.95).
 * - Floating point noise (e.g. .1000012414) is cut to at most 2 decimal places.
 */
export function formatFieldValue(val: string | number | null | undefined, fieldName?: string): string {
  if (val === null || val === undefined) return "";
  const str = typeof val === "number" ? String(val) : String(val).trim();
  if (!str) return "";

  const clean = str.replace(/,/g, "");
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(clean)) {
    return str;
  }

  const num = Number(clean);
  if (isNaN(num)) return str;

  const fn = fieldName ? fieldName.toLowerCase().trim() : "";

  // 1. Packages: strictly integer (531.0 -> 531)
  if (fn === "packages" || fn === "pkgs" || fn === "package" || fn === "total_packages") {
    return String(Math.round(num));
  }

  // 2. Money / Currency: always 2 decimal places (3.5 -> 3.50, 44534.0 -> 44534.00)
  if (
    fn === "unit_price" ||
    fn === "price" ||
    fn === "amount" ||
    fn === "total" ||
    fn === "total_amount" ||
    fn === "subtotal" ||
    fn === "approved_value" ||
    fn === "remaining_value" ||
    fn.includes("price") ||
    fn.includes("amount")
  ) {
    return num.toFixed(2);
  }

  // 3. Quantity, Weights, Measurements, and generic numeric values:
  // If whole number, return integer without decimal (12724.0 -> 12724, 25117.0 -> 25117).
  if (Math.abs(num - Math.round(num)) < 1e-6) {
    return String(Math.round(num));
  }

  // If fractional: round to at most 2 decimal places, cutting floating point noise.
  const rounded = Math.round(num * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return String(Math.round(rounded));
  }
  return String(rounded);
}

/**
 * Format a number/decimal string. Alias for formatFieldValue with optional field name.
 */
export function formatDecimal(val: string | number | null | undefined, fieldName?: string): string {
  return formatFieldValue(val, fieldName);
}

const labels: Record<string, string> = {
  PASS: "Pass",
  WARNING: "Warning",
  MISMATCH: "Mismatch",
  NEEDS_REVIEW: "Needs review",
  analysis: "Document analysis",
  ai: "AI suggestions",
  previous_analysis: "Previous analysis",
  invoice_subtotal: "Invoice subtotal",
  currency_uniformity: "Currency uniformity",
  container_check_digit: "Container check digit",
  low_quota: "Low quota",
  extracted: "Extracted",
  partial: "Partial",
  unsupported_layout: "Unsupported layout",
  present: "Present",
  missing: "Missing",
  uncertain: "Uncertain",
  simulated: "Simulated",
  manual: "Manual upload",
  gmail: "Gmail",
  folder: "Watched folder",
  processing: "Processing",
  queued: "Queued",
  needs_review: "Needs review",
  ready_for_approval: "Ready for approval",
  awaiting_updated_document: "Awaiting Updated Document",
  manual_matching: "Manual Matching",
  approved: "Approved",
  rejected: "Rejected",
  reviewed: "Reviewed",
  authorized: "Authorized",
  failed: "Failed",
  running: "Running",
  succeeded: "Succeeded",
  draft: "Draft",
  draft_bl: "Draft B/L",
  final_bl: "Final B/L",
  final_bl_confirmation: "Final B/L Confirmation",
  revision_superseded: "Revision Superseded",
  packing_list: "Packing list",
  invoice: "Invoice",
  other: "Unclassified",
  health_check: "Worker health check",
  receipt: "Archive verification",
  model_missing: "Model missing",
  ready: "Ready",
  unavailable: "Unavailable",
  disabled: "Disabled",
  pending: "Pending",
};

export function label(value: string) {
  return labels[value] ?? value.replaceAll("_", " ");
}
