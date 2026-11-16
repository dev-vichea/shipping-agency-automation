# Shipping Agency AI architecture audit and package-count investigation

Reviewed 2026-11-14 in the current worktree, including the Phase 3 code already
present when this work began. The repository's Phase 0–3 foundations remain
the entry points for intake and approval. This upgrade is a separate, opt-in
worker stage added alongside the existing Ollama advisory.

## Seven-stage audit

| Stage | Verified implementation | Open gap |
| --- | --- | --- |
| 1. Intake | Staff-authenticated simulated upload, content-addressed private vault, receipt checksum, stable provider ID with replay checks and parent links for revisions. | Gmail and Telegram ingestion are outside the current workflow. |
| 2. Processing | PostgreSQL outbox rows drive one Celery worker through Redis and Beat. The worker uses legacy supplier Excel adapters, PyMuPDF and Tesseract. Ollama generates typed suggestions after deterministic analysis. | The original OCR path flattens page locations and uses a fixed full-page fallback. Legacy extraction can overrun its aggregate budget during an individual document parse. |
| 3. Validation | Python compares INV/PL lines and supported numeric dimensions and checks overlapping B/L summaries. Source rows, cell coordinates and PDF page/line references accompany supported extractions. | Older PDF fields generally lack bounding boxes. Multi-document role ambiguity requires staff judgment, and transport movement linkage is incomplete. |
| 4. CDC | Verified workbook versions are recorded with company, year, approval reference, workbook hash and balance date. RapidFuzz candidates remain suggestions. Permit preparation rechecks units, price and aggregate reviewed amounts for the selected rows against the workbook limits where available. | Balance is a workbook snapshot and can be unknown or stale. Two drafts can reference the same remaining quota. There is no reservation ledger or atomic consumption operation. |
| 5. Staff review | Staff save an immutable review revision with a snapshot hash, corrections, notes, mapping selections and explicit verification. The backend recalculates blockers. | All active staff currently share one workspace and privileges. Stronger company and role scopes are needed for broader deployment. |
| 6. Business approval | A staff action locks the case, checks the review and revision, and commits one import and any eligible permit workbook in one transaction. Approval replay returns the saved decision. | Permit eligibility is specific to the existing workbook profile. The Phase 3 workflow does not model declaration or actual customs clearance. |
| 7. Deliverables | Approved-import reporting and checksum-backed permit downloads exist. Separate release authorization records the draft and named broker. | Release authorization records consent for later delivery. The application has no live broker transmission or evidence-backed customs clearance workflow. |

The checkout runs legacy Streamlit separately on port 8501. Its SQLite records
and parser, matcher and exporter contracts remain in place. The real API-backed
demo is `workflow_demo/`. The older `ui_demo/` remains the browser-only mockup.
The demo previously preselected CDC rows, generated staff attestations and
included development credentials. Both demo entry points now require explicit
staff selections and sign-in. The standalone demo presets use generated
fictional files. Automatic assignment of the newest CDC workbook based on
company name alone was removed from analysis. Staff select the applicable
registered version, including its year and approval reference. Persisted
selections can still be reviewed and replaced through the existing endpoint.

## Processing flow

**Before**  
Archive → checksum → extract → deterministic validation and CDC ranking →
optional Ollama advisory → staff review → staff approval → deliverables.

**With the opt-in worker**  
Archive → checksum → extract → persist deterministic review and CDC findings.
For one current B/L and one packing list with a usable package total, a missing,
uncertain or conflicting B/L count queues an investigation for that revision.
Inspect source → choose permitted tool → read evidence → observe → choose the
next tool → compare deterministically → show proposal or staff-review reason.
The original review and the investigation both remain available for staff.

