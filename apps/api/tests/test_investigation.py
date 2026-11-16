from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from fixtures.build_samples import XLSX, draft_bill, supplier
from sqlalchemy import select

from shipping_ai.ai.provider import OllamaProvider
from shipping_ai.core.config import Settings, settings
from shipping_ai.documents.storage import LocalStorage
from shipping_ai.investigation.loop import COMPARE, INSPECT, SCAN, TEXT, Sources, run_loop
from shipping_ai.investigation.schemas import Investigation, Source, ToolSelection
from shipping_ai.review.values import field

API = "/api/v1"
FIXTURE_DIR = Path(__file__).parent


def test_health_ready_accepts_investigation_migration(api):
    assert api.get("/health/ready").json() == {"status": "ready"}


def run_fixture(*, planner=None, limit=6):
    source = Source(
        document_id=uuid4(),
        sha256="0" * 64,
        parent_version_id=None,
        method="fixture",
        extracted=field("531", unit="PKG"),
    )
    # The plan tests stop before a PDF tool can open this document.
    sources = Sources(source, source, object(), LocalStorage(FIXTURE_DIR))
    return run_loop(
        Investigation(model=None), sources, 1, lambda _: True, planner, step_limit=limit
    )


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (["malformed"], "invalid_model_output"),
        ({"tool": "extract_pdf_text", "document_id": str(uuid4())}, "invalid_model_output"),
        ({"tool": "approve_import"}, "unauthorized_tool"),
        ({"tool": SCAN.tool}, "unauthorized_tool"),
        ({"tool": COMPARE.tool}, "unauthorized_tool"),
        ({"tool": TEXT.tool, "profile": "focused"}, "invalid_model_output"),
    ],
)
def test_malformed_or_out_of_scope_tool_never_executes(response, reason):
    run = run_fixture(planner=lambda *_: response)
    assert run.reason == reason
    assert run.requires_staff_review
    assert [step.decision for step in run.steps] == [INSPECT]


def test_iteration_limit_records_partial_progress():
    run = run_fixture(limit=1)
    assert run.reason == "iteration_limit"
    assert len(run.steps) == 1
    assert run.steps[0].finished_at


def test_malformed_ollama_envelope_becomes_staff_review(monkeypatch):
    config = Settings(
        database_url="postgresql+psycopg://localhost/shipping",
        redis_url="redis://localhost/0",
        web_origin="http://localhost:3000",
        environment="test",
        ollama_enabled=True,
    )
    monkeypatch.setattr(httpx, "get", lambda url, **kw: httpx.Response(
        200, request=httpx.Request("GET", url),
        json={"models": [{"name": config.ollama_model, "digest": "a" * 64}]},
    ))
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kw: httpx.Response(
            200,
            json={
                "done": True,
                "done_reason": "stop",
                "model": config.ollama_model,
                "response": "{incomplete",
            },
        ),
    )
    provider = OllamaProvider(config)
    run = run_fixture(
        planner=lambda context, deadline: provider.choose_tool(context, deadline, ToolSelection)
    )
    assert run.reason == "invalid_model_output"
    assert len(run.steps) == 1


def archive(staff, monkeypatch, *, bill=None, pack=True, with_model=False, expected=True):
    from test_phase_two import finish_queue

    from shipping_ai.automation.tasks import drain
    from shipping_ai.core.db import session_factory
    from shipping_ai.models import AutomationRun

    finish_queue()
    monkeypatch.setattr(settings(), "investigation_enabled", True)
    monkeypatch.setattr(settings(), "max_file_bytes", 96 * 1024)
    monkeypatch.setattr(settings(), "ollama_enabled", with_model)
    files = []
    if pack:
        files.append(("files", ("supplier.xlsx", supplier(packages=531), XLSX)))
    if bill is not None:
        files.append(("files", ("draft.pdf", bill, "application/pdf")))
    response = staff.post(
        f"{API}/intakes/simulate",
        files=files,
        data={"provider_message_id": uuid4().hex},
    )
    assert response.status_code == 201, response.text
    case_id = UUID(response.json()["case_id"])
    for _ in range(2):
        drain.run()
    with session_factory()() as db:
        run_id = db.scalar(
            select(AutomationRun.id).filter_by(
                intake_case_id=case_id,
                stage="investigation",
            )
        )
    assert (run_id is not None) == expected
    return f"{API}/intakes/{case_id}", f"{API}/automation/runs/{run_id}/investigation"


