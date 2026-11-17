"""Build review tasks tied to the current extraction and original evidence."""

from dataclasses import dataclass
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from shipping_ai.documents.languages import languages
from shipping_ai.review.compare import AMOUNT_TOLERANCE
from shipping_ai.review.schemas import EnglishText, Evidence, ExtractedField
from shipping_ai.review.values import usable

ReviewRole = Literal["invoice", "packing_list", "draft_bl"]
IssueKey = Annotated[str, StringConstraints(min_length=1, max_length=200)]
REVIEW_ROLES = {"invoice", "packing_list", "draft_bl"}
REQUIRED = {
    "invoice": {"invoice_no", "supplier", "consignee"},
}
REQUIRED_ITEMS = {
    "invoice": {"description", "quantity", "unit", "unit_price", "amount"},
    "packing_list": {"description", "quantity", "unit"},
}


class FieldRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: UUID
    role: ReviewRole
    row: int | None
    name: str


class IssueAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: IssueKey
    action: Literal["confirm", "accept_ai", "cannot_verify"]


class Issue(BaseModel):
    key: IssueKey
    name: str
    severity: Literal["mismatch", "invalid", "missing", "uncertain", "suggestion"]
    message: str
    blocking: bool = False
    target: FieldRef | None = None
    value: str | None = None
    comparison: tuple[str | None, str | None] | None = None
    evidence: list[Evidence] = Field(default_factory=list)
    context_only: bool = False
    can_confirm: bool = False
    can_resolve: bool = False
    suggestion: EnglishText | None = None


@dataclass
class SourceField:
    ref: FieldRef
    field: ExtractedField
    nearby: list[Evidence]


def field_key(ref):
    return f"field:{ref.document_id}:{ref.role}:{ref.row or 0}:{ref.name}"


def source_fields(docs):
    fields = {}
    for doc in docs:
        if doc.role not in REVIEW_ROLES:
            continue
        for row, values in [(None, doc.fields), *((item.row, item.fields) for item in doc.items)]:
            nearby = next((value.evidence for value in values.values() if value.evidence), [])
            if row is None and doc.source_excerpt:
                nearby = doc.source_excerpt[:1]
            for name, value in values.items():
                ref = FieldRef(document_id=doc.document_id, role=doc.role, row=row, name=name)
                fields[field_key(ref)] = SourceField(ref, value, nearby)
    return fields


def proposals(docs):
    output = {}
    for key, source in source_fields(docs).items():
        proposed = source.field.english
        if not (
            source.field.value
            and proposed
            and proposed.status == "proposed"
            and proposed.value
            and proposed.evidence
            and proposed.evidence == source.field.evidence
        ):
            continue
        ref = source.ref
        if ref.row and ref.name == "description":
            ref = ref.model_copy(update={"name": "english_description"})
            key = field_key(ref)
        output[key] = proposed
    return output


def can_resolve(finding):
    return finding.outcome == "NEEDS_REVIEW" and (
        finding.group == "transport"
        or (
            finding.group == "invoice_packing"
            and finding.field == "description"
            and ".unpaired." not in finding.key
        )
    )


def locators(evidence):
    return {
        (e.document_id, e.sheet, e.cell, e.row, e.page, e.line, e.bbox, e.raw) for e in evidence
    }


def invalid_invoice_item(values, checked_number):
    invalid = set()
    quantity, price, amount = (
        checked_number(values[name].value) for name in ("quantity", "unit_price", "amount")
    )
    if values["quantity"].value and not quantity:
        invalid.add("quantity")
    for name, number in (("unit_price", price), ("amount", amount)):
        if values[name].value and (number is None or not values[name].currency):
            invalid.add(name)
    if all(number is not None for number in (quantity, price, amount)) and (
        values["amount"].currency != values["unit_price"].currency
        or abs(quantity * price - amount) > AMOUNT_TOLERANCE
    ):
        invalid.add("amount")
    return invalid


