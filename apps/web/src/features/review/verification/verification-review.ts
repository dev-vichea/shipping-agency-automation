import type {
  Extraction,
  Finding,
  LineComparison,
  ReviewCorrection,
  ReviewField,
  ReviewWorkflow,
} from "@/lib/contracts";
import { reviewKey, type ReviewDraft } from "@/features/review/staff-review";

export const numericFields = new Set(["quantity", "unit_price", "amount", "packages", "gross_weight", "net_weight", "measurement"]);
export const dateFields = new Set(["invoice_date", "issue_date", "etd", "eta"]);

/** Remove only decisions whose evidence is changed by an explicit staff edit. */
export function replaceVerificationField(draft: ReviewDraft, edit: ReviewCorrection, workflow: ReviewWorkflow): ReviewDraft {
  const key = reviewKey(edit);
  const affected = new Set((workflow.field_suggestions ?? []).filter((offer) =>
    (offer.target && reviewKey(offer.target) === key) || offer.options.some((option) => reviewKey(option.source) === key),
  ).map((offer) => offer.key));
  const cdcHeader = edit.role === "invoice" && ["consignee", "invoice_date"].includes(edit.name);
  const cdcDesc = edit.role === "invoice" && edit.row !== null && edit.name === "description";
  return {
    ...draft,
    corrections: [...draft.corrections.filter((entry) => reviewKey(entry) !== key && (!entry.finding_key || !affected.has(entry.finding_key))), edit],
    issue_actions: draft.issue_actions.filter((entry) => entry.key !== key && !affected.has(entry.key)),
    resolutions: draft.resolutions.filter((entry) => !affected.has(entry.key)),
    finding_decisions: draft.finding_decisions?.filter((entry) => !affected.has(entry.key) &&
      !(entry.source && reviewKey(entry.source) === key) &&
      !(entry.key.startsWith("cdc.row.") && (cdcHeader || (cdcDesc && entry.key === `cdc.row.${edit.row}.mapping`)))),
    mappings: draft.mappings.filter((entry) => !cdcHeader && !(cdcDesc && entry.invoice_row === edit.row)),
  };
}

/** Compute amount from quantity and unit price, formatted cleanly with up to 2 decimal places. */
export function calculateAmount(qtyStr: string | null | undefined, priceStr: string | null | undefined): string | null {
  if (!qtyStr || !priceStr) return null;
  const qty = parseFloat(qtyStr.replace(/,/g, ""));
  const price = parseFloat(priceStr.replace(/,/g, ""));
  if (isNaN(qty) || isNaN(price)) return null;
  const product = Math.round(qty * price * 100) / 100;
  const str = product.toFixed(2);
  if (str.endsWith("0")) {
    return str.slice(0, -1);
  }
  return str;
}

/** Fixed decimal addition keeps display totals out of binary floating-point arithmetic. */
export function decimalTotal(values: (string | null | undefined)[]): string | null {
  if (!values.length || values.some((value) => !value || !/^\d+(?:\.\d{1,6})?$/.test(value))) return null;
  const scale = BigInt(1_000_000);
  const sum = values.reduce((total, value) => {
    const [whole, fraction = ""] = value!.split(".");
    return total + BigInt(whole) * scale + BigInt(fraction.padEnd(6, "0"));
  }, BigInt(0));
  return `${sum / scale}${sum % scale ? `.${String(sum % scale).padStart(6, "0").replace(/0+$/, "")}` : ""}`;
}

/** Split party company name from multiline address/contact blocks */
export function splitPartyAndAddress(rawText: string | null | undefined): { name: string; address: string } {
  if (!rawText || !rawText.trim()) {
    return { name: "", address: "" };
  }

  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return { name: lines[0] ?? "", address: "" };
  }

  const companySuffix = /\b(?:LTD\.?|LIMITED|CORP\.?|INC\.?|COMPANY|CO\.,?\s*LTD\.?|LLC|PTE|PLC)\b/i;
  let splitIdx = 1;
  if (!companySuffix.test(lines[0]) && lines.length > 2 && companySuffix.test(lines[1])) {
    splitIdx = 2;
  }

  const name = lines.slice(0, splitIdx).join(" ");
  const address = lines.slice(splitIdx).join("\n");

  return { name, address };
}

/**
 * Find the corresponding packing list item row for an invoice line item row.
 * Searches via line comparisons, findings keys, item index alignment, or matching row numbers.
 */
export function findMatchingPackingRow(
  invoiceRow: number,
  invoiceDoc?: Extraction,
  packingDoc?: Extraction,
  lineItems?: LineComparison[],
  findings?: Finding[]
): number | null {
  if (!invoiceDoc || !packingDoc || !packingDoc.items.length) return null;

  // 1. Check line comparisons (from analysis.line_items)
  const lineMatch = lineItems?.find(
    (item) => item.invoice_row === invoiceRow && item.packing_row !== null
  );
  if (lineMatch && lineMatch.packing_row !== null) {
    if (packingDoc.items.some((it) => it.row === lineMatch.packing_row)) {
      return lineMatch.packing_row;
    }
  }

  // 2. Check findings (e.g. invoice_packing.description.10.11 or invoice_packing.quantity.10.11)
  for (const finding of findings ?? []) {
    const match = finding.key.match(/invoice_packing\.(?:description|quantity|unit|item)\.(\d+)\.(\d+)/);
    if (match && parseInt(match[1], 10) === invoiceRow) {
      const candidateRow = parseInt(match[2], 10);
      if (packingDoc.items.some((it) => it.row === candidateRow)) {
        return candidateRow;
      }
    }
  }

  // 3. Match by index in the items array (row order alignment)
  const invIdx = invoiceDoc.items.findIndex((it) => it.row === invoiceRow);
  if (invIdx !== -1 && packingDoc.items[invIdx]) {
    return packingDoc.items[invIdx].row;
  }

  // 4. Match by same row number if present in packingDoc
  if (packingDoc.items.some((it) => it.row === invoiceRow)) {
    return invoiceRow;
  }

  // 5. Single item fallback
  if (invoiceDoc.items.length === 1 && packingDoc.items.length === 1) {
    return packingDoc.items[0].row;
  }

  return null;
}

