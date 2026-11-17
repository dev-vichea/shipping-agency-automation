from datetime import date, datetime
from decimal import Decimal
from hashlib import sha256
from json import dumps
from typing import Annotated, Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError
from sqlalchemy import select

from shipping_ai.ai.translation import overlay
from shipping_ai.cdc.master import check_cdc
from shipping_ai.documents.languages import languages, token_signature
from shipping_ai.intakes.schemas import SafeText
from shipping_ai.models import CdcMasterVersion, DocumentExtraction, ReviewSnapshot, StaffReview
from shipping_ai.permits.drafts import prepare
from shipping_ai.review.compare import AMOUNT_TOLERANCE, review_documents
from shipping_ai.review.schemas import EnglishText, Extraction, Finding, MasterItem
from shipping_ai.review.values import clean, currency, decimal, field, unit, usable

from .consignee import ConsigneeRef, consignee_options
from .guidance import (
    Issue,
    IssueAction,
    IssueKey,
    build_queue,
    can_resolve,
    field_key,
    order_issues,
    source_fields,
)

Note = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000), SafeText
]
Value = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=350), SafeText
]
Role = Literal["invoice", "packing_list", "draft_bl"]
NUMBERS = {
    "quantity",
    "packages",
    "gross_weight",
    "net_weight",
    "unit_price",
    "amount",
    "measurement",
}
DATES = {"invoice_date", "issue_date", "etd", "eta"}


class Revision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)


class Correction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: UUID
    role: Role
    row: int | None = Field(default=None, ge=1, le=5000)
    name: Annotated[str, StringConstraints(pattern=r"^[a-z_]{1,32}$")]
    value: Value
    unit: Value | None = None
    currency: Value | None = None
    note: Note
    issue_key: IssueKey | None = None
    alternative_index: int | None = Field(default=None, ge=0)
    consignee_source: ConsigneeRef | None = None


