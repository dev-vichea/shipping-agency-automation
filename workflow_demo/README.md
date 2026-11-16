# Shipping Agency AI Demo

This development-only, loopback demo uses the real FastAPI, PostgreSQL and
Celery services. It has seven steps, from simulated arrival through staff
approval and deliverables. The package-count presets use fictional documents.

## Start an investigation

From the repository root, start the development stack with investigation enabled,
generate the fixtures and start the demo:

```sh
./scripts/init-dev-env.sh
SHIPPING_INVESTIGATION_ENABLED=true docker compose -f compose.dev.yml up -d --build --wait
docker compose -f compose.dev.yml exec api python -m shipping_ai.core.cli create-staff demo-staff@example.com --default-workspace-admin
uv sync --project apps/api --python 3.12 --locked
uv run --project apps/api python apps/api/tests/fixtures/build_samples.py --agent-demo workflow_demo/.fixtures
python3 workflow_demo/server.py --port 8080
```

Sign in at [127.0.0.1:8080](http://127.0.0.1:8080) with the synthetic staff
email and password you chose. If you use another API port, set `BACKEND_URL`
when launching the demo. The demo accepts browser mutations from its own
loopback origins and forwards to the configured development API.

1. Pick **Scanned B/L · 531 PKG**, then **Archive Arrival & Start Intake**.
   Step 2 shows the original extracted value, the empty PDF text check, the
   page OCR, the focused OCR with page and bounding box, and deterministic
   comparison. The terminal result is **Evidence agrees. Staff review required.**
2. Start a new case using **Conflicting B/L · 513 PKG vs 531 PKG**. The
   text-layer count is 513 and the comparison is a mismatch. Step 3 continues
   to show the original extracted values and findings.
3. For full approval and permit verification, use the clean fixture and CDC
   workbook in the [development guide](../docs/development.md#phase-3-staff-approval-and-reporting).
   Choose the applicable CDC version and rows, confirm them, and enter staff
   notes after checking the evidence. Review and approval are separate actions.

The scanned preset is a real raster PDF. The API regression test injects
`513` as the initial OCR result while keeping the raster original at `531`.
The two investigation reads in that test run real Tesseract.

## Step 5 staff review

For a CDC permit draft, apply the applicable verified Master List in Step 4,
then check the suggested rows against it in Step 5. Confirm the checkbox after
checking the selected rows against the approval document. If you are only
reviewing the internal import, you can leave unverified mappings blank and see
the permit requirements separately.

Read the compared values and record a note for each wording or uncertain
transport finding you can verify. A genuine source conflict needs a reviewed
field correction in the staff workspace or a revised document. Click **Save
Staff Review** to see any remaining approval blockers. The approval action
is in Step 6.

## Run with Ollama

The deterministic policy works without Ollama. To exercise model decisions,
start your local Ollama model as described in the
[development guide](../docs/development.md#optional-ollama). Recreate the API
and worker with the same Compose settings and `SHIPPING_OLLAMA_ENABLED=true`.
If your real daemon uses a different port, also set
`SHIPPING_OLLAMA_URL=http://host.docker.internal:<port>`. The old
`ollama_bridge.py` is a rule-based simulator for the original advisory demo.
It now defaults to loopback port 11436.

Step 2 reads the staff-only endpoint
`GET /api/v1/automation/runs/{run_id}/investigation`. List the runs for one
case through `GET /api/v1/automation/runs?intake_case_id={case_id}`.

## Run the browser tests

With the demo and backend running, export `SHIPPING_E2E_EMAIL`,
`SHIPPING_E2E_PASSWORD` and `SHIPPING_DEMO_URL=http://127.0.0.1:8080`.
Run from the repository root:

```sh
pnpm --dir apps/web exec playwright test e2e/workflow-demo.spec.ts
```

Use a disposable stack for these tests. The two scenarios create synthetic
intakes and stop at the document review gate.