The allowlist is `inspect_source_evidence`, `extract_pdf_text`,
`ocr_pdf_region` with a page scan or a crop derived by the previous tool,
`compare_document_fields`, and `request_staff_review`. A registered tool
must also be legal at its current step. The model receives the objective, legal
actions, candidate counts and ambiguity flags. The server chooses the case,
revision, original, page and crop from persisted evidence. Structured
[Ollama responses](https://docs.ollama.com/capabilities/structured-outputs) are
validated server-side. With the model disabled the same registry runs under a
deterministic policy.

The text path requires an unambiguous, labelled line. The scan path requires
two high-confidence Tesseract reads using different segmentation and render
settings, with identical counts from overlapping page coordinates. This
corroborates a proposal for staff. OCR confidence is a heuristic and two reads
from one engine can agree on an error. The worker reruns the existing Decimal
package comparison on the candidate and the packing value. Conflicting counts,
unreadable files, malformed decisions, unavailable tools and exhausted budgets
return a staff-review reason. The worker rereads the B/L bytes against its
stored SHA-256 before PDF inspection. Original extraction, normalized packing
count, raw observed B/L line, method, confidence, page and bounding box remain
available in the run.

The loop allows at most six tool steps per run, a 110-second cooperative
budget per attempt, up to 20 seconds per model request and eight seconds per
Tesseract process. The PDF scope is three unrotated pages up to 1,000 points
per side. Native rendering happens inside the worker process. Unexpected worker
failures and model unavailability use the existing backoff and attempt limit.
The five-minute lease and stable attempt number fence result publication.
Checkpoints commit before and after each nonterminal tool, outside model or OCR
calls. A reclaimed run replays the last unfinished read. Superseded revisions
retain history. A new revision requires its own run.

## Files and schema

- `apps/api/src/shipping_ai/investigation/` holds the schemas, checkpoint
  service, restricted tool registry and PyMuPDF/Tesseract tools.
- `review/pipeline.py`, `ai/provider.py` and `automation/tasks.py` queue and
  execute investigations alongside the existing advisory. `automation/routes.py`
  adds the staff-only detail endpoint and a case filter to the run list.
- Alembic `0004` adds nullable JSONB `automation_runs.investigation` and
  permits the `investigation` run stage. It keeps existing runs and uses the
  existing unique event key per case and revision. No backfill or new tables.
  Readiness checks expect the new migration. Use the same migration and backend
  release together.
- `compose.dev.yml` and `.env.example` expose the opt-in setting.
- `workflow_demo/` and its archived prototype show progress and findings in
  Step 2. `test_investigation.py`, the fixture generator, the demo browser
  tests and CI exercise the new path. See the [demo instructions](../workflow_demo/README.md).

Staff review remains authoritative. A proposal never becomes a saved correction
by itself and is not an input to the existing internal approval transaction.
The agent has no business mutation, stock, customs or sending tools.

## Phases

1. **Implemented** — read-only package-count investigation with revision-scoped
   history, existing rule reuse, worker recovery, and a synthetic browser demo.
2. **Next** — add direct evidence-to-staff-correction workflow, source links,
   and evidence provenance for more fields. Add labelled fixtures for
   multilingual, rotated, and multi-page B/L layouts and multiple transport
   movements before exposing more tools.
3. **Subsequent** — design distinct staff roles and company scopes. Implement
   a separate, explicitly authorized quota reservation and reconciliation
   transaction with row-level concurrency tests if the agency adopts quota
   consumption. Model declaration and clearance as separate, evidence-backed
   lifecycle events.

## Verification on the isolated development stack

- Baseline API suite passed 31 tests before the change. The final suite passed
  51 using `python -m pytest apps/api/tests -q` with dedicated PostgreSQL and
  Redis, including real Tesseract rereads after a simulated 513 OCR result,
  malformed and unauthorized tool choices, exhausted time and steps, lease
  recovery, superseded revisions, and the staff approval gate.
- The legacy environment ran `python -m unittest discover -s tests -q`.
  All 34 passed. Streamlit's health endpoint on port 8501 returned `ok`.
- `ruff check apps/api`, `alembic check`, and the web lint, build and type
  checks passed.
- The three existing workspace, review and approval browser tests passed.
  Approval produced one internal import, permit draft and report in the
  isolated synthetic stack.
- The two demo browser tests passed with real Ollama 0.40.16 and the local
  Qwen3.5 4B Q4 model, connected via Docker's host bridge. The scan reported
  page 1, 531 PKG, and a focused OCR confidence of about 96. The conflicting
  fixture retained 513 PKG and required staff review. The simulator on the
  default Ollama port returned an invalid decision, which the worker recorded
  as a staff-review reason.