def test_rechecks_bad_initial_ocr_with_two_real_ocr_passes(staff, monkeypatch):
    from test_phase_two import finish_queue

    from shipping_ai.ai.provider import Advisory, Suggestion
    from shipping_ai.automation.tasks import drain
    from shipping_ai.documents import extract as adapter

    original_extract = adapter.extract_positioned_pdf

    # Inject a recognition error in the initial extraction only.
    def initial_ocr(*args, **kwargs):
        result = original_extract(*args, **kwargs)
        packages = result.fields["packages"]
        assert packages.value == "531"
        packages.value = "513"
        return result

    calls = []

    def choose(_self, context, _deadline, _decision_type):
        calls.append(context)
        return {"tool": context["available"][0]["tool"]}

    monkeypatch.setattr(adapter, "extract_positioned_pdf", initial_ocr)
    monkeypatch.setattr(OllamaProvider, "choose_tool", choose)
    monkeypatch.setattr(
        OllamaProvider,
        "advise",
        lambda *_: Advisory(
            suggestions=[
                Suggestion(
                    finding_key="transport.packages.packing_list",
                    relationship="not_applicable",
                    explanation="Compare the source.",
                    suggested_action="compare_source",
                )
            ]
        ),
    )
    pdf = draft_bill(packages=531, scanned=True)
    case, url = archive(staff, monkeypatch, bill=pdf, with_model=True)
    assert staff.get(url).json()["investigation"]["status"] == "pending"
    original = staff.get(f"{case}/analysis").json()
    finish_queue()
    run = staff.get(url).json()
    log = run["investigation"]
    assert log["status"] == "verified_proposal", log
    assert log["reason"] == "source_counts_agree" and log["requires_staff_review"]
    assert [step["decision"]["tool"] for step in log["steps"]] == [
        "inspect_source_evidence",
        "extract_pdf_text",
        "ocr_pdf_region",
        "ocr_pdf_region",
        "compare_document_fields",
    ]
    source = log["steps"][0]["result"]["bill"]
    assert source["extracted"]["value"] == "513"
    assert source["sha256"] == sha256(pdf).hexdigest()
    assert log["proposal"]["value"] == "531"
    assert log["proposal"]["page"] == 1
    assert log["proposal"]["confidence"] >= 80
    assert len(log["proposal"]["bbox"]) == 4
    assert log["steps"][-1]["result"]["outcome"] == "PASS"
    assert len(calls) == 4
    assert "531" not in str(calls) and "513" not in str(calls)
    assert staff.get(f"{API}/documents/{source['document_id']}/download").content == pdf
    after = staff.get(f"{case}/analysis").json()
    assert after["findings"] == original["findings"]
    assert after["extractions"] == original["extractions"]
    assert staff.get(case).json()["state"] == "needs_review"
    assert (
        staff.post(
            f"{case}/approve",
            json={
                "expected_revision": run["input_revision"],
                "review_id": None,
                "notes": "Agent reported supporting evidence.",
            },
        ).status_code
        == 409
    )
    assert TestClient(staff.app).get(url).status_code == 401
    assert staff.get(case).json()["import_id"] is None
    drain.run()
    assert staff.get(url).json() == run


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        ("different", "source_counts_differ"),
        ("unreadable", "unreadable_pdf"),
        ("missing", "archive_unavailable"),
        ("tampered", "archive_checksum_mismatch"),
        ("missing_role", None),
    ],
)
def test_unresolved_investigation_preserves_intake_for_staff(staff, monkeypatch, kind, expected):
    from test_phase_two import finish_queue

    from shipping_ai.core.db import session_factory
    from shipping_ai.models import Document

    pdf = b"%PDF-1.4\ninvalid PDF" if kind == "unreadable" else draft_bill(packages=513)
    case, url = archive(
        staff,
        monkeypatch,
        bill=pdf if kind != "missing_role" else None,
        expected=expected is not None,
    )
    if kind in {"missing", "tampered"}:
        with session_factory()() as db:
            doc = db.scalar(
                select(Document).filter_by(
                    intake_case_id=UUID(case.rsplit("/", 1)[1]),
                    mime="application/pdf",
                )
            )
            path = LocalStorage(settings().storage_dir).path(doc.storage_key)
            original = path.read_bytes()
            if kind == "missing":
                path.unlink()
            else:
                path.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
        try:
            finish_queue()
        finally:
            path.write_bytes(original)
    else:
        finish_queue()
    if expected:
        log = staff.get(url).json()["investigation"]
        assert log["status"] == "needs_review" and log["reason"] == expected
        assert log["requires_staff_review"]
        if kind == "different":
            assert log["proposal"]["value"] == "513"
            assert log["steps"][-1]["result"]["outcome"] == "MISMATCH"
    else:
        assert any(
            item["key"] == "extraction.draft_bl"
            for item in staff.get(f"{case}/analysis").json()["findings"]
        )
    assert staff.get(case).json()["import_id"] is None


