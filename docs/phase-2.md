# Phase 2 document processing

The worker verifies the archive, then analyzes the current originals for one
intake revision. A receipt, explicit reprocess request, revision upload, or
CDC version change can queue analysis. Older results stay in PostgreSQL.
An analysis run and its extracted documents are saved together, and a worker
finishing an older revision cannot publish over a newer one. Original file
bytes, source messages, and Phase 1 draft imports remain in their existing
stores.

The adapters under `apps/api/src/shipping_ai/documents/` reuse the legacy
invoice, packing and B/L parsers for layout and row discovery. Phase 2 reads
explicit source values into typed fields with source IDs and cell or PDF
locations. It preserves missing values as null and treats OCR as uncertain.
The legacy parser modules have no changes.

Rules under `apps/api/src/shipping_ai/review/` use decimal arithmetic for
quantities, prices and values. Quantity tolerance is 0.000001 in the
comparison unit, weight tolerance is 0.05 kg, price tolerance is 0.0001 in
the comparison currency per unit, and amount tolerance is 0.01 in the
comparison currency. Package counts are compared exactly. Conversions are
limited to explicit aliases and the count, mass and length factors in the
rules. Different currencies are flagged. Package, weight, party and transport
checks use overlapping B/L values. Missing sailing dates do not determine
the outcome.

CDC versions record the original file checksum, company, year, approval
reference, recording staff member, and optional balance date. Staff select the
exact version. A company mismatch suppresses candidate comparisons. Rankings
reuse the legacy matcher and local term dictionary. Quantity and value checks
use the combined amounts for lines pointing to the same provisional candidate.
A balance is unknown when its workbook value is missing, its date is
unavailable, or it is over 30 days old. Phase 2 retains CDC matches as suggestions
for staff review.

The worker persists deterministic findings before requesting optional advice.
The Ollama call uses a versioned prompt and JSON schema, with at most four
findings per request and short product descriptions. The advisory record
contains the model, prompt version, trace ID, and validated suggestions tied to
known findings. The worker retries temporary failures. Numeric and CDC outcomes
remain the results of the deterministic rules.

The Review Center displays archived originals and source excerpts beside
extracted fields and grouped checks. Its CDC controls register a staff-verified
workbook and reprocess the selected intake. Original documents are available
through authenticated downloads. Review corrections and approvals belong to
Phase 3.

Layout handling remains conservative. The worker bounds archive size, worksheet
dimensions, item counts, document counts and OCR pages. An unsupported
layout, multiple current documents of the same type, split or grouped item
lines without a unique pairing, missing formula caches, and uncertain OCR may
require manual review. PDF and Excel previews display excerpts; the full
original is available to download.

Setup and fixture locations are in [the development guide](development.md).


## Verification

- The legacy command `python -m unittest discover -s tests -v` passed 34 tests
  using the provisioned local fixtures. The existing Streamlit health check
  returned `ok`.
- `uv run --project apps/api pytest apps/api/tests -q` passed 20 tests against
  disposable PostgreSQL and Redis. Ruff lint and format checks passed.
- `corepack pnpm lint`, `build`, `typecheck` and `test:e2e` passed from
  `apps/web`. Both browser tests ran against the Compose stack.
- Alembic migrated the running Phase 1 database to revision `0002`, queued
  existing intakes, and reported no schema drift. The live worker saved
  findings and validated Qwen suggestions for a synthetic arrival and its
  subsequent CDC selection.
- The Compose worker used Tesseract on a raster-only B/L. Its output
  remained uncertain and linked to the OCR line. In the smoke test it
  misread a zero as O, which stayed visible in the source evidence.
