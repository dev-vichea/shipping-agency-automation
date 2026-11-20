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
