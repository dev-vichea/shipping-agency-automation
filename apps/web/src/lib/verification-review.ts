import type { Extraction, ReviewCorrection, ReviewField, ReviewWorkflow } from "./contracts";
import { reviewKey, type ReviewDraft } from "@/components/staff-review";

export const numericFields = new Set(["quantity", "unit_price", "amount", "packages", "gross_weight", "net_weight", "measurement"]);
export const dateFields = new Set(["invoice_date", "issue_date", "etd", "eta"]);

/** Remove only decisions whose evidence is changed by an explicit staff edit. */
export function replaceVerificationField(draft: ReviewDraft, edit: ReviewCorrection, workflow: ReviewWorkflow): ReviewDraft {
  const key = reviewKey(edit);
  const affected = new Set((workflow.field_suggestions ?? []).filter((offer) =>
    (offer.target && reviewKey(offer.target) === key) || offer.options.some((option) => reviewKey(option.source) === key),
  ).map((offer) => offer.key));
  const cdcHeader = edit.role === "invoice" && ["consignee", "invoice_date"].includes(edit.name);
  const cdcRow = edit.role === "invoice" && edit.row !== null;
  return {
    ...draft,
    corrections: [...draft.corrections.filter((entry) => reviewKey(entry) !== key && (!entry.finding_key || !affected.has(entry.finding_key))), edit],
    issue_actions: draft.issue_actions.filter((entry) => entry.key !== key && !affected.has(entry.key)),
    resolutions: draft.resolutions.filter((entry) => !affected.has(entry.key)),
    finding_decisions: draft.finding_decisions?.filter((entry) => !affected.has(entry.key) &&
      !(entry.source && reviewKey(entry.source) === key) &&
      !(entry.key.startsWith("cdc.row.") && (cdcHeader || (cdcRow && entry.key === `cdc.row.${edit.row}.mapping`)))),
    mappings: draft.mappings.filter((entry) => !cdcHeader && !(cdcRow && entry.invoice_row === edit.row)),
  };
}

export function sourceField(document: Extraction, ref: ReviewField) {
  return ref.row === null ? document.fields[ref.name] : document.items.find((item) => item.row === ref.row)?.fields[ref.name];
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
