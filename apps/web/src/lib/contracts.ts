export type Profile = { email: string; approval_alerts: boolean; automation_alerts: boolean };

export type CaseSummary = {
  id: string;
  state: string;
  channel: string;
  company_id: string | null;
  company: string | null;
  detected_reference: string | null;
  review_reason: string | null;
  subject: string | null;
  sender?: string | null;
  received_at?: string | null;
  analysis_outcome?: Finding["outcome"] | null;
  review_checks?: Record<string, Finding["outcome"]>;
  document_roles?: string[];
  issue_count?: number;
  bill_of_lading?: string | null;
  created_at: string;
  updated_at: string;
  attachment_count: number;
};

export type Document = {
  id: string;
  source_message_id: string;
  parent_version_id: string | null;
  original_filename: string;
  classification: string;
  mime: string;
  sha256: string;
  size_bytes: number;
  received_at: string;
};

export type CaseDetail = CaseSummary & {
  messages: {
    id: string;
    channel: string;
    provider_message_id: string;
    thread_id: string | null;
    sender: string | null;
    subject: string | null;
    body: string | null;
    received_at: string;
  }[];
  documents: Document[];
  import_id: string | null;
};

export type Receipt = { case_id: string; run_id: string; replayed: boolean };

export type ImportSummary = {
  id: string;
  intake_case_id: string;
  company: string;
  invoice_no: string;
  supplier: string | null;
  consignee: string | null;
  state: string;
  etd: string | null;
  eta: string | null;
  etd_status: string;
  eta_status: string;
  created_at: string;
  approved_at: string | null;
};

export type ImportDetail = ImportSummary & {
  documents: Document[];
  items: {
    id: string;
    line_no: number;
    raw_description: string;
    normalized_description: string | null;
    quantity: string | null;
    unit: string | null;
    currency: string | null;
    amount: string | null;
    verification_state: string;
  }[];
};

export type Run = {
  id: string;
  trace_id: string;
  intake_case_id: string | null;
  stage: string;
  state: string;
  attempt: number;
  retry_count: number;
  available_at: string;
  started_at: string | null;
  ended_at: string | null;
  error_code: string | null;
};

export type Provider = {
  provider: string;
  model: string;
  state: string;
  context: number;
  max_concurrency: number;
};

export type Evidence = {
  document_id: string;
  sheet: string | null;
  cell: string | null;
  row: number | null;
  page: number | null;
  line: number | null;
  raw: string | null;
  bbox?: [number, number, number, number] | null;
  boxes?: [number, number, number, number][];
};

export type ExtractedField = {
  value: string | null;
  unit: string | null;
  currency: string | null;
  status: "present" | "missing" | "uncertain";
  evidence: Evidence[];
  review_reason?: string | null;
  alternatives?: { value: string; unit: string | null; currency: string | null; evidence: Evidence[] }[];
};

export type Extraction = {
  document_id: string;
  role: string;
  status: string;
  method: string;
  sheet: string | null;
  error: string | null;
  fields: Record<string, ExtractedField>;
  items: { row: number; fields: Record<string, ExtractedField> }[];
  source_excerpt: Evidence[];
  sections?: Extraction[];
};

export type Finding = {
  key: string;
  group: string;
  field: string;
  outcome: "PASS" | "WARNING" | "MISMATCH" | "NEEDS_REVIEW";
  explanation: string;
  left: string | null;
  right: string | null;
  evidence: Evidence[];
};

export type MasterVersion = {
  id: string;
  source_id: string;
  company: string;
  year: number;
  approval_ref: string;
  layout: string;
  original_filename: string;
  balance_as_of: string | null;
};

export type LineComparison = {
  invoice_row: number | null;
  packing_row: number | null;
  quantity_delta: string | null;
  delta_unit: string | null;
  outcome: Finding["outcome"];
};

export type ReviewAnalysis = {
  revision: number;
  analysis_revision: number | null;
  state: "pending" | "available" | "failed";
  run_id: string | null;
  trace_id: string | null;
  rules_version: string | null;
  extracted_at: string | null;
  outcome: Finding["outcome"] | null;
  extractions: Extraction[];
  findings: Finding[];
  line_items: LineComparison[];
  candidates: {
    invoice_document_id: string;
    invoice_row: number;
    master_row: number;
    description: string;
    score: number;
    evidence: Evidence;
  }[];
  selected_master: MasterVersion | null;
  analyzed_master: MasterVersion | null;
  ai_state: string | null;
  ai_model: string | null;
  ai_prompt_version: string | null;
  ai_trace_id: string | null;
  ai_suggestions: {
    finding_key: string;
    relationship: string;
    explanation: string;
    suggested_action: string;
  }[];
};

