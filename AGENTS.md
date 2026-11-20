# AGENTS.md — Harborway

## Mission

Evolve `dev-vichea/cdc_excel_matcher_v1` into an internal AI-assisted shipping documentation and import-record system. Prioritize a working end-to-end import intake, evidence-backed document analysis, staff review, approval, permit draft generation and reporting. **Never infer authority to send external messages or modify official records from an LLM response.**

## Canonical specifications

Start with [the current architecture map](docs/architecture/frontend-map.md) and the code it references. Use [the implementation specification](docs/01_IMPLEMENTATION_SPEC.md), [the roadmap](docs/02_IMPLEMENTATION_ROADMAP.md), and [the development guide](docs/development.md) for domain rules, milestone context, and local verification. Consult the legacy services and tests when a change touches their contracts.

## Architecture and ownership

- Preserve the Next.js App Router frontend in `apps/web` and the FastAPI backend in `apps/api`. Keep public routes and existing API contracts compatible. Make changes within the owning workflow.
- Keep `apps/web/src/app/` focused on route parameters, metadata, redirects, server data loading, and composition. Put domain UI, hooks, workflow rules, and feature-specific API adapters in `features/<feature>/`. The feature that owns the business behavior owns its UI and state, even when other pages render it.
- Dependencies flow from `app/` to features, shared UI, or `lib/`, and from features to shared UI or `lib/`. Shared UI may depend on `lib/`. Keep `lib/` independent of routes, features, and UI. Use explicit props or composition for collaboration between features. Where a direct feature import is useful, import the owning feature's intended entry point and keep the dependency one-way. Avoid cycles, route-file imports, and deep imports into another feature's private implementation.
- Before creating or extracting a component, search the repository for existing components, hooks, services, and utilities with the same responsibility. Read their callers, including indirect and dynamic references. Extend or compose an existing owner when its responsibilities and lifecycle fit. Avoid parallel implementations of the same responsibility.
- Use `components/ui/` for genuinely reusable, domain-neutral primitives and control patterns. Extract shared code when concrete callers already need the same behavior and a small stable interface can serve them without domain conditionals. Keep feature-specific reuse within the owning feature. Similar markup alone is insufficient justification.
- Use descriptive kebab-case filenames, PascalCase component exports, and `use-*.ts` for hooks. Keep files near their owning feature. Add a module, abstraction, or global store only when its current consumers and lifecycle justify it. Keep ephemeral state local and reuse existing shared infrastructure.
- Use `src/lib/server-api.ts` for authenticated server reads and `src/lib/client-api.ts` for browser JSON and multipart calls through the same-origin `/api/v1` rewrite. Use existing specialized preview and download paths where their response handling is required. Never introduce direct frontend database access or a second backend API layer.
- Keep authentication, authorization, workspace and company scoping, audit history, and persistence in the existing FastAPI flows. Preserve session and origin checks, document provenance, revision and expected-review IDs, conflict handling, atomic writes, and existing status codes and response shapes. Keep approval and other consequential operations behind their existing server-side gates.

## Hard requirements

- Respect existing Python parser/matcher/exporter contracts and regression tests; avoid deletion or rewrite of original modules without explicit permission.
- Keep Streamlit/SQLite operational until migration parity is verified.
- Work in narrow, tested changes. Extend Gmail, Telegram, or live sending only when the task explicitly calls for it.
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

1. Identify the affected routes, components, hooks, API endpoints, and persistence paths. Establish the baseline for the behavior being changed.
2. Make the smallest change that preserves existing workflows. Add or update focused regression and negative coverage for changed behavior.
3. Run `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web lint`, `pnpm --dir apps/web build`, and the relevant tests. Use synthetic data and an isolated stack for browser and API mutations. Investigate failures and report baseline failures or checks that could not run.
4. Update `docs/architecture/frontend-map.md` when pages, component ownership, features, API dependencies, or data flows change. Report affected routes and components, verification results, and remaining risks.

## Agent safety controls

Never auto-send mail or Telegram messages, modify actual CDC remaining balance, file a customs declaration, mark cargo customs-cleared or destroy original documents. Human approval must authorize exact scope and recipients. For production integrations, require company permission and authorized test channels. No hardcoded API tokens or private credentials.
