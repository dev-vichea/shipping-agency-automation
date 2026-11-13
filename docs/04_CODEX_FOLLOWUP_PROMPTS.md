# Codex Follow-up Prompts — Run One Phase at a Time

Use these after Codex finishes the earlier phase and you review its test report. All prompts assume Codex has read `AGENTS.md` and the implementation documents and continues on the existing feature branch. Never paste all phases as one request.

## Phase 2 — Document processing + validation + Ollama

```text
Continue the Shipping Agency AI Automation System. Read AGENTS.md and the implementation specification. Implement PHASE 2 ONLY. Preserve all Phase 0/1 and legacy behavior.

Integrate existing services/extraction.py, packing.py, bill_extractor.py, matching.py and verified translation memory into reusable FastAPI/Celery processing adapters. Implement typed INV/PL/Draft B/L extraction with immutable source evidence (page/sheet/cell or source snippet), normalized quantities/units/currency and explicit missing/uncertain states. Compare INV vs PL items; compare only overlapping B/L summary details; match CDC descriptions, units, quantities and unit prices/limits where master data actually has them. Never call a fuzzy match approved, never deduct stock, never invent ETD/ETA. Create discrepancy findings and review-ready intake statuses.

Integrate optional local Ollama using qwen3.5:4b-q4_K_M with a provider abstraction, structured Pydantic output, bounded context, one request at a time, timeouts, audit metadata and fail-closed behavior if unavailable. AI only explains and proposes; deterministic Python rules decide arithmetic/exact mismatches. Use sanitized fixtures and legacy tests. Demonstrate clean, mismatched, unknown CDC, bad PDF/OCR and AI-offline cases. No live Gmail/Telegram and no external sending. Report exact tests and STOP.
```

## Phase 3 — Human review, approval, permit draft & reporting

```text
Continue Shipping Agency AI Automation System. Implement PHASE 3 ONLY per AGENTS.md and docs. Build the actual Review Center with side-by-side source documents, field provenance, comparison results, CDC review, corrections and explicit Approve/Reject actions. Make approvals transactional, idempotent and scoped to the exact reviewed snapshot. After intake approval, create/update an accepted import record, approved item lines, audit timeline and report views; generate a review-only permit INV/PL workbook with the existing services/permit_exporter.py where mandatory verified fields pass. Missing ETD/ETA must not automatically block eligible permit preparation. Do NOT send any emails/Telegram/broker documents or deduct CDC stock. Include duplicate retry tests and full simulated arrival -> review -> approval -> import -> permit draft -> Excel report E2E test. Preserve Streamlit tests and STOP with commands/results.
```

## Phase 4 — Gmail integration, then Telegram, and notifications

```text
Continue Shipping Agency AI Automation System. Implement PHASE 4 ONLY using authorized test accounts/chats. First ship one live ingestion integration (recommend Gmail), verify it end-to-end, then implement Telegram bot ingestion. Gmail must handle OAuth least privilege, Pub/Sub watch with history synchronization and renewal, missed notification reconciliation and deduplication. Telegram must use an authorized bot webhook or polling with verified sender/chat and unique update handling; never claim visibility into arbitrary private chats. Normalize both channel events into the same intake pipeline as the simulator. Notify agency staff in-app; optional staff Telegram alerts. No automatic outbound communication. Add idempotency, retry, security and channel-disabled tests. Provide setup steps without requesting real secrets in chat. STOP for approval before enabling external sends.
```

## Phase 4B — Approved outgoing messages and permit transmission

```text
Implement approved outgoing communication ONLY. Add reviewed message/document snapshot, recipient/channel selection, separate explicit staff approval, transactional outbound action/outbox and idempotent send/retry states. Send through configured authorized Gmail/Telegram channel only after approval. Never infer a recipient or approval scope from AI. Save sent provider message IDs, attachments and failures. Test repeated approvals, worker retries, failed sending, wrong recipient, revoked credentials and inbound/outbound loops with mocks before live testing. Do not turn on broad auto-send policies. STOP.
```

## Phase 5 — Continuous updates, customs status and reports

```text
Implement PHASE 5 per the specs. New ETD/ETA, revised B/L, permit/customs and broker messages should match an existing intake/import where unambiguous, preserving old document versions and requiring staff review for consequential changes. Add independent shipping, permit, customs and delivery statuses with evidence-backed customs release. Complete monthly/yearly report filters/exports based on approved records, not unverified drafts. Add a separate post-clearance CDC reconciliation approval workflow; do not auto-deduct stock. Add reliable follow-up scheduler, backup/restore plan, monitoring, E2E updates-and-report tests. STOP with a release-readiness report.
```

## Bugfix / verification prompt

```text
Audit the current Shipping Agency AI phase against AGENTS.md, implementation spec and phase exit criteria. Re-run existing unittest, new backend test suite, frontend lint/build and E2E tests. Check duplicate inbound handling, source provenance, schema validation, permission checks, retries, Ollama outage and non-destructive file behavior. Fix actual regressions in the current phase only. Produce a concise test-and-risk report with specific file references. Do not start the next phase.
```
