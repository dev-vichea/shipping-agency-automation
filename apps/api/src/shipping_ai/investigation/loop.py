"""Select and execute a bounded sequence of read-only package-count tools."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from time import monotonic

import pymupdf
from pydantic import ValidationError

from shipping_ai.ai.provider import InvalidAdvisory, ProviderUnavailable
from shipping_ai.documents.storage import LocalStorage
from shipping_ai.models import Document
from shipping_ai.review.compare import compare
from shipping_ai.review.values import decimal, field, usable

from .pdf import OCR_CONFIDENCE, EvidenceUnavailable, ocr_focused, ocr_scan, open_bill, pdf_text
from .schemas import (
    Decision,
    Investigation,
    Observation,
    Reason,
    Source,
    Step,
    StepResult,
    ToolSelection,
)

MAX_STEPS = 6
BUDGET_SECONDS = 110
INSPECT = Decision(tool="inspect_source_evidence")
TEXT = Decision(tool="extract_pdf_text")
SCAN = Decision(tool="ocr_pdf_region", profile="scan")
FOCUSED = Decision(tool="ocr_pdf_region", profile="focused")
COMPARE = Decision(tool="compare_document_fields")
REVIEW = Decision(tool="request_staff_review")


@dataclass(frozen=True)
class Sources:
    packing: Source | None
    bill: Source | None
    document: Document | None
    store: LocalStorage


def unambiguous(result: StepResult, *, confident=False) -> Observation | None:
    if result.ambiguous:
        return None
    observations = result.observations
    if confident:
        observations = [item for item in observations if (item.confidence or 0) >= OCR_CONFIDENCE]
    # A focused OCR pass needs a single region, even if multiple regions share a count.
    return observations[0] if len(observations) == 1 else None


def results(state):
    return {
        (step.decision.tool, step.decision.profile): step.result
        for step in state.steps
        if step.result is not None
    }


def available(state):
    completed = results(state)
    text = completed.get((TEXT.tool, None))
    scan = completed.get((SCAN.tool, SCAN.profile))
    focused = completed.get((FOCUSED.tool, FOCUSED.profile))
    if text is None:
        # Try the inexpensive text layer first. Staff review is always available.
        return [TEXT, REVIEW]
    if text.ambiguous or unambiguous(text) or focused is not None:
        return [COMPARE, REVIEW]
    if scan is None:
        return [SCAN, REVIEW]
    return [FOCUSED, REVIEW] if unambiguous(scan, confident=True) else [COMPARE, REVIEW]


def compare_counts(sources, state):
    completed = results(state)
    text = completed.get((TEXT.tool, None), StepResult())
    scan = completed.get((SCAN.tool, SCAN.profile), StepResult())
    focused = completed.get((FOCUSED.tool, FOCUSED.profile), StepResult())
    candidate = unambiguous(text)
    if not candidate and not text.observations and not text.ambiguous:
        first = unambiguous(scan, confident=True)
        second = unambiguous(focused, confident=True)
        if (
            first
            and second
            and first.page == second.page
            and first.value == second.value
            and pymupdf.Rect(first.bbox).intersects(pymupdf.Rect(second.bbox))
        ):
            candidate = second
    reference = sources.packing.extracted if sources.packing else None
    if not candidate or not usable(reference):
        return StepResult(
            outcome="NEEDS_REVIEW",
            ambiguous=any(result.ambiguous for result in (text, scan, focused)),
        )
    checked = compare(
        "transport",
        "packages",
        reference,
        field(candidate.value, unit="PKG"),
        suffix=".packing_list",
    )
    if checked and checked.outcome in {"PASS", "MISMATCH"}:
        return StepResult(outcome=checked.outcome, proposal=candidate)
    return StepResult(outcome="NEEDS_REVIEW")


def inspect(sources, _state, _deadline):
    return StepResult(packing=sources.packing, bill=sources.bill)


def read_text(sources, _state, _deadline):
    with open_bill(sources.store, sources.document) as pdf:
        return pdf_text(pdf)


def read_scan(sources, _state, deadline):
    with open_bill(sources.store, sources.document) as pdf:
        return ocr_scan(pdf, deadline)


def read_region(sources, state, deadline):
    source = unambiguous(results(state)[SCAN.tool, SCAN.profile], confident=True)
    with open_bill(sources.store, sources.document) as pdf:
        return ocr_focused(pdf, source, deadline)


def compare_tool(sources, state, _deadline):
    return compare_counts(sources, state)


def review_tool(_sources, _state, _deadline):
    return StepResult(outcome="NEEDS_REVIEW")


REGISTRY = {
    (INSPECT.tool, INSPECT.profile): inspect,
    (TEXT.tool, TEXT.profile): read_text,
    (SCAN.tool, SCAN.profile): read_scan,
    (FOCUSED.tool, FOCUSED.profile): read_region,
    (COMPARE.tool, COMPARE.profile): compare_tool,
    (REVIEW.tool, REVIEW.profile): review_tool,
}
TOOL_NAMES = frozenset(tool for tool, _ in REGISTRY)


def model_context(state, actions):
    # Send only typed findings and observation metadata. Source text stays in PostgreSQL.
    return {
        "objective": state.objective,
        "available": [action.model_dump(exclude_none=True) for action in actions],
        "observations": [
            {
                "tool": step.decision.tool,
                "profile": step.decision.profile,
                "candidates": len(step.result.observations),
                "ambiguous": step.result.ambiguous,
            }
            for step in state.steps
            if step.result is not None
        ],
    }


def terminal(state: Investigation, reason: Reason, proposal=None):
    state.reason = reason
    state.proposal = proposal
    state.status = "verified_proposal" if reason == "source_counts_agree" else "needs_review"
    return state


def run_loop(
    state: Investigation,
    sources: Sources,
    attempt: int,
    checkpoint: Callable[[Investigation], bool],
    plan: Callable[[dict, float], object] | None = None,
    *,
    step_limit: int = MAX_STEPS,
) -> Investigation | None:
    deadline = monotonic() + BUDGET_SECONDS
    state.status = "running"
    while True:
        if monotonic() >= deadline:
            return terminal(state, "time_limit")
        if state.steps and state.steps[-1].finished_at is None:
            step = state.steps[-1]
        else:
            if len(state.steps) >= step_limit:
                return terminal(state, "iteration_limit")
            actions = available(state) if state.steps else [INSPECT]
            if len(actions) == 1 or plan is None:
                decision = actions[0]
            else:
                try:
                    raw = plan(model_context(state, actions), deadline)
                    if isinstance(raw, dict) and isinstance(raw.get("tool"), str):
                        if raw["tool"] not in TOOL_NAMES:
                            return terminal(state, "unauthorized_tool")
                    selection = ToolSelection.model_validate(raw)
                except (ValidationError, InvalidAdvisory):
                    return terminal(state, "invalid_model_output")
                except ProviderUnavailable:
                    return terminal(state, "model_unavailable")
                if monotonic() >= deadline:
                    return terminal(state, "time_limit")
                decision = next(
                    (action for action in actions if action.tool == selection.tool), None
                )
                if decision is None:
                    return terminal(state, "unauthorized_tool")
            step = Step(
                number=len(state.steps) + 1,
                decision=decision,
                started_at=datetime.now(UTC),
                selected_attempt=attempt,
            )
            state.steps.append(step)
        # Checkpoint the chosen tool before touching the source. A lost worker replays that tool.
        if not checkpoint(state):
            return None
        error = None
        try:
            action = step.decision
            step.result = REGISTRY[action.tool, action.profile](sources, state, deadline)
        except EvidenceUnavailable as exc:
            step.error = error = exc.code
        if error is None and monotonic() >= deadline:
            step.error = error = "time_limit"
        step.completed_attempt = attempt
        step.finished_at = datetime.now(UTC)
        if error:
            terminal(state, error)
        elif step.decision == INSPECT and (
            not sources.document
            or not sources.packing
            or not usable(sources.packing.extracted)
            or decimal(usable(sources.packing.extracted)) is None
            or sources.packing.extracted.unit != "PKG"
        ):
            terminal(state, "insufficient_evidence")
        elif step.decision == REVIEW:
            terminal(state, "staff_review_requested")
        elif step.decision == COMPARE:
            reason = {
                "PASS": "source_counts_agree",
                "MISMATCH": "source_counts_differ",
                "NEEDS_REVIEW": "insufficient_evidence",
            }[step.result.outcome]
            terminal(state, reason, step.result.proposal)
        if state.reason:
            # The existing lease-fenced finish transaction writes the last step and terminal state.
            return state
        if not checkpoint(state):
            return None
