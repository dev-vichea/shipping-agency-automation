import { expect, test } from "@playwright/test";
import type { Extraction, Finding, LineComparison, ReviewCorrection, ReviewWorkflow } from "../src/lib/contracts";
import { reviewDraft } from "../src/features/review/staff-review";
import {
  findMatchingInvoiceRow,
  findMatchingPackingRow,
  removeSyncedPackingListField,
  syncInvoiceEditToPackingList,
} from "../src/features/review/verification/verification-review";

test.describe("Commercial Invoice to PKL (Packing List) sync logic", () => {
  const invoiceDoc: Extraction = {
    document_id: "inv-doc-1",
    role: "invoice",
    status: "extracted",
    method: "deterministic",
    sheet: null,
    error: null,
    source_excerpt: [],
    fields: {},
    items: [
      {
        row: 10,
        fields: {
          description: { status: "present", value: "Raw Invoice Item 1", evidence: [], unit: null, currency: null },
          unit: { status: "present", value: "PCS", evidence: [], unit: null, currency: null },
        },
      },
      {
        row: 12,
        fields: {
          description: { status: "present", value: "Raw Invoice Item 2", evidence: [], unit: null, currency: null },
          unit: { status: "present", value: "ROLLS", evidence: [], unit: null, currency: null },
        },
      },
    ],
  };

  const packingDoc: Extraction = {
    document_id: "pkl-doc-1",
    role: "packing_list",
    status: "extracted",
    method: "deterministic",
    sheet: null,
    error: null,
    source_excerpt: [],
    fields: {},
    items: [
      {
        row: 11,
        fields: {
          description: { status: "present", value: "Raw PKL Item 1", evidence: [], unit: null, currency: null },
          unit: { status: "present", value: "PCS", evidence: [], unit: null, currency: null },
        },
      },
      {
        row: 13,
        fields: {
          description: { status: "present", value: "Raw PKL Item 2", evidence: [], unit: null, currency: null },
          unit: { status: "present", value: "ROLLS", evidence: [], unit: null, currency: null },
        },
      },
    ],
  };

  const lineItems: LineComparison[] = [
    { invoice_row: 10, packing_row: 11, quantity_delta: null, delta_unit: null, outcome: "PASS" },
    { invoice_row: 12, packing_row: 13, quantity_delta: null, delta_unit: null, outcome: "PASS" },
  ];

  const workflow: ReviewWorkflow = {
    review: null,
    decisions: [],
    issues: [],
    field_suggestions: [],
  };

  test("findMatchingPackingRow resolves matching row from lineItems", () => {
    expect(findMatchingPackingRow(10, invoiceDoc, packingDoc, lineItems)).toBe(11);
    expect(findMatchingPackingRow(12, invoiceDoc, packingDoc, lineItems)).toBe(13);
  });

  test("findMatchingPackingRow resolves matching row from findings", () => {
    const findings: Finding[] = [
      {
        group: "invoice_packing",
        field: "description",
        outcome: "MISMATCH",
        explanation: "Descriptions differ",
        evidence: [],
        left: null,
        right: null,
        key: "invoice_packing.description.10.11",
      },
    ];
    expect(findMatchingPackingRow(10, invoiceDoc, packingDoc, [], findings)).toBe(11);
  });

  test("findMatchingPackingRow resolves matching row by index alignment as fallback", () => {
    expect(findMatchingPackingRow(10, invoiceDoc, packingDoc, [], [])).toBe(11);
    expect(findMatchingPackingRow(12, invoiceDoc, packingDoc, [], [])).toBe(13);
  });

  test("findMatchingInvoiceRow resolves inverse match", () => {
    expect(findMatchingInvoiceRow(11, packingDoc, invoiceDoc, lineItems)).toBe(10);
    expect(findMatchingInvoiceRow(13, packingDoc, invoiceDoc, lineItems)).toBe(12);
  });

  test("syncs description from invoice to packing list", () => {
    const initialDraft = reviewDraft(null);

    const invoiceEdit: ReviewCorrection = {
      document_id: "inv-doc-1",
      role: "invoice",
      row: 10,
      name: "description",
      value: "NEW CLEAN DESCRIPTION",
      unit: null,
      currency: null,
      note: "Updated by staff",
      confirmed: false,
    };

    const synced = syncInvoiceEditToPackingList(
      initialDraft,
      invoiceEdit,
      workflow,
      [invoiceDoc, packingDoc],
      lineItems
    );

    expect(synced.corrections).toHaveLength(1);
    const pklCorr = synced.corrections[0];
    expect(pklCorr.document_id).toBe("pkl-doc-1");
    expect(pklCorr.role).toBe("packing_list");
    expect(pklCorr.row).toBe(11);
    expect(pklCorr.name).toBe("description");
    expect(pklCorr.value).toBe("NEW CLEAN DESCRIPTION");
    expect(pklCorr.note).toContain("Synced from Commercial Invoice");
  });

  test("syncs english_description to packing list as description", () => {
    const initialDraft = reviewDraft(null);

    const invoiceEdit: ReviewCorrection = {
      document_id: "inv-doc-1",
      role: "invoice",
      row: 12,
      name: "english_description",
      value: "POLYESTER YARN 150D",
      unit: null,
      currency: null,
      note: "English translation",
      confirmed: true,
    };

    const synced = syncInvoiceEditToPackingList(
      initialDraft,
      invoiceEdit,
      workflow,
      [invoiceDoc, packingDoc],
      lineItems
    );

    expect(synced.corrections).toHaveLength(1);
    const pklCorr = synced.corrections[0];
    expect(pklCorr.document_id).toBe("pkl-doc-1");
    expect(pklCorr.role).toBe("packing_list");
    expect(pklCorr.row).toBe(13);
    expect(pklCorr.name).toBe("description");
    expect(pklCorr.value).toBe("POLYESTER YARN 150D");
    expect(pklCorr.confirmed).toBe(true);
  });

  test("syncs unit from invoice to packing list", () => {
    const initialDraft = reviewDraft(null);

    const invoiceEdit: ReviewCorrection = {
      document_id: "inv-doc-1",
      role: "invoice",
      row: 10,
      name: "unit",
      value: "KGS",
      unit: null,
      currency: null,
      note: "Corrected unit",
      confirmed: true,
    };

    const synced = syncInvoiceEditToPackingList(
      initialDraft,
      invoiceEdit,
      workflow,
      [invoiceDoc, packingDoc],
      lineItems
    );

    expect(synced.corrections).toHaveLength(1);
    const pklCorr = synced.corrections[0];
    expect(pklCorr.document_id).toBe("pkl-doc-1");
    expect(pklCorr.role).toBe("packing_list");
    expect(pklCorr.row).toBe(11);
    expect(pklCorr.name).toBe("unit");
    expect(pklCorr.value).toBe("KGS");
    expect(pklCorr.confirmed).toBe(true);
  });

  test("does not sync non-matching fields like unit_price or amount", () => {
    const initialDraft = reviewDraft(null);

    const invoiceEdit: ReviewCorrection = {
      document_id: "inv-doc-1",
      role: "invoice",
      row: 10,
      name: "unit_price",
      value: "15.00",
      unit: null,
      currency: "USD",
      note: "Price edit",
      confirmed: true,
    };

    const synced = syncInvoiceEditToPackingList(
      initialDraft,
      invoiceEdit,
      workflow,
      [invoiceDoc, packingDoc],
      lineItems
    );

    expect(synced.corrections).toHaveLength(0);
  });

  test("removes synced packing list field when invoice edit is undone", () => {
    const draftWithSynced = {
      ...reviewDraft(null),
      corrections: [
        {
          document_id: "inv-doc-1",
          role: "invoice" as const,
          row: 10,
          name: "description",
          value: "NEW CLEAN DESCRIPTION",
          unit: null,
          currency: null,
          note: "Updated by staff",
        },
        {
          document_id: "pkl-doc-1",
          role: "packing_list" as const,
          row: 11,
          name: "description",
          value: "NEW CLEAN DESCRIPTION",
          unit: null,
          currency: null,
          note: "Synced from Commercial Invoice",
        },
      ],
    };

    const cleaned = removeSyncedPackingListField(
      draftWithSynced,
      { document_id: "inv-doc-1", role: "invoice", row: 10, name: "description" },
      [invoiceDoc, packingDoc],
      lineItems
    );

    expect(cleaned.corrections).toHaveLength(1);
    expect(cleaned.corrections[0].role).toBe("invoice");
  });
});
