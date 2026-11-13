# Shipping Agency AI Automation System — Environment & Implementation Roadmap

**Version:** 1.0 | **Target:** Apple Silicon Mac, 16 GB RAM | **Build strategy:** Incremental retrofit, not a rewrite

## A. Development principles

1. Reuse the current Python document-processing engine and regression tests.
2. Work on a **new Git branch**; preserve Streamlit/SQLite until data parity is proven.
3. Build a **vertical slice** from simulated inbound files to one approved import record before integrating live mail/bots.
4. Treat LLM output as an optional suggestion with JSON validation, not source of truth.
5. One Celery worker process initially; tasks modular and persisted in PostgreSQL.
6. All external sends, CDC approvals, and final release/stock actions must be scoped to staff authorization.
7. Ask for real credentials or enterprise deployment changes only when a later phase actually needs them.

## B. Local environment prerequisites

Suggested local versions: Apple Silicon macOS, Docker Desktop / Colima compatible Docker Compose, Python 3.11+, Node.js current active LTS, pnpm via Corepack, Git, and latest compatible Ollama. Codex must inspect actual versions, choose a compatible pinned set, and record commands used; do not blindly upgrade existing dependencies.

Check:

```bash
uname -m                     # arm64 expected on Apple Silicon
sw_vers
python3 --version
git --version
docker --version
docker compose version
node --version
corepack --version
ollama --version
```

Ollama directly on Mac:

```bash
ollama pull qwen3.5:4b-q4_K_M
ollama list
curl -fsS http://127.0.0.1:11434/api/tags
```

Model configuration: `num_ctx=4096`, one request at a time, bounded input. Avoid model downloads within Docker. If the 4B model is too slow, offer a smaller quantized model and report benchmark results; don't silently switch a production model.

### Docker/Ollama connectivity warning

`http://127.0.0.1:11434` works **from macOS applications**, but **not** necessarily from a container. Docker Desktop's `host.docker.internal` refers to the Mac host. Test:

```bash
docker run --rm curlimages/curl:latest \
  -fsS http://host.docker.internal:11434/api/tags
```

If it cannot connect, check the Ollama host bind and firewall settings. Bind only to a trusted local interface as needed; do not expose port 11434 publicly. Document the exact secure setup Codex verified. The first milestone can run FastAPI on macOS while DB/Redis use Docker if the container-to-host path is blocked.

### Resource budget for a 16 GB Mac

- Limit Ollama to one concurrent inference and 4K context initially.
- Limit Celery concurrency to 1 during local testing and consider `--pool=solo` if needed.
- Allocate conservative Docker Desktop RAM/CPU; do not run a large OCR batch and Ollama simultaneously.
- Use deterministic extraction before invoking AI; reduce context to compact normalized text, not dozens of pages.
- Existing PDFs/Excel may be confidential; use sanitized fixtures and keep production samples out of Git.

## C. Local services and proposed ports

| Service | Runtime | Suggested address | Notes |
| --- | --- | --- | --- |
| Next.js web | Docker or host dev | http://localhost:3000 | UI |
| FastAPI | Docker or host dev | http://localhost:8000 | API |
| PostgreSQL | Docker | internal `postgres:5432` | Bind to host only for local debugging |
| Redis | Docker | internal `redis:6379` | Do not expose publicly |
| Celery worker | Docker | internal background service | One process initially |
| Ollama | macOS host | http://127.0.0.1:11434 | Docker uses tested host bridge |
| Legacy Streamlit | Existing service | http://localhost:8501 | Keep running unchanged |

Start with a separate dev Compose configuration or carefully extend original Compose without breaking Streamlit. All secrets live in `.env` or an approved secret store and `.env` must be Git-ignored.

## D. Required repository layout (target, adapt to existing files)

```text
cdc_excel_matcher_v1/
├── app.py                         # existing Streamlit remains
├── services/                      # existing Python services remain
├── tests/                         # existing unittest tests remain
├── apps/
│   ├── api/
│   │   ├── src/shipping_ai/
│   │   │   ├── main.py
│   │   │   ├── core/              # config, db, auth, storage
│   │   │   ├── imports/           # records, items
│   │   │   ├── intakes/           # incoming cases and state machine
│   │   │   ├── documents/         # adapters and provenance
│   │   │   ├── cdc/               # matching and reviewed mappings
│   │   │   ├── approvals/
│   │   │   ├── permits/
│   │   │   ├── automation/        # tasks, orchestration, retries
│   │   │   ├── ai/                # Ollama provider + schemas
│   │   │   ├── integrations/      # Gmail, Telegram later
│   │   │   └── reports/
│   │   ├── alembic/
│   │   ├── tests/
│   │   └── pyproject.toml
│   └── web/                       # Next.js App Router, TS, shadcn
├── docs/                          # these docs
├── compose.dev.yml                # new development services
├── .env.example
└── AGENTS.md
```

