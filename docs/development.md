# Development: Harborway shipping workspace

From the repository root, start the application using Docker Compose:

```sh
./scripts/init-dev-env.sh
docker compose -f compose.dev.yml up -d --build --wait
docker compose -f compose.dev.yml exec api python -m shipping_ai.core.cli create-staff staff@example.com --default-workspace-admin
```

Open [Harborway](http://localhost:3000/home) and sign in. The setup script creates
a Git-ignored `.env`. The staff command prompts for a 12–128 character password.
Use the administrator flag only for a trusted administrator of the default
workspace. Provision operators without that flag, then add their work email in
**Settings → Staff members** and assign their companies from the company detail
page. Administrators can create and switch workspaces with the same staff account.

Use the configured web origin for browser writes. The development stack also accepts
the other local address (`localhost` or `127.0.0.1`) on the same port. If changing the port,
update both `SHIPPING_WEB_PORT` and `SHIPPING_WEB_ORIGIN`. The development API
publishes on host loopback port 8001 by default. PostgreSQL and Redis stay on
the Compose network. The standalone Streamlit application uses its original
configuration on port 8501.

1. Create or select a client company. Use **Inbox → Upload documents** to submit
   up to five PDF, XLS, or XLSX files. The development limit is 10 MiB per file.
2. Watch the case update while the worker verifies the archive and runs
   extraction, deterministic checks, and any configured AI investigation.
   **Intake cases** contains the originals, worksheet and PDF previews,
   compared values, evidence, and activity. Upload a follow-up or explicit file
   revision from the same case when required.
3. Use **Import records → Drafts** or **Approvals** to review the current
   evidence-backed proposal. An incomplete proposal stays available for staff
   correction. Confirm the reviewed draft to commit an approved record.
4. Open the approved record to download any eligible permit INV/PL draft or go
   to **Reports** to export approved imports. **Automation runs** exposes
   processing history, trace IDs, and failed-job retries.

## Register a CDC Master List

Open **CDC Master Lists → Register workbook** and select the XLS or XLSX file.
The dialog reads the workbook header and shows suggested values with their
cell locations. You can also add an approval PDF for suggestions. Harborway
reads PDF text first and uses OCR for scanned pages. If enabled, local Ollama
can suggest missing fields from short header excerpts. The workbook remains
the source of the registered item rows.

Choose **Apply suggestions** to fill blank fields, review the values against
the approval, and confirm before registering. Previewing files leaves the
catalog untouched. The optional PDF is used during preview.

## Watch folders for document intake

Open **Integrations → Add source → Watched folder** as a workspace administrator.
Choose a company and a source name, then click **Choose folder**. Harborway
Folder Intake opens the native Mac picker. First-time users can download the
Mac app from the dialog and open it once to register the browser handoff.
Repeat setup for each source. The Mac app stays in the menu bar and checks
about every 20 seconds while running. Use **Open at Login** in its menu if it
should start when you sign in. Only the Mac app stores the local folder path.

Put each shipment in a direct subfolder with a stable name, such as
`ORIGINAL DOCS/INV-2026-047/`. The Mac app checks PDF, XLS and XLSX files in
those shipment folders. It ignores symbolic links, hidden entries, Office
temporary files and empty folders. Files must stay unchanged across consecutive
checks and be readable before upload. Google Drive streaming files may need
time to download. The Integrations list shows the last successful check and
whether the Mac app is waiting, offline, or needs attention.

Setup uses new arrivals only. Files for the same
shipment subfolder join one open intake case, where repeat bytes are
deduplicated and same-name replacements are linked as revisions. Files received
after approval or rejection start a follow-up case for staff review. The Mac app
never removes or edits source files. Gmail can run alongside watched folders,
and manual uploads remain available in the Inbox.

Use **Pause** or **Resume** on a source, or select **Choose folder** in its menu. A
completed setup replaces the previous connection for that source. Canceling
the picker leaves it in place. Setup links are single-use and expire after
five minutes.

For maintainers, build the app on macOS before building the web image.
`apps/folder-mac/build.sh` creates a universal app and packages the download
for the local Harborway URL. Pass the actual workspace origin as the first
argument for other deployments. Distribution to other Macs should use a
Developer ID signature and notarization. The installed local build uses an
ad-hoc signature.

## Workspace data and upgrades

Alembic migrations `0005`–`0009` preserve existing records, originals, staff
reviews and permit drafts. Existing staff retain their previous access as
administrators of the migrated **Shipping Agency** workspace. Review the roster
in Settings and assign narrower access where appropriate. Newly provisioned
staff require explicit workspace membership to see existing records.

The draft list uses the current case analysis revision as the proposal. An
approved import is committed only through the staff approval transaction.
Eligible mapped rows get internal CDC reservations under a workbook-version
lock. This leaves the archived workbook and its balance values intact.
Historical approvals are preserved as recorded. Internal reservations begin
with eligible approvals under this version of the application. Customs-cleared
quantities require a separate verified clearance workflow.

## Gmail and Telegram test setup

Use agency-authorized accounts, bot chats, and test data. Keep provider
credentials in the local environment or the deployment secret store.

- **Gmail.** Enable the Gmail API in the agency's Google Cloud project and
  configure a web OAuth client with redirect URI
  `<SHIPPING_WEB_ORIGIN>/api/v1/integrations/gmail/callback`. Set
  `SHIPPING_GMAIL_CLIENT_ID`, `SHIPPING_GMAIL_CLIENT_SECRET`, and
  `SHIPPING_CONNECTOR_KEY` in the API/worker environment. The encryption key is a
  stable Fernet key. Generate it privately with
  `python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`
  using the API's Python environment. After restarting, connect one mailbox in
  **Integrations**, enter allowed sender addresses, and enable monitoring.
  Celery polls Gmail history every minute starting from the connection, subject
  to Google's history retention. Intake considers inbox messages with supported
  attachments. A removed or expired cursor requires reconnecting. Resolve
  ambiguous companies from the case. For a company-assigned mailbox, a
  follow-up can join an open case when the mailbox thread, sender, subject,
  company, and invoice reference agree.
- **Telegram.** Set the agency bot's `SHIPPING_TELEGRAM_BOT_TOKEN` in the API
  environment. In **Integrations**, link consenting staff to their confirmed
  private chat IDs after they start the bot. On a completed draft, **Share draft**
  shows the exact message and eligible recipients. Confirm one recipient and
  the displayed message before sending. A delivery that Telegram cannot confirm
  stays recorded for the operator to check in the chat.
- **Approvals from a Telegram link.** Use a reachable HTTPS workspace origin for
  delivery to real staff. The link opens the exact draft and its workspace.
  A passing, eligible revision with a saved verified review opens the
  authenticated quick approval screen. The API checks workspace/company access,
  review ID, revision, and approval eligibility at submission. Other cases open
  the full review.
- **Local AI.** Set `SHIPPING_OLLAMA_ENABLED=true` and optionally
  `SHIPPING_INVESTIGATION_ENABLED=true` in the API/worker environment. Install
  the configured model on the Mac and verify Docker can reach
  `http://host.docker.internal:11434`. **Settings** shows the provider status.
  When Ollama is unavailable, deterministic findings and originals remain
  available for manual review.

### API and regression notes

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

## Phase 3 staff approval and reporting

1. Archive a simulated arrival with the synthetic supplier workbook and B/L PDF
   in `apps/api/tests/fixtures/`. Open the case and wait for its analysis.
2. In **Staff review**, inspect the source, enter reviewed corrections and
   reasons, and save. Quantity and other deterministic conflicts must be
   corrected. Wording and uncertain transport comparisons can be resolved with
   a staff note. **Request correction** records an internal request. **Reject
   intake** preserves the evidence and decision history.
3. For a CDC draft, register and apply the verified workbook. For the synthetic
   walkthrough use `cdc-approval.xlsx`, year 2026, reference `DEMO-2026`, and
   today's UTC balance date. Select and verify the appropriate candidate in
   Staff review. Real balance dates and workbook references must come from the
   approved evidence.
4. Save the review, enter the approval note, and click **Approve intake**. The
   transaction stores the reviewed snapshot hash, actor and scope, updates one
   import for the case, and attaches an unsubmitted INV/PL workbook when eligible.
   The import detail lists the exact workbook revision and checksum-backed
   download. A broker release authorization records the selected draft and
   recipient for later delivery.
5. In **Reports**, filter by Cambodia-local approval dates and download Excel.
   Totals include approved line amounts and are grouped by currency.

The Phase 3 migration adds audit and permit tables and preserves existing drafts
and originals. The one-workspace staff authorization model remains in use.
Each saved review is an immutable application record for an analysis revision.
A new arrival or reprocess requires a new review. The previous approved import
and draft remain available while that revision is reviewed. A replay of the
same approval returns its original result.

The existing CDC application exporter is the first template profile. It uses
USD, a single quantity unit per sheet, paired INV/PL lines, verified CDC item
mappings, and comparable current quantity limits. Where the workbook provides
prices or value limits, the comparable reviewed values must pass those checks.
ETD/ETA and final B/L are optional. The approval screen shows why a permit is
pending while allowing approval of a qualifying import. Permit workbook bytes
are stored with the approval transaction in PostgreSQL so a retry cannot create
a second file or leave the approved record pointing at a missing draft. Archived
originals continue to use the private document volume.

Upgrade and check schema parity with:

```sh
docker compose -f compose.dev.yml up -d --build --wait
docker compose -f compose.dev.yml exec -T api alembic check
```

## Package-count investigation

Set `SHIPPING_INVESTIGATION_ENABLED=true` to queue a read-only investigation
for eligible new analysis revisions. Run `alembic upgrade head` via Compose to
install migration `0004`. With Ollama disabled, the same tools follow a
deterministic policy. Backend OCR tests require Tesseract with English and
Simplified Chinese language data.

Use the [Shipping Agency AI Demo](../workflow_demo/README.md) for the
531-package scan and the genuine 513-versus-531 discrepancy. See the
[architecture audit](agent-investigation.md) for the runtime limits, worker
recovery and staff approval boundaries.
