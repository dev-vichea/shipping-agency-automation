# AGENTS.md — Shipping Agency AI Automation System

## Mission

Evolve `dev-vichea/cdc_excel_matcher_v1` into an internal AI-assisted shipping documentation and import-record system. Prioritize a working end-to-end import intake, evidence-backed document analysis, staff review, approval, permit draft generation and reporting. **Never infer authority to send external messages or modify official records from an LLM response.**

## Canonical specifications

Read in this order:
1. `docs/01_IMPLEMENTATION_SPEC.md`
2. `docs/02_IMPLEMENTATION_ROADMAP.md`
3. Existing repository `README.md`, `services/`, `tests/`, `shipping_ui.py`, `ui_demo/`, `docker-compose.yml`.

If file locations differ after copying the pack, locate them and update documentation rather than ignoring it. Follow existing repo instructions where compatible; flag conflicts.

## Hard requirements

- Respect existing Python parser/matcher/exporter contracts and regression tests; avoid deletion or rewrite of original modules without explicit permission.
- Keep Streamlit/SQLite operational until migration parity is verified.
- Work in narrow, tested phases. Phase 0+1 first. **Stop and summarize after each phase**; do not implement Gmail/Telegram/live sending before asked.
- Use immutable private originals, checksums, document version history and evidence-backed extracted fields.
- Store uncertain extracted values only as proposals/intake data. Accepted business records require authorized staff approval.
- Use the invoice number as the visible import reference, but immutable generated IDs internally. Do not assume 1 invoice == 1 B/L or 1 container.
- Compare INV/PL item quantities, units, values, and descriptions with deterministic Python rules; compare overlapping B/L summary fields only.
- CDC matches are suggestions until verified; validate company, Master List version, unit, price (when present), relevant quantities/values and balances. Never auto-deduct CDC stock from drafts.
- Missing ETD/ETA does not automatically prevent a permit draft if required fields are satisfied.
- Ollama is optional and swappable. Its output is untrusted, schema-validated proposal data. Don't let it directly execute SQL writes, external sends or compliance approvals.
- On Ollama/model failure, preserve intake and produce visible pending/manual review tasks.
- Keep secrets, real agency documents and private messages out of Git and logs; never output secret values.
- Protect APIs, file downloads, webhooks and mutations; authorization is mandatory for consequential operations.
- Make Celery tasks idempotent with retries, trace IDs and observable errors. One worker process initially.
- Use `Decimal` for monetary amounts, timestamps UTC in data, Cambodia-local display.

## Development setup

Preferred: Next.js/TypeScript/shadcn UI; FastAPI/Pydantic; PostgreSQL/SQLAlchemy/Alembic; Celery/Redis; local Ollama Qwen3.5 4B Q4; existing Python document engine. Ollama runs on macOS host; test Docker connectivity via `host.docker.internal`, do not assume localhost inside container. Keep legacy Streamlit at 8501.

## Project workflow

1. Audit, preserve and baseline tests.
2. Propose minimal changes and design notes.
3. Implement the requested phase with real, runnable code.
4. Add regression tests + negative tests.
5. Run lint/build/tests and show evidence.
6. Report changed files, commands, output, risks and next stage; stop.

## Agent safety controls

Never auto-send mail or Telegram messages, modify actual CDC remaining balance, file a customs declaration, mark cargo customs-cleared or destroy original documents. Human approval must authorize exact scope and recipients. For production integrations, require company permission and authorized test channels. No hardcoded API tokens or private credentials.
