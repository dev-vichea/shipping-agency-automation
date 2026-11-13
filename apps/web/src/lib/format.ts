const time = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Phnom_Penh",
});

export function timestamp(value: string | null) {
  return value ? time.format(new Date(value)) : "—";
}

const labels: Record<string, string> = {
  PASS: "Pass",
  WARNING: "Warning",
  MISMATCH: "Mismatch",
  NEEDS_REVIEW: "Needs review",
  analysis: "Document analysis",
  ai: "AI suggestions",
  previous_analysis: "Previous analysis",
  extracted: "Extracted",
  partial: "Partial",
  unsupported_layout: "Unsupported layout",
  present: "Present",
  missing: "Missing",
  uncertain: "Uncertain",
  simulated: "Simulated",
  queued: "Queued",
  needs_review: "Needs review",
  failed: "Failed",
  running: "Running",
  succeeded: "Succeeded",
  draft: "Draft",
  draft_bl: "Draft B/L",
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

export const pageSize = 30;

export function parseOffset(value?: string | string[]) {
  const offset = Number(typeof value === "string" ? value : 0);
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= 99_990 ? offset : 0;
}
