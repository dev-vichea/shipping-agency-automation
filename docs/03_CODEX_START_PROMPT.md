# Copy into Codex — Start Shipping Agency AI Automation System

> **Where to run:** Open the cloned `dev-vichea/cdc_excel_matcher_v1` repository in Codex. Copy `AGENTS.md` to the root and other specification files into `docs/`. Use this prompt as the first development task.
>
> **This prompt deliberately implements only Phase 0 + Phase 1.** See `04_CODEX_FOLLOWUP_PROMPTS.md` for the next tasks. We want a tested foundation, not an impressive-looking but nonfunctional prototype.

---

Act as a **Principal Python/Next.js Engineer, AI Automation Architect and careful migration engineer**.

## Project

We are upgrading my real repository `https://github.com/dev-vichea/cdc_excel_matcher_v1` into an **internal Shipping Agency AI Automation System** for local staff in Cambodia.

Read these project documents **completely before implementing**:
- `AGENTS.md`
- `docs/01_IMPLEMENTATION_SPEC.md`
- `docs/02_IMPLEMENTATION_ROADMAP.md`
- Existing repository `README.md`, `services/`, `tests/`, `app.py`, `shipping_ui.py`, `ui_demo/`, Docker files.

### Actual business workflow (don't reinterpret)

1. Overseas/HQ colleagues and other authorized senders send supplier Invoice, Packing List, Draft B/L and later corrections through Gmail or Telegram.
2. Automation captures incoming files and source messages and **archives them as unverified intake evidence**.
3. Existing Python extraction and OCR parse INV, PL and B/L. Compare item descriptions, units, quantity, unit price/value where applicable, weight, shipping summary and CDC Master List candidates. AI (Ollama) later helps understand messy language and explain discrepancies, not approve compliance.
4. When automatic checks pass, notify staff **Ready for Approval**. When unclear/mismatched, show **Needs Review** with source evidence and allow manual correction.
5. **After staff approves the exact review snapshot**, create/update an accepted import record using Invoice Number as the primary visible reference, generate draft permit INV/PL, and update report data. Avoid duplicate records on retries.
6. Missing ETD/ETA is pending; permit INV/PL may proceed without it when required fields are present. Later B/L/ETA/ETD updates should resume the same case, preserving prior versions.
7. External replies or sending permit docs need separately scoped authorization. CDC stock deductions and customs clearance cannot be inferred or approved automatically.

Only local agency staff log in. We are **not** building a public logistics marketplace or external partner portal.

### Phase scope — implement **Phase 0 + Phase 1 only**

**Phase 0: Audit**
- Create a feature branch (unless one is already appropriately set up).
- Inspect current code and identify reusable modules and their existing tests.
- Run existing `python -m unittest discover -s tests -v`. Record baseline result honestly.
- Note that original `docker-compose.yml` currently runs Streamlit on port 8501, existing `services/shipping_store.py` uses SQLite, and `ui_demo/` is in-memory. Preserve them.
- Document architecture decisions, unresolved assumptions and safe migration strategy.

**Phase 1: Working foundation**
- Add FastAPI app with configuration, health endpoints, OpenAPI docs, SQLAlchemy 2, PostgreSQL and Alembic migrations.
- Add one Celery worker with Redis and a verifiable test task. Jobs must have persistent DB status and an idempotency design.
- Add Next.js TypeScript, Tailwind, shadcn/ui and an internal operations layout; build minimal functional Inbox, Import List, Import Detail and Automation Status pages. Review route can be a functional skeleton in this phase.
- Add minimal models for internal users/auth, intake case, source message, immutable document attachment, import record, items, activity and automation run (create only justified schema). Use generated IDs and invoice numbers for display.
- Build an authenticated dev-only simulated intake API/file-upload path, storing original documents privately. Saving intake must not create an accepted import automatically.
- Build protected CRUD/read API for import records with clear source attribution. Use safe filenames, checksums, size/MIME checks and private downloads.
- Build reusable document engine interfaces/wrappers without breaking `services/extraction.py`, `packing.py`, `bill_extractor.py`, `matching.py`, `permit_exporter.py`, `cutstock_updater.py` or original tests.
- Add an Ollama provider interface/config and basic optional health check, but **do not pretend the actual AI analysis pipeline exists yet**.
- Add `compose.dev.yml` (or comparable additive setup). Keep original Streamlit compose and SQLite working. Ollama should run natively on macOS and be accessed using a tested local/host bridge.
- Provide `.env.example`, clearly documented first-run instructions, safe dev fixtures, migration commands and tests.

### Engineering requirements

- Do **not** delete/rewrite original service implementations or overwrite supplier workbooks.
- Do **not** connect real Gmail, Telegram, customs, or production third-party services in this phase.
- Do **not** trigger any real outgoing emails/messages or stock balance deduction.
- Do **not** commit private agency data, tokens or existing locally excluded `reference/shipping_work/` files.
- All database changes through migrations; store UTC, display `Asia/Phnom_Penh`, use Decimal for money.
- Strict validation: no unknown OCR/AI values promoted into accepted records, no global assumption that invoice numbers are unique, no silent 1-to-1 shipment/invoice assumption.
- Keep all new modules modular, typed and testable. Use one worker initially; multiple logical tasks later.
- Keep UI practical and consistent with shadcn/ui, clean operational tables and meaningful empty/loading/error states.

### Required tests and definition of done

1. Existing unittest suite still passes, or existing failures are documented with evidence and not masked.
2. Backend API tests cover intake persistence, document storage, access denial, record creation, duplicate handling and health.
3. A Celery worker task can be enqueued and completed with a persistent run record.
4. Next.js lint/build pass and at least one browser/end-to-end flow works.
5. Demo: simulate receiving a sample INV/PL attachment -> create stored intake -> view it in UI -> do not create an accepted import until an explicit authorized action. Full AI analysis, approval automation and permit export are **later phases**.
6. Restart containers/services and verify that saved records/files survive.
7. Provide a concise architecture diagram and exact local setup instructions.

### Execution rules

- First, report the existing repo audit and your plan briefly; **then implement and run tests**, not just describe what you would do.
- Prefer straightforward monolithic backend structure with explicit task boundaries. Don't add Kubernetes, distributed microservices, an agent framework, vector DB, or LLM training.
- If local Docker or Ollama is unavailable, implement the rest, provide a clear diagnostic, and do not claim the missing system was tested.
- Make safe decisions autonomously where details are unimportant. Flag business-sensitive assumptions clearly.
- At completion, list files changed, migration steps, exact commands and actual test output, remaining limitations, and the next recommended phase.
- **STOP after Phase 0 + Phase 1**. Wait for me to approve Phase 2.

---

## Recommended first Codex response

Before changing code, Codex should explain: (1) reusable existing modules, (2) data and compatibility risks, (3) proposed folder structure, (4) chosen dependency versions, and (5) Phase 1 test plan. After that, it should execute the work rather than ask for another architecture plan.