/**
 * Find the corresponding invoice line item row for a packing list line item row.
 */
export function findMatchingInvoiceRow(
  packingRow: number,
  packingDoc?: Extraction,
  invoiceDoc?: Extraction,
  lineItems?: LineComparison[],
  findings?: Finding[]
): number | null {
  if (!packingDoc || !invoiceDoc || !invoiceDoc.items.length) return null;

  // 1. Check line comparisons
  const lineMatch = lineItems?.find(
    (item) => item.packing_row === packingRow && item.invoice_row !== null
  );
  if (lineMatch && lineMatch.invoice_row !== null) {
    if (invoiceDoc.items.some((it) => it.row === lineMatch.invoice_row)) {
      return lineMatch.invoice_row;
    }
  }

  // 2. Check findings
  for (const finding of findings ?? []) {
    const match = finding.key.match(/invoice_packing\.(?:description|quantity|unit|item)\.(\d+)\.(\d+)/);
    if (match && parseInt(match[2], 10) === packingRow) {
      const candidateRow = parseInt(match[1], 10);
      if (invoiceDoc.items.some((it) => it.row === candidateRow)) {
        return candidateRow;
      }
    }
  }

  // 3. Match by index in the items array
  const plIdx = packingDoc.items.findIndex((it) => it.row === packingRow);
  if (plIdx !== -1 && invoiceDoc.items[plIdx]) {
    return invoiceDoc.items[plIdx].row;
  }

  // 4. Match by same row number
  if (invoiceDoc.items.some((it) => it.row === packingRow)) {
    return packingRow;
  }

  // 5. Single item fallback
  if (invoiceDoc.items.length === 1 && packingDoc.items.length === 1) {
    return invoiceDoc.items[0].row;
  }

  return null;
}

/**
 * When updating description or unit on a Commercial Invoice line item,
 * automatically sync that change to the corresponding Packing List (PKL) line item.
 */
export function syncInvoiceEditToPackingList(
  draft: ReviewDraft,
  invoiceEdit: ReviewCorrection,
  workflow: ReviewWorkflow,
  extractions: Extraction[],
  lineItems?: LineComparison[],
  findings?: Finding[]
): ReviewDraft {
  if (invoiceEdit.role !== "invoice" || invoiceEdit.row === null) {
    return draft;
  }
  if (!["description", "english_description", "unit"].includes(invoiceEdit.name)) {
    return draft;
  }

  const invoiceDoc = extractions.find((doc) => doc.role === "invoice");
  const packingDoc = extractions.find((doc) => doc.role === "packing_list");
  if (!invoiceDoc || !packingDoc) return draft;

  const packingRow = findMatchingPackingRow(invoiceEdit.row, invoiceDoc, packingDoc, lineItems, findings);
  if (packingRow === null) return draft;

  const targetName = invoiceEdit.name === "english_description" ? "description" : invoiceEdit.name;
  const packingCorrection: ReviewCorrection = {
    document_id: packingDoc.document_id,
    role: "packing_list",
    row: packingRow,
    name: targetName,
    value: invoiceEdit.value,
    unit: targetName === "unit" ? invoiceEdit.value : (invoiceEdit.unit ?? null),
    currency: invoiceEdit.currency ?? null,
    note: invoiceEdit.note ? `Synced from Commercial Invoice: ${invoiceEdit.note}` : "Synced from Commercial Invoice",
    confirmed: invoiceEdit.confirmed,
  };

  return replaceVerificationField(draft, packingCorrection, workflow);
}

/**
 * When resetting or undoing an edit on a Commercial Invoice line item,
 * also remove the synced correction on the corresponding Packing List (PKL) line item.
 */
export function removeSyncedPackingListField(
  draft: ReviewDraft,
  invoiceRef: ReviewField,
  extractions: Extraction[],
  lineItems?: LineComparison[],
  findings?: Finding[]
): ReviewDraft {
  if (invoiceRef.role !== "invoice" || invoiceRef.row === null) {
    return draft;
  }
  if (!["description", "english_description", "unit"].includes(invoiceRef.name)) {
    return draft;
  }

  const invoiceDoc = extractions.find((doc) => doc.role === "invoice");
  const packingDoc = extractions.find((doc) => doc.role === "packing_list");
  if (!invoiceDoc || !packingDoc) return draft;

  const packingRow = findMatchingPackingRow(invoiceRef.row, invoiceDoc, packingDoc, lineItems, findings);
  if (packingRow === null) return draft;

  const targetName = invoiceRef.name === "english_description" ? "description" : invoiceRef.name;
  const pklKey = reviewKey({
    document_id: packingDoc.document_id,
    role: "packing_list",
    row: packingRow,
    name: targetName,
  });

  return {
    ...draft,
    corrections: draft.corrections.filter((c) => reviewKey(c) !== pklKey),
  };
}