def order_issues(issues):
    priority = {"mismatch": 0, "invalid": 1, "missing": 2, "uncertain": 3, "suggestion": 4}
    return sorted(issues, key=lambda issue: (not issue.blocking, priority[issue.severity]))


def build_queue(docs, findings, blockers, checked_number):
    targets = source_fields(docs)
    suggestions = proposals(docs)
    issues = {}
    blocking_keys = {message.split(": ", 1)[0] for message in blockers}
    invalid_items = {
        (doc.document_id, item.row): invalid_invoice_item(item.fields, checked_number)
        for doc in docs
        if doc.role == "invoice"
        for item in doc.items
    }
    for key, source in targets.items():
        ref, field = source.ref, source.field
        required = ref.name in (
            REQUIRED_ITEMS.get(ref.role, set()) if ref.row else REQUIRED.get(ref.role, set())
        )
        if ref.name == "english_description" and ref.role == "invoice" and ref.row:
            description = targets.get(field_key(ref.model_copy(update={"name": "description"})))
            required = bool(
                description and set(languages(usable(description.field))) & {"km", "zh", "und"}
            )
            if description:
                source = SourceField(ref, field, description.field.evidence or source.nearby)

        severity, message = None, ""
        invalid = ref.name in invalid_items.get((ref.document_id, ref.row), set()) or bool(
            required
            and ref.row is None
            and field.value
            and len(field.value) > (160 if ref.name == "invoice_no" else 254)
        )
        if invalid:
            severity, message = "invalid", "Check the printed value against the required format."
        elif field.status == "uncertain":
            severity, message = "uncertain", "Verify this value against the source."
        elif required and not usable(field):
            severity, message = "missing", "A verified value is required."
        elif key in suggestions:
            severity, message = "suggestion", "An English suggestion is available."
        if severity:
            evidence = (
                suggestions[key].evidence if key in suggestions else field.evidence or source.nearby
            )
            issues[key] = Issue(
                key=key,
                name=ref.name,
                severity=severity,
                message=message,
                blocking=required and severity != "suggestion",
                target=ref,
                value=field.value,
                evidence=evidence,
                context_only=bool(evidence and not field.evidence and key not in suggestions),
                can_confirm=bool(
                    field.value and len(field.value) <= 350 and field.evidence and not invalid
                ),
                suggestion=suggestions.get(key),
            )

    by_name: dict[str, list] = {}
    for key, source in targets.items():
        citations = source.field.evidence
        english = source.field.english
        if english and english.status in {"source", "staff_verified"}:
            citations = [*citations, *english.evidence]
        by_name.setdefault(source.ref.name, []).append((key, source, locators(citations)))
    for finding in findings:
        if finding.outcome == "PASS":
            continue
        blocking = finding.key in blocking_keys or (
            finding.group == "extraction"
            and (
                finding.field == "document_limit"
                or (
                    finding.field == "invoice"
                    and "Invoice with line items is required." in blockers
                )
                or (
                    finding.field == "packing_list"
                    and "Packing list with line items is required." in blockers
                )
            )
        )
        evidence = locators(finding.evidence)
        matches = [
            (key, source)
            for key, source, cells in by_name.get(finding.field, [])
            if cells & evidence
        ]
        source = matches[0][1] if matches else None
        severity = "mismatch" if finding.outcome == "MISMATCH" else "uncertain"
        issues[finding.key] = Issue(
            key=finding.key,
            name=finding.field,
            severity=severity,
            message=finding.explanation,
            blocking=blocking,
            target=source.ref if source else None,
            value=source.field.value if source else None,
            comparison=(finding.left, finding.right) if finding.outcome == "MISMATCH" else None,
            evidence=finding.evidence,
            can_confirm=bool(source and source.field.value and source.field.evidence),
            can_resolve=can_resolve(finding),
        )
    return order_issues(issues.values())