Use modern, maintained tooling, but do not mandate the exact internal import paths if they conflict with repository realities. Avoid circular Python imports; use clear service interfaces.

## E. Milestone list and stop gates

### Phase 0 — Audit and baseline (do first)

**Tasks**
- Create `feat/shipping-ai-foundation` or similar branch.
- Record existing tree, services, dependencies, current SQLite records, Streamlit behavior, test status, Docker behavior and risks.
- Run `python -m unittest discover -s tests -v` and report the test results.
- Identify and quarantine confidential data. No secrets/sensitive samples in commit.
- Produce `docs/architecture-decisions.md` recording major design decisions and unresolved business assumptions.

**Exit gate:** legacy behavior understood, baseline status recorded, no file loss or overwrites.

### Phase 1 — Runtime + persistent digital import foundation

**Tasks**
- Initialize FastAPI API + OpenAPI, typed config, SQLAlchemy + Alembic, PostgreSQL connection.
- Initialize Next.js TS + Tailwind + shadcn/ui app with basic internal layout.
- Add Redis + Celery and one health-check background job.
- Implement minimal `users`/internal auth, `intake_cases`, `incoming_messages`, `documents`, `import_records`, `import_items`, `activity_events`, `automation_runs`; additional tables only when justified.
- Implement secure file storage adapter and immutable attachment metadata.
- Add local manual/simulated intake endpoint; create, list and detail imports; preserve original file provenance.
- Add basic pages: Inbox, Review placeholder, Imports list and detail, Automation runs.
- Keep Ollama optional: health check/provider interface only, no claim AI extraction exists yet.
- Add DB migrations, backend tests, a simple web build and E2E test.

**Exit gate:** user can submit a simulated intake and persist/retrieve it after restart; file downloads authenticated; legacy tests still pass; Celery job executes; no accepted import created without approval.

### Phase 2 — Document extraction + deterministic validation + local AI interpretation

**Tasks**
- Wrap `services/extraction.py`, `services/packing.py`, `services/bill_extractor.py`, `services/matching.py` as adapters while preserving interfaces.
- Extract structured INV, PL and Draft B/L with source evidence, units, decimal amounts and missing statuses.
- Compare INV and PL descriptions/units/qty/prices/weights; compare overlapping B/L summary fields, not nonexistent line items.
- Add CDC version lookup, candidate matching and verified mapping approach. Unit-price check only if master data contains relevant price.
- Implement review findings and reasons; no automatic eligibility approval or stock deduction.
- Connect local Ollama `qwen3.5:4b-q4_K_M`, structured Pydantic schema, timeouts, sanitized logs, bounded input.
- Create tests for bad OCR, missing reference, mismatch, invalid CDC version, Ollama not available.

**Exit gate:** sanitized real-layout documents produce evidence-backed extraction and explicit findings; fail-closed AI outage behavior; no wrong accepted writes.

### Phase 3 — Review center + approval + permit generation + report update

**Tasks**
- Build split document / extracted-field UI with original evidence, field corrections and CDC candidate selection.
- Add explicit `needs_review` and `ready_for_approval` statuses.
- Implement transactional approve/reject with immutable reviewed snapshot + scope + audit actor.
- On intake approval: create/update one import record; generate **unsubmitted** permit INV/PL draft with existing exporter if requirements pass; populate report queries.
- Make missing ETD/ETA optional unless required by selected permit template.
- Add separate action for sending or releasing broker documents—never infer it from general intake approval.
- Generate Excel reports without overwriting originals.
- Add E2E approval and negative tests.

**Exit gate:** full simulated arrival -> extract -> review -> approve -> one import -> permit draft -> report works; double click/retry is idempotent.

### Phase 4 — Live Gmail + Telegram + notifications

**Tasks**
- Implement a **single channel at a time** in a test environment and obtain agency authorization before connecting any real account.
- Gmail: OAuth least-privilege, `watch`/Pub/Sub, `history.list`, cursor synchronization, watch renewal (at least every 7 days), periodic reconciliation, message/attachment fetch, idempotency and sent-message loop avoidance.
- Telegram: bot in authorized chat/group, `getUpdates` or webhook, authorization, update idempotency and file retrieval.
- Route both through common intake pipeline. In-app notification first; optional staff Telegram alert second.
- Implement approved outgoing reply/document send using an outbox, unique action key and delivery status.

