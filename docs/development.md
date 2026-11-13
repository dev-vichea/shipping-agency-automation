# Development: Shipping Agency Automation

Run from the repository root with Docker Desktop and Docker Compose v2:

```sh
./scripts/init-dev-env.sh
docker compose -f compose.dev.yml up -d --build --wait
docker compose -f compose.dev.yml exec api python -m shipping_ai.core.cli create-staff staff@example.com
```

The first command creates a Git-ignored `.env` with a random hex database password.
Run it once. The staff command prompts for a password (12–128 characters). Open
[the workspace](http://localhost:3000/inbox) and sign in. Use the exact configured
web origin (default `http://localhost:3000`) for browser writes. If changing the
web port, update both `SHIPPING_WEB_PORT` and `SHIPPING_WEB_ORIGIN` in `.env`.
The API listens on host loopback port 8001 because 8000 was occupied on the audit
machine. Postgres and Redis have no published ports in this stack.

1. In **Inbox**, open **Simulate an arrival**. Add a subject and a synthetic
   PDF, XLS, or XLSX. A reference number is optional. Each submitted message
   can contain up to five 10 MiB files.
2. Open the intake. Download the original or expand its name for SHA-256 and
   source IDs. A new attachment can explicitly revise one of the originals.
   The worker verifies the archive and analyzes supported documents. Use
   **Refresh** to see the latest findings and review state.
3. Enter a company and invoice number and save an import draft. It appears in
   **Imports** with its source intake and originals. ETD and ETA remain pending.
4. Open **Automation**, select **Run worker check**, then refresh. A completed
   health-check row shows **Succeeded**. Failed runs show a short error code
   and a **Retry** button.

The API serves `GET /health/live`, `GET /health/ready`, `/docs`, and
`/openapi.json` at [localhost:8001](http://localhost:8001/docs). Browser API
traffic uses the same origin under `/api/v1`. Scripts can post credentials to
`/api/v1/auth/login`, supply `Origin: http://localhost:3000` on writes, and retain
the returned cookie in a private cookie jar. The simulation endpoint accepts
multipart `files` plus optional message metadata. Supply a stable
`provider_message_id` for retry: an identical replay returns the existing IDs;
reusing the key with different data returns HTTP 409.

```sh
docker compose -f compose.dev.yml ps -a
docker compose -f compose.dev.yml logs -f api worker scheduler
docker compose -f compose.dev.yml restart
docker compose -f compose.dev.yml down
```

The migration container exits successfully on purpose. Compose keeps named
database, Redis and document volumes across restart and normal `down`. Deleting
volumes removes the corresponding data. Back up PostgreSQL and the document
volume together before relying on this setup for agency records.

## Optional Ollama

Install [Ollama](https://ollama.com/) on the Mac. For a shell-managed local service
without cloud inference, use:

```sh
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 OLLAMA_NUM_PARALLEL=1 OLLAMA_CONTEXT_LENGTH=4096 ollama serve
# In another shell:
ollama pull qwen3.5:4b-q4_K_M
curl -fsS http://127.0.0.1:11434/api/tags
docker compose -f compose.dev.yml exec -T api python -c "import urllib.request; print(urllib.request.urlopen('http://host.docker.internal:11434/api/tags', timeout=3).read().decode())"
```

Docker Desktop on this Mac could reach a loopback-only Ollama listener at
`host.docker.internal:11434`. Verify on your machine before changing bind settings.
For a host-run API, use `SHIPPING_OLLAMA_URL=http://127.0.0.1:11434`. Keep the
listener private. Set `SHIPPING_OLLAMA_ENABLED=true` in `.env` and recreate the API and worker
(`docker compose -f compose.dev.yml up -d api worker`). Automation then shows whether the
configured model is installed. With the provider enabled, the worker requests
structured advice after saving its deterministic findings.

## Tests

Legacy regression tests use the original local fixtures. Run from the source
checkout, or copy the fixtures into ignored paths for the foundation checkout:

```sh
./scripts/provision-legacy-fixtures.sh /path/to/cdc_excel_matcher_v1
python -m unittest discover -s tests -v
```

Use an interpreter with the existing legacy dependencies installed. The fixture
script copies optional local defaults as well as files used by the suite. It
does not copy the original shipment database or uploads. The legacy
`docker-compose.yml` still runs Streamlit on 8501; run it from the original
checkout for access to existing shipment records.

For the API suite, use a disposable PostgreSQL instance whose test role can
create databases and a disposable Redis instance. The tests create and remove
an isolated database; they do not use the Compose development database.

```sh
uv sync --project apps/api --python 3.12 --locked
docker run --rm -d --name shipping-test-db -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_DB=shipping -p 127.0.0.1:55436:5432 postgres:17-alpine
docker run --rm -d --name shipping-test-redis -p 127.0.0.1:56379:6379 redis:7.4-alpine
TEST_DATABASE_URL=postgresql+psycopg://postgres@127.0.0.1:55436/shipping \
TEST_REDIS_URL=redis://127.0.0.1:56379/0 uv run --project apps/api pytest apps/api/tests -q
uv run --project apps/api ruff check apps/api
docker compose -f compose.dev.yml exec -T api alembic check
docker stop shipping-test-db shipping-test-redis
```

For the browser suite, create a dedicated synthetic staff account in the
development stack and set `SHIPPING_E2E_EMAIL` and `SHIPPING_E2E_PASSWORD`
in your shell. The test creates synthetic arrivals and drafts in that stack.
Node 24 LTS and Corepack are used in Docker and CI.

```sh
cd apps/web
corepack pnpm install --frozen-lockfile
corepack pnpm lint
corepack pnpm build
corepack pnpm typecheck
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
```

Use `SHIPPING_E2E_URL` if testing on a different web origin. CI runs the
new backend and browser checks with synthetic data and no live integrations.

## Local trust boundary

All active staff have access to this one internal workspace. Phase 1 does not
have company-level authorization, approval scopes, malware scanning, backups,
retention automation, or a production TLS deployment. Upload validation checks
the type and archive format and never executes content. Staff should use trusted
fixtures in development. Use the protected download route for originals;
nothing is mounted as a public document directory. Intake and receipt jobs
never create accepted records or alter the legacy SQLite database.

## Phase 2 document review

Archive a supplier workbook and, if available, a draft B/L PDF from the Inbox.
Open the intake in **Review** and refresh after the worker finishes. A combined
workbook can produce separate Invoice and Packing List extractions. Expand a
source excerpt on the left or a field or row on the right. Findings show the
compared values and link to the source sheet, cell, PDF page, or OCR line. The
download links retrieve the archived original.

To compare CDC limits, register the approved workbook under **Analysis
controls** after checking its company, approval reference and year. Apply that
exact version to the intake. A new analysis is queued and the previous results
stay visible until the new revision is ready. Candidate similarity never
confirms eligibility. Missing or undated balances, and balances older than 30
days, appear as unknown. An uncached formula is never recalculated.

The Phase 2 migration queues analysis for existing intakes and keeps their
documents, source messages, receipt runs, and drafts. Run the same Compose
command to upgrade. The worker runs the deterministic analysis first. With
`SHIPPING_OLLAMA_ENABLED=true`, it then queues a separate advisory job using a
locally installed model. Refresh the Review Center to see the advice. A failed
advisory remains retryable in Automation while the findings stay available.

The worker supports the existing supplier XLS/XLSX layouts and English or
Simplified Chinese B/L OCR. Excel sources are displayed as text excerpts with
cell evidence. PDF sources show page and line excerpts where available, and OCR
text is marked uncertain. Unsupported layouts, grouped or split lines,
unconfirmed units and currencies, and ambiguous document versions remain for
staff review. Missing ETD/ETA is displayed without adding a blocking finding.

Generated fictional supplier, B/L, and CDC test files are under
`apps/api/tests/fixtures/`. The spreadsheet layouts reproduce the relevant
legacy headers and merged cells. Use these files to run the Review Center
example without agency records.
