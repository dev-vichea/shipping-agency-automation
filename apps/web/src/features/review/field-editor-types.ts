import type { ConsigneeSourceRef, Evidence } from "@/lib/contracts";

export type FieldChoice = {
  id: string;
  label: string;
  value: string;
  unit: string | null;
  currency: string | null;
  evidence: Evidence;
  issueKey?: string;
  alternativeIndex?: number;
  consigneeSource?: ConsigneeSourceRef;
};

export type FieldEdit = {
  value: string;
  unit: string | null;
  currency: string | null;
  choice?: FieldChoice;
};

export type FieldEditor = {
  value: string;
  unit: string | null;
  currency: string | null;
  dimension?: "unit" | "currency";
  multiline: boolean;
  reviewed: boolean;
  busy: boolean;
  choices: FieldChoice[];
  onPreview: (choice?: FieldChoice) => void;
  onSave: (edit: FieldEdit) => Promise<void>;
  onUndo: () => Promise<void>;
};
