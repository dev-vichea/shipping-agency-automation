# Harborway document suggestions and CDC review

The existing intake pipeline now supports one review flow for document comparisons and CDC material identity. It reuses the current extraction payloads, immutable document revisions, PostgreSQL analysis snapshots, Celery outbox, staff reviews, permit preparation and internal reservation checks. The legacy Streamlit services remain unchanged.

## Staff workflow

1. Upload INV/PL/B/L or receive documents through the existing intake connector. Extraction and deterministic comparisons run through the existing worker.
2. Register a verified company CDC workbook. Keep automatic template reading for supported layouts, or choose a worksheet, header row and column mapping. Inspect original rows and the imported item preview, verify company/year/approval reference, then register. Repeating the same file and mapping returns the existing version; another file or mapping creates a distinct version without overwriting history.
3. Select the applicable CDC version when company/year lookup is ambiguous. No version or item is invented when lookup fails.
4. Open **Review Warnings**. **Document Fields** shows conflicting or uncertain values and source locations. Choose a cited value or enter a correction with a reason. **CDC Items** shows invoice lines, ranked real CDC rows, source cells, units, prices and current checks. Choose a material and approve, reject or flag it unresolved with a reason.
5. Preparing a draft saves current review data. The suggestion toggle only controls presentation. Confirm all is limited to passing document comparisons; it does not select CDC mappings or approve uncertain findings.
6. Material identity and compliance are separate. A confirmed material may still have insufficient/unknown quantity, incompatible units, a price/currency discrepancy, HS/specification conflict, or a stale balance. Those checks keep permit preparation pending. Intake approval can still preserve a reviewed import with outstanding CDC issues, as in the existing workflow. No suggestion or finding decision deducts official CDC stock.
7. A revised document creates a new analysis revision. Earlier approvals remain in history, appear as superseded and cannot be submitted against the new revision. The initial implementation conservatively rechecks all active documents and requires a new review; it does not carry older per-finding approvals forward.
8. **Confirm Final B/L** records receipt confirmation for the current analysis revision. It requires `expected_revision`, rejects stale/pending analyses, and does not approve the intake, resolve CDC issues or change approved dates.

## Implementation and contracts

### Verification document editor

The Verification tab uses a resizable document editor and the existing printable INV/PL preview with all three templates: CDC Classic, Freight Agency and Commercial Billing. Original PDF/Excel evidence remains in the Documents tab. Invoice/Packing List tabs switch both panes; the editor follows extracted header fields and the original line-column order where cell/coordinate evidence is available. Numeric/date fields, sticky table headers, a pinned inline CDC column and expandable candidate details reuse the existing extraction and review APIs. Both INV/PL switchers stay synchronized, and saved field/line edits feed the selected print template.

Edits are serialized against the last completed review ID, so rapid cell saves preserve earlier edits. Autosaved corrections carry `confirmed=false` in the existing staff-review JSON payload and block approval until individually confirmed. Older callers retain `confirmed=true` by default. Confirmed cells require an explicit edit and reason before replacement; opening suggestions never changes them. Unsaved cells block document switching and approval. Totals use decimal string addition, and mixed units are not combined. Changing relevant invoice fields invalidates affected CDC decisions and recomputes checks. Original documents and past staff reviews remain immutable; no additional database migration is needed beyond 0012.

The focused regression is `apps/web/e2e/verification-editor.spec.ts`; it covers serialized autosave, manual-save mode, confirmation locks, reloading, tab synchronization, split resizing, inline CDC review, mobile layout and all three print templates. `apps/api/tests/test_verification_editor.py` verifies that unconfirmed edits cannot be approved and stale saves cannot replace newer reviews.

- `POST /api/v1/cdc/versions/worksheets`: bounded worksheet/header-row previews from an uploaded XLS/XLSX file. Requires workspace administrator access.
- CDC preview and registration accept an optional JSON `selection` multipart field with `sheet`, one-based `header_row`, one-based `columns`, and optional explicit `currency`. Required mapped columns are `description`, `unit`, and `approved_quantity`. Other columns include material code, HS code, specification, serial, price, approved value and remaining quantity/value. Duplicate columns, missing material quantities and negative numeric limits are rejected.
- `GET /api/v1/intakes/{id}/review` now returns `field_suggestions` and `finding_audit`. Alternatives retain source document IDs, role, row, normalized value, units/currency and original evidence locations. Agreement does not establish source authority.
- Existing `POST /api/v1/intakes/{id}/review` accepts `finding_decisions`: `{key, action, note, source?, master_row?}`. Actions are `approved`, `rejected`, and `unresolved`. A CDC identity key is `cdc.row.<invoice row>.mapping`. Document source references must resolve to a present cited value in the current immutable analysis. Uncertain OCR values need explicit staff correction.
- Decisions use the existing `expected_revision` and `expected_review_id` checks and case row lock. Each changed decision is appended to `review_finding_decisions`, linked to the exact analysis snapshot, actor and immutable staff review. Repeated unchanged decisions do not duplicate audit entries. Removing a decision records that it needs revalidation.
- Matching uses original/local-glossary/verified English text, material codes where available, and HS identifiers. Every candidate is a real row in the selected version. Scores represent similarity, not regulatory confidence. Optional model proposals remain suggestions. Monetary and quantity calculations use Decimal; currency is never assumed to be USD.
- Checks run against the actual staff-selected CDC rows, including combined quantities/values for repeated mappings. `cdc_ready` and `cdc_blockers` remain separate from document-review readiness. Existing permit generation and serialized internal reservation checks still apply at final intake approval.

## Migration and running

Apply Alembic migration **0012** before starting the updated API/worker. It adds the decision audit table, CDC import configuration/key and a separate Final B/L confirmation revision. Existing versions retain `import_key=auto`; no business records, document originals or balances are rewritten. Readiness checks expect this migration.

In the existing development Compose setup:

```sh
docker compose -f compose.dev.yml build api worker scheduler migrate web
docker compose -f compose.dev.yml run --rm migrate
docker compose -f compose.dev.yml up -d api worker scheduler web
```

Downgrade requires that no two versions share the former uniqueness key with different worksheet mappings. Preserve those versions rather than deleting history to force a downgrade.

## Verification and practical limits

Backend regression tests cover cited corrections, rejection, stale document revisions, simultaneous saves, forged sources/CDC rows, selected-alternative pricing, aggregate shortages, missing currencies, mapped imports, replay/versioning and original workbook evidence. The browser regression exercises both review tabs, the read-only toggle, an individual CDC decision, persistence after reload and unresolved permit checks.

Formula caches are read from the workbook; this implementation does not recalculate Excel formulas. Missing or stale balances remain unknown. There is no invented translation, exchange rate, material identity, customs-clearance result or automatic official balance deduction. Multilingual and private-corpus checks continue to depend on the existing optional language packs and private fixtures.
