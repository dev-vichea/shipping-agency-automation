export type Profile = { email: string };

export type CaseSummary = {
  id: string;
  state: string;
  channel: string;
  detected_reference: string | null;
  review_reason: string | null;
  subject: string | null;
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