export type MasterItems = { internally_reserved: Record<number, string>;
  version: MasterVersion;
  total: number;
  categories?: string[];
  category_counts?: Record<string, number>;
  items: {
    row: number;
    serial?: string | null;
    category?: string | null;
    description: ExtractedField;
    unit: ExtractedField;
    approved_quantity: ExtractedField;
    approved_value: ExtractedField;
    unit_price: ExtractedField;
    remaining_quantity: ExtractedField;
    remaining_value: ExtractedField;
  }[];
};

export type ReviewCorrection = {
  document_id: string;
  role: "invoice" | "packing_list" | "draft_bl";
  row: number | null;
  name: string;
  value: string;
  unit: string | null;
  currency: string | null;
  note: string;
};
export type StaffReview = {
  id: string;
  actor_id: string;
  created_at: string;
  ready: boolean;
  snapshot_hash: string;
  corrections: ReviewCorrection[];
  changes: { edit: ReviewCorrection; before: ExtractedField; after: ExtractedField }[];
  resolutions: { key: string; note: string }[];
  mappings: { invoice_row: number; master_row: number }[];
  verify_cdc_mappings: boolean;
  blockers: string[];
  permit_pending: string | null;
  request_correction: string | null;
  findings: Finding[];
  candidates: ReviewAnalysis["candidates"];
};
export type ReviewWorkflow = {
  review: StaffReview | null;
  decisions: {
    id: string; scope: string; decision: string; actor_id: string; revision: number;
    created_at: string; snapshot_hash: string; notes: string; permit_pending: string | null;
    recipient: string | null;
    review_id: string | null;
  }[];
};
export type PermitDraft = { id: string; sha256: string; created_at: string; revision: number; current: boolean; recipient: string | null };
export type ImportReport = {
  imports: number;
  totals: Record<string, string>;
  total_rows: number;
  rows: {
    id: string; invoice_no: string; company: string; supplier: string; approved_at: string;
    etd: string | null; eta: string | null; currency: string; amount: string;
  }[];
};


export type Workspace = { id: string; name: string; role: "admin" | "operator" };
export type WorkspaceList = { active_id: string | null; workspaces: Workspace[] };
export type StaffMember = { id: string; email: string; role: Workspace["role"] };
export type Company = {
  id: string; name: string; aliases: string[]; identifier: string | null;
  contact_name: string | null; contact_email: string | null; created_at: string;
};
export type CompanyDetail = Company & { staff: Pick<StaffMember, "id" | "email">[] };
export type Overview = { cases: Record<string, number>; runs: Record<string, number>; processing: number };

export type CaseActivity = {
  id: string; event_type: string; actor_type: string; created_at: string; before_state: string | null;
  after_state: string | null; automation_run_id: string | null; actor: string | null;
};

export type InvestigationRun = Run & { investigation: { status: string; [key: string]: unknown } };

export type FolderSource = {
  id: string;
  name: string;
  company_id: string;
  company: string;
  enabled: boolean;
  status: "paused" | "awaiting_setup" | "offline" | "connected" | "waiting_for_files" | "folder_unavailable" | "file_rejected" | "upload_retry";
  last_checked_at: string | null;
  has_received: boolean;
};

export type Integrations = {
  gmail: {
    configured: boolean; connected: boolean; enabled: boolean; mailbox: string | null;
    senders: string[]; company_id: string | null; last_synced_at: string | null; error: string | null;
  };
  telegram: {
    configured: boolean;
    bot_username?: string | null;
    mini_app: boolean;
    recipients: { id: string; email: string; display_name: string }[];
  };
};
export type TelegramPairing = {
  token: string;
  bot_username: string | null;
  pairing_url: string | null;
  expires_in: number;
};
export type TelegramPreview = {
  configured: boolean; revision: number; payload_hash: string; message: string; quick: boolean;
  buttons: string[];
  recipients: { id: string; email: string; name: string }[];
};
export type QuickApproval = { eligible: boolean; message: string; revision: number; review_id: string | null };