def test_expired_worker_resumes_selected_tool_without_duplicate_steps(staff, monkeypatch):
    from shipping_ai.automation.tasks import claim, finish, investigate
    from shipping_ai.core.db import session_factory
    from shipping_ai.investigation import loop
    from shipping_ai.models import AutomationRun

    case, url = archive(staff, monkeypatch, bill=draft_bill(packages=513))
    job = claim()
    assert job.stage == "investigation"
    key = TEXT.tool, TEXT.profile

    def killed(*_):
        raise KeyboardInterrupt

    with monkeypatch.context() as patch:
        patch.setitem(loop.REGISTRY, key, killed)
        with pytest.raises(KeyboardInterrupt):
            investigate(job)
    partial = staff.get(url).json()["investigation"]["steps"]
    assert len(partial) == 2 and partial[0]["finished_at"] and not partial[1]["finished_at"]
    with session_factory().begin() as db:
        db.get(AutomationRun, job.id).lease_until = datetime.now(UTC) - timedelta(seconds=1)
    retry = claim()
    assert retry.id == job.id and retry.attempt == job.attempt + 1
    outcome = investigate(retry)
    finish(job, None, outcome)
    assert staff.get(url).json()["state"] == "running"
    finish(retry, None, outcome)
    finish(retry, None, outcome)
    run = staff.get(url).json()
    assert run["state"] == "succeeded" and run["retry_count"] == 1
    steps = run["investigation"]["steps"]
    assert [step["number"] for step in steps] == [1, 2, 3]
    assert steps[0] == partial[0]
    assert steps[1]["selected_attempt"] == job.attempt
    assert steps[1]["completed_attempt"] == retry.attempt
    assert staff.get(case).json()["import_id"] is None


def test_pending_investigation_is_superseded_by_a_new_revision(staff, monkeypatch):
    from test_phase_two import finish_queue

    case, url = archive(staff, monkeypatch, bill=draft_bill(packages=513))
    old = staff.get(url).json()
    response = staff.post(f"{case}/process", json={"expected_revision": old["input_revision"]})
    assert response.status_code == 202
    finish_queue()
    previous = staff.get(url).json()["investigation"]
    assert previous["status"] == "superseded" and previous["steps"] == []
    runs = staff.get(
        f"{API}/automation/runs", params={"intake_case_id": case.rsplit("/", 1)[1]}
    ).json()
    current = [
        run
        for run in runs
        if run["stage"] == "investigation" and run["input_revision"] == response.json()["revision"]
    ]
    assert len(current) == 1
    assert (
        staff.get(f"{API}/automation/runs/{current[0]['id']}/investigation").json()[
            "investigation"
        ]["reason"]
        == "source_counts_differ"
    )


def test_master_version_requires_explicit_selection(staff):
    from fixtures.build_samples import COMPANY
    from test_phase_three import analysis, apply_master, archive

    first_case = archive(staff)
    selected, _ = apply_master(staff, first_case, analysis(staff, first_case))
    assert selected["analyzed_master"]["company"] == COMPANY
    second_case = archive(staff)
    current = analysis(staff, second_case)
    assert current["selected_master"] is None and current["analyzed_master"] is None


def test_budget_expiry_discards_late_model_decision(monkeypatch):
    from shipping_ai.investigation import loop

    times = iter([0, 0, 0, 0, loop.BUDGET_SECONDS + 1])
    monkeypatch.setattr(loop, "monotonic", lambda: next(times))
    run = run_fixture(planner=lambda *_: {"tool": TEXT.tool})
    assert run.reason == "time_limit"
    assert [step.decision for step in run.steps] == [INSPECT]


def test_model_outage_retries_with_checkpoint_and_preserves_review(staff, monkeypatch):
    from test_phase_two import finish_queue

    from shipping_ai.ai.provider import ProviderUnavailable
    from shipping_ai.automation.tasks import MAX_RETRIES
    from shipping_ai.core.db import session_factory
    from shipping_ai.models import AutomationRun

    def unavailable(*_):
        raise ProviderUnavailable()

    monkeypatch.setattr(OllamaProvider, "choose_tool", unavailable)
    monkeypatch.setattr(OllamaProvider, "advise", unavailable)
    case, url = archive(staff, monkeypatch, bill=draft_bill(packages=513), with_model=True)
    run_id = UUID(staff.get(url).json()["id"])
    initial = staff.get(f"{case}/analysis").json()
    finish_queue()
    assert staff.get(url).json()["investigation"]["reason"] == "model_unavailable"
    for _ in range(MAX_RETRIES):
        with session_factory().begin() as db:
            db.get(AutomationRun, run_id).available_at = datetime.now(UTC)
        finish_queue()
    result = staff.get(url).json()
    assert result["state"] == "failed"
    assert result["investigation"]["status"] == "needs_review"
    assert len(result["investigation"]["steps"]) == 1
    assert staff.get(f"{case}/analysis").json()["findings"] == initial["findings"]
    assert staff.get(case).json()["import_id"] is None