class Resolution(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: Annotated[str, StringConstraints(min_length=1, max_length=160), SafeText]
    note: Note


class Mapping(BaseModel):
    model_config = ConfigDict(extra="forbid")
    invoice_row: int = Field(ge=1, le=5000)
    master_row: int = Field(ge=1, le=5000)


class SaveReview(Revision):
    expected_review_id: UUID | None
    corrections: list[Correction] = Field(default_factory=list, max_length=300)
    resolutions: list[Resolution] = Field(default_factory=list, max_length=150)
    mappings: list[Mapping] = Field(default_factory=list, max_length=200)
    verify_cdc_mappings: bool = False
    request_correction: Note | None = None
    issue_actions: list[IssueAction] = Field(default_factory=list, max_length=300)


def digest(payload: dict) -> str:
    return sha256(dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def latest_review(db, case):
    return db.scalar(
        select(StaffReview)
        .where(
            StaffReview.intake_case_id == case.id, StaffReview.revision == case.analysis_revision
        )
        .order_by(StaffReview.created_at.desc(), StaffReview.id.desc())
        .limit(1)
    )


def analysis(db, case):
    snapshot = db.scalar(
        select(ReviewSnapshot).filter_by(intake_case_id=case.id, revision=case.analysis_revision)
    )
    if snapshot is None:
        raise HTTPException(409, "The current analysis is still pending")
    docs = [
        Extraction.model_validate(value)
        for value in db.scalars(
            select(DocumentExtraction.payload)
            .where(DocumentExtraction.snapshot_id == snapshot.id)
            .order_by(DocumentExtraction.role, DocumentExtraction.document_id)
        )
    ]
    return snapshot, docs


def checked_number(value):
    number = decimal(value)
    if number is None or not 0 <= number < Decimal("100000000000000"):
        return None
    if number != number.quantize(Decimal("0.000001")):
        return None
    return number


def normalize_date(value: str) -> str:
    cleaned = clean(value)
    try:
        return date.fromisoformat(cleaned).isoformat()
    except ValueError:
        for fmt in (
            "%d-%b-%Y",
            "%d %b %Y",
            "%d-%B-%Y",
            "%d %B %Y",
            "%d/%m/%Y",
            "%d-%m-%Y",
            "%d.%m.%Y",
            "%Y/%m/%d",
            "%Y.%m.%d",
            "%m/%d/%Y",
            "%m-%d-%Y",
            "%b-%d-%Y",
            "%b %d %Y",
        ):
            try:
                return datetime.strptime(cleaned, fmt).date().isoformat()
            except ValueError:
                pass
        raise HTTPException(422, "Use a calendar date in YYYY-MM-DD format") from None


def apply_corrections(docs, corrections):
    index = {(doc.document_id, doc.role): doc for doc in docs}
    seen = set()
    changes = []
    # Snapshot the printed names before applying edits to a related document in this review.
    printed_consignees = (
        consignee_options(docs) if any(edit.consignee_source for edit in corrections) else []
    )
    # Validate English against any source correction submitted in the same review.
    for edit in sorted(corrections, key=lambda entry: entry.name == "english_description"):
        key = (edit.document_id, edit.role, edit.row, edit.name)
        doc = index.get(key[:2])
        row = next((item for item in doc.items if item.row == edit.row), None) if doc else None
        values = (row.fields if row else None) if edit.row else (doc.fields if doc else None)
        if key in seen or values is None or edit.name not in values:
            raise HTTPException(422, "A correction does not identify a unique extracted field")
        seen.add(key)
        original = values[edit.name]
        citations = original.evidence
        dimension, code = original.unit, original.currency
        if edit.consignee_source is not None:
            source = next(
                (
                    candidate
                    for option in printed_consignees
                    for candidate in option.sources
                    if candidate.ref == edit.consignee_source and candidate.value == edit.value
                ),
                None,
            )
            if (
                source is None
                or edit.name != "consignee"
                or edit.row is not None
                or edit.role not in {"invoice", "packing_list"}
                or edit.alternative_index is not None
                or edit.unit is not None
                or edit.currency is not None
            ):
                raise HTTPException(
                    422, "Choose a printed consignee from this shipment's current analysis."
                )
            citations = source.evidence
        elif edit.alternative_index is not None:
            candidate = next(
                iter(original.alternatives[edit.alternative_index : edit.alternative_index + 1]),
                None,
            )
            if (
                not candidate
                or not candidate.evidence
                or (edit.value, edit.unit, edit.currency)
                != (candidate.value, candidate.unit, candidate.currency)
            ):
                raise HTTPException(
                    422, "Choose an original source candidate from the current analysis."
                )
            citations = candidate.evidence
            dimension, code = candidate.unit, candidate.currency
        value = clean(edit.value)
        if edit.name in NUMBERS:
            number = checked_number(value)
            if number is None:
                raise HTTPException(422, "Use a nonnegative number with up to six decimal places")
            value = str(number)
            if edit.unit:
                dimension = unit(edit.unit)
            if edit.currency:
                code = currency(edit.currency)
                if not code or len(edit.currency) != 3:
                    raise HTTPException(422, "Use a supported three-letter currency code")
            if edit.name in {"unit_price", "amount"} and not code:
                raise HTTPException(422, "Enter the currency for this price or amount")
        elif edit.name in DATES:
            value = normalize_date(value)
        elif edit.name == "unit":
            value = unit(value)
        if not value:
            raise HTTPException(422, "A correction must supply a value")
        if edit.name == "english_description" and row:
            source = values["description"]
            if (
                languages(value) != ["en"]
                or token_signature(value)[1] != token_signature(source.value or "")[1]
            ):
                raise HTTPException(
                    422, "Enter an English description preserving the source numbers."
                )
        if edit.name == "invoice_no" and len(value) > 160:
            raise HTTPException(422, "Invoice reference is too long")
        values[edit.name] = field(value, *citations, unit=dimension, currency=code)
        if edit.name == "english_description" and row:
            values[edit.name].evidence = source.evidence
            source.english = EnglishText(
                value=value,
                status="staff_verified",
                evidence=source.evidence,
            )
        changes.append(
            {
                "edit": edit.model_dump(mode="json"),
                "before": original.model_dump(mode="json"),
                "after": values[edit.name].model_dump(mode="json"),
            }
        )

    for doc in docs:
        for item in doc.items:
            dimension = usable(item.fields.get("unit"))
            for name in ("quantity", "unit_price"):
                if dimension and name in item.fields:
                    item.fields[name].unit = dimension
    return changes


def blockers_for(docs, resolutions):
    findings, roles = review_documents(docs)
    invoice, packing = roles.get("invoice"), roles.get("packing_list")
    blockers = []
    for doc, keys, title in (
        (invoice, ("invoice_no", "supplier", "consignee"), "Invoice"),
        (packing, (), "Packing list"),
    ):
        if not doc or not doc.items:
            blockers.append(f"{title} with line items is required.")
            continue
        for key in keys:
            value = usable(doc.fields.get(key))
            if not value or len(value) > (160 if key == "invoice_no" else 254):
                blockers.append(f"{title} {key.replace('_', ' ')} is required.")
    if invoice:
        for item in invoice.items:
            f = item.fields
            quantity, price, amount = (
                checked_number(usable(f[key])) for key in ("quantity", "unit_price", "amount")
            )
            if not usable(f["description"]) or not usable(f["unit"]) or not quantity:
                blockers.append(
                    f"Invoice row {item.row} requires a description, positive quantity and unit."
                )
            if set(languages(usable(f["description"]))) & {"km", "zh", "und"} and not usable(
                f.get("english_description")
            ):
                blockers.append(
                    f"Invoice row {item.row} requires a verified English goods description."
                )
            if (
                price is None
                or amount is None
                or not f["amount"].currency
                or f["amount"].currency != f["unit_price"].currency
            ):
                blockers.append(
                    f"Invoice row {item.row} requires a price and amount in the same currency."
                )
            elif quantity and abs(quantity * price - amount) > AMOUNT_TOLERANCE:
                blockers.append(f"Invoice row {item.row} quantity × price differs from its amount.")

    for check in findings:
        if check.outcome not in {"MISMATCH", "NEEDS_REVIEW"}:
            continue
        if check.group == "invoice_packing":
            if (
                check.field == "description"
                and ".unpaired." not in check.key
                and check.key in resolutions
            ):
                continue
        elif check.group == "validation":
            if check.field == "currency_uniformity" and check.outcome == "NEEDS_REVIEW":
                continue
        elif check.group == "transport":
            if check.outcome == "NEEDS_REVIEW" and check.key in resolutions:
                continue
        elif check.group == "extraction" and check.key.startswith("extraction.conflict."):
            pass  # The existing field correction flow can resolve the conflict.
        else:
            continue
        blockers.append(f"{check.key}: {check.explanation}")
    return blockers, roles, findings


def guided_queue(snapshot, docs, saved=None):
    blockers, _, findings = blockers_for(docs, {})
    keys = {finding.key for finding in findings}
    findings.extend(
        Finding.model_validate(value) for value in snapshot.findings if value["key"] not in keys
    )
    annotated = [doc.model_copy(deep=True) for doc in docs]
    overlay(annotated, snapshot.translations, ai_state=snapshot.ai_state)
    queue = build_queue(annotated, findings, blockers, checked_number)
    original = {issue.key for issue in queue}
    additional = saved.payload.get("additional_issues", []) if saved else []
    return order_issues(
        [
            *queue,
            *(Issue.model_validate(issue) for issue in additional if issue["key"] not in original),
        ]
    )


def apply_guided_actions(issues, docs, request):
    targets = source_fields(docs)
    issue_by_key = {issue.key: issue for issue in issues}
    actions, automatic, representations = {}, [], []
    for entry in request.issue_actions:
        issue = issue_by_key.get(entry.key)
        if not issue or entry.key in actions:
            raise HTTPException(422, "Choose a unique issue from the current document review.")
        source = targets.get(field_key(issue.target)) if issue.target else None
        actions[entry.key] = {
            **entry.model_dump(mode="json"),
            "target": issue.target.model_dump(mode="json") if issue.target else None,
            "evidence": [cite.model_dump(mode="json") for cite in issue.evidence],
            "context_only": issue.context_only,
            "value": issue.value,
        }
        if entry.action == "confirm":
            if not issue.can_confirm:
                raise HTTPException(422, "Confirm a value only when the original can be verified.")
            if source and entry.key.startswith("field:") and source.field.status == "uncertain":
                try:
                    correction = Correction(
                        **source.ref.model_dump(),
                        value=source.field.value,
                        unit=source.field.unit,
                        currency=source.field.currency,
                        note="Confirmed against original document evidence.",
                    )
                except ValidationError:
                    raise HTTPException(
                        422, "Use a manual correction to verify this value."
                    ) from None
                automatic.append(correction)
        elif entry.action == "accept_ai":
            suggestion = issue.suggestion
            if not suggestion or not source:
                raise HTTPException(422, "This issue has no current evidence-backed AI suggestion.")
            actions[entry.key]["suggestion"] = suggestion.model_dump(mode="json")
            if source.ref.name == "english_description":
                description_key = field_key(source.ref.model_copy(update={"name": "description"}))
                if any(field_key(edit) == description_key for edit in request.corrections):
                    raise HTTPException(
                        422, "Verify the English description manually after correcting its source."
                    )
                automatic.append(
                    Correction(
                        **source.ref.model_dump(),
                        value=suggestion.value,
                        note="Accepted English suggestion after checking original document evidence.",
                    )
                )
            else:
                representations.append((source, suggestion))
    changes = apply_corrections(docs, [*request.corrections, *automatic])
    current = source_fields(docs)
    for source, suggestion in representations:
        field = current[field_key(source.ref)].field
        if field is not source.field:
            raise HTTPException(
                422, "Choose either a manual correction or the English suggestion for this field."
            )
        before = field.model_dump(mode="json")
        field.english = suggestion.model_copy(update={"status": "staff_verified", "reason": None})
        changes.append(
            {
                "edit": Correction(
                    **source.ref.model_dump(),
                    value=suggestion.value,
                    note="Accepted English suggestion after checking original document evidence.",
                ).model_dump(mode="json"),
                "before": before,
                "after": field.model_dump(mode="json"),
            }
        )
    return changes, actions


def review_payload(db, snapshot, docs, request, previous=None):
    initial_issues = guided_queue(snapshot, docs, previous)
    initial_keys = {issue.key for issue in initial_issues}
    linked_issues = {edit.issue_key for edit in request.corrections if edit.issue_key}
    if not linked_issues <= initial_keys:
        raise HTTPException(422, "Link corrections to issues from the current document review.")
    changes, actions = apply_guided_actions(initial_issues, docs, request)
    resolutions = {entry.key: entry.note for entry in request.resolutions}
    if len(resolutions) != len(request.resolutions):
        raise HTTPException(422, "Each finding can be resolved once")
    blockers, roles, findings = blockers_for(docs, resolutions)
    incomplete = [
        Finding.model_validate(check)
        for check in snapshot.findings
        if check["field"] == "document_limit"
    ]
    if incomplete:
        blockers.append("Analysis did not cover all active documents.")
    reviewable = {check.key for check in findings if can_resolve(check)}
    passed_resolvable = {
        check.key
        for check in findings
        if check.outcome == "PASS"
        and (
            check.group == "transport"
            or (check.group == "invoice_packing" and check.field == "description")
        )
    }
    if not resolutions.keys() <= (reviewable | passed_resolvable):
        raise HTTPException(
            422,
            "Resolve wording or uncertain transport findings with a note. Correct source conflicts in the reviewed fields.",
        )
    invoice = roles.get("invoice")
    master = (
        db.get(CdcMasterVersion, snapshot.cdc_master_version_id)
        if snapshot.cdc_master_version_id
        else None
    )
    cdc_findings, candidates = check_cdc(invoice, master)
    master_rows = {item["row"] for item in master.items} if master else set()
    options = {(c.invoice_document_id, c.invoice_row, c.master_row) for c in candidates} | (
        {(invoice.document_id, item.row, m_row) for item in invoice.items for m_row in master_rows}
        if invoice and master
        else set()
    )
    selected = {(m.invoice_row, m.master_row) for m in request.mappings}
    if selected and not request.verify_cdc_mappings:
        raise HTTPException(422, "Confirm the selected CDC rows were checked against the source.")
    if len({m.invoice_row for m in request.mappings}) != len(request.mappings) or any(
        invoice is None or (invoice.document_id, row, master_row) not in options
        for row, master_row in selected
    ):
        raise HTTPException(422, "Choose one current CDC candidate per invoice row")
    if request.request_correction:
        blockers.insert(
            0, "A staff correction was requested. Save a new review after resolving it."
        )
    for action in actions.values():
        if action["action"] == "cannot_verify":
            name = (
                action["target"]["name"]
                if action["target"]
                else next(issue.name for issue in initial_issues if issue.key == action["key"])
            )
            blockers.append(f"{name.replace('_', ' ').capitalize()} could not be verified.")
    reviewed_queue = build_queue(
        docs, [*findings, *cdc_findings, *incomplete], blockers, checked_number
    )
    statuses = {
        issue.key: issue.blocking for issue in reviewed_queue if issue.key not in resolutions
    }
    targets = source_fields(docs)
    for issue in initial_issues:
        if issue.suggestion:
            field = targets[issue.key].field
            verified = (
                bool(usable(field))
                if issue.target.name == "english_description"
                else field.english is not None and field.english.status == "staff_verified"
            )
            if not verified:
                statuses.setdefault(issue.key, issue.blocking)
    manual = {
        f"field:{edit.document_id}:{edit.role}:{edit.row or 0}:{edit.name}"
        for edit in request.corrections
    }
    for key in manual:
        if not statuses.get(key):
            statuses.pop(key, None)
    for key, action in actions.items():
        if action["action"] == "cannot_verify":
            statuses[key] = True
        elif not statuses.get(key):
            statuses.pop(key, None)

    original_keys = initial_keys - {
        entry["key"]
        for entry in (previous.payload.get("additional_issues", []) if previous else [])
    }
    extra = {
        issue.key: issue.model_copy(update={"can_confirm": False, "suggestion": None})
        for issue in [*initial_issues, *reviewed_queue]
        if issue.key not in original_keys and (issue.key in statuses or issue.key in linked_issues)
    }

    permit_pending, cdc_names = None, []
    if not blockers:
        packing = roles["packing_list"]
        arguments, permit_pending = prepare(
            invoice, packing, master, request.model_dump()["mappings"]
        )
        if arguments:
            rows = {item["row"]: MasterItem.model_validate(item) for item in master.items}
            mappings = {entry.invoice_row: entry.master_row for entry in request.mappings}
            cdc_names = [
                {
                    "invoice_document_id": str(invoice.document_id),
                    "invoice_row": item.row,
                    "packing_document_id": str(packing.document_id),
                    "packing_row": packing_line["row"],
                    "master_row": mappings[item.row],
                    "description": line["english_provided"],
                    "evidence": [
                        cite.model_dump(mode="json")
                        for cite in rows[mappings[item.row]].description.evidence
                    ],
                }
                for item, line, packing_line in zip(
                    invoice.items, arguments[2], arguments[4], strict=True
                )
            ]
    payload = {
        **request.model_dump(mode="json", exclude={"expected_review_id"}),
        "analysis_id": str(snapshot.id),
        "master_id": str(snapshot.cdc_master_version_id)
        if snapshot.cdc_master_version_id
        else None,
        "documents": [doc.model_dump(mode="json") for doc in docs],
        "findings": [check.model_dump(mode="json") for check in findings],
        "changes": changes,
        "issue_log": list(actions.values()),
        "open_issues": statuses,
        "reviewed_issue_keys": sorted(initial_keys | extra.keys()),
        "additional_issues": [issue.model_dump(mode="json") for issue in extra.values()],
        "cdc_findings": [check.model_dump(mode="json") for check in cdc_findings],
        "candidates": [candidate.model_dump(mode="json") for candidate in candidates],
        "blockers": blockers,
        "permit_pending": permit_pending,
        "cdc_names": cdc_names,
    }
    return payload