**Exit gate:** authorized test message is ingested exactly once (even with replay) and generates the same reviewed intake; no unexpected external outgoing messages.

### Phase 5 — Continuous updates, broker workflow, reporting hardening

**Tasks**
- Correlate revisions or later ETD/ETA from sender to existing import or request staff linking.
- Preserve revised B/L as a new document version and retain previous reviewed values.
- Extend customs status and evidence: broker processing, declaration, actual customs release, delivery, without assuming government API automation.
- Create reporting snapshots/filters: imports by month, supplier, docs status, weights, values, clearance status. Distinguish estimated and actual data.
- Add post-clearance CDC reconciliation workflow under staff approval; no speculative balance deduction.
- Backups, restore, observability, security review, production deployment plan.

**Exit gate:** delayed update does not create duplicate import; newly confirmed facts update correct record after review; reports trace to approved sources; end-to-end operational recovery test passes.

## F. Cross-phase test matrix

| ID | Scenario | Required result |
| --- | --- | --- |
| T01 | Message with INV/PL/B/L | Intake archived, analysis queued |
| T02 | Bad B/L OCR | Needs review, originals preserved |
| T03 | Same message delivered twice | No duplicate intake business effects |
| T04 | INV vs PL quantity conflict | Block approval until corrected/resolved |
| T05 | B/L lacks item prices | Not flagged as mandatory B/L mismatch |
| T06 | CDC desc similar but unit differs | Candidate only, staff review required |
| T07 | CDC balance unavailable | `unknown`, never auto-pass |
| T08 | ETD/ETA missing | Status pending; eligible permit draft may proceed |
| T09 | Ollama offline | Deterministic processing continues; review task exists |
| T10 | Staff approves once, retries occur | Exactly one accepted import + generated draft |
| T11 | Revised B/L arrives tomorrow | New document version, old evidence retained |
| T12 | Unauthorized access | Denied |
| T13 | Report export | Only approved data included in final totals |
| T14 | Legacy service tests | No regressions |

## G. Suggested command/tests for Codex to validate

Codex must adapt commands to actual package setup, but should aim for:

```bash
python -m unittest discover -s tests -v
# New backend (after scaffolding)
python -m pytest apps/api/tests -q
# Migrations (after scaffolding)
# alembic upgrade head
# Frontend (after scaffolding)
# pnpm --dir apps/web lint
# pnpm --dir apps/web build
# E2E browser tests (after scaffolding)
# pnpm --dir apps/web test:e2e
# Compose lifecycle (after scaffolding)
# docker compose -f compose.dev.yml up -d --build
# docker compose -f compose.dev.yml ps
```

### What Codex must report after *every* phase

1. Implemented files and architectural decisions.
2. Exact commands run and tests passed/failed; do not invent results.
3. Data migration and backwards-compatibility impact.
4. Any unresolved safety/security or parsing risks.
5. Demonstration path (URL, API endpoints or CLI command) with expected output.
6. Next phase suggestion; **stop rather than beginning another phase automatically**.

## H. Evidence/review UX specification

Review screen should show:

- Left: source file preview/download, sheet/page and source message, immutable original.
- Right: extracted field, original text and normalized value, document source, alternative/candidate and confidence hint.
- Comparison matrix: invoice vs packing list vs B/L where comparable; CDC desc/unit/unit price/approved qty/value/balance under the selected verified version.
- Explicit statuses: `passed`, `missing`, `conflict`, `unsupported_layout`, `needs_review`, `reviewed`.
- Footer actions: `Save Review`, `Request Correction`, `Reject Intake`, `Approve Intake`. Explain exactly what approval will create and generate.
- Audit: actor, time, before/after values, scope.

## I. Operational constraints

- New inbound data can always be retained as **unverified evidence**; accepted records require verified values and staff approval.
- No LLM instruction embedded in incoming email/document can command the system to send, approve, deduct stock, delete evidence or access another case.
- No personal laptop assumed available 24/7. Production background processing needs always-on deployment and explicit operations plan.
- Do not require production Gmail/Telegram credentials to test Phases 0–3.
- Use fixture documents in tests. If an example file belongs to an agency, never commit it without permission and sanitization.
