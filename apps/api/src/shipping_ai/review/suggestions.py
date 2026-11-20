"""Source-bound alternatives. Agreement is evidence, never authority to correct a source."""

import re
from typing import Annotated, Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from shipping_ai.intakes.schemas import SafeText

from .values import usable


class SourceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: UUID
    role: Literal["invoice", "packing_list", "draft_bl", "final_bl"]
    row: int | None = Field(default=None, ge=1, le=5000)
    name: str = Field(pattern=r"^[a-z_]{1,32}$")


class FindingDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: Annotated[str, StringConstraints(min_length=1, max_length=160), SafeText]
    action: Literal["approved", "rejected", "unresolved"]
    note: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000), SafeText
    ]
    source: SourceRef | None = None
    master_row: int | None = Field(default=None, ge=1, le=5000)


def fields(docs):
    for doc in docs:
        if doc.role not in {"invoice", "packing_list", "draft_bl", "final_bl"}:
            continue
        for row, values in [(None, doc.fields), *((item.row, item.fields) for item in doc.items)]:
            for name, value in values.items():
                yield (
                    SourceRef(document_id=doc.document_id, role=doc.role, row=row, name=name),
                    value,
                )


def alternatives(docs, findings):
    indexed = list(fields(docs))
    output = []
    for check in findings:
        if check.group == "cdc" or check.outcome == "PASS":
            continue
        options = []
        for ref, value in indexed:
            names = {check.field}
            if check.field == "shipper":
                names.add("supplier")
            if ref.name not in names or not value.evidence or not value.value:
                continue
            if not any(cite in check.evidence for cite in value.evidence):
                continue
            options.append(
                {"source": ref.model_dump(mode="json"), "field": value.model_dump(mode="json")}
            )
        target = next(
            (
                option["source"]
                for option in options
                if option["source"]["role"] in {"draft_bl", "final_bl"}
            ),
            options[0]["source"] if options else None,
        )
        output.append({"key": check.key, "target": target, "options": options})
    return output


def decision_corrections(docs, findings, decisions):
    """Validate selections against the immutable analysis, including exact source citations."""
    checks = {check.key: check for check in findings}
    offers = {entry["key"]: entry for entry in alternatives(docs, findings)}
    changes, seen = [], set()
    for decision in decisions:
        if decision.key in seen:
            raise HTTPException(422, "Each finding can have only one current decision")
        seen.add(decision.key)
        if re.fullmatch(r"cdc\.row\.[1-9][0-9]{0,3}\.mapping", decision.key):
            if decision.source:
                raise HTTPException(422, "A CDC decision must select a CDC row")
            continue
        check = checks.get(decision.key)
        if not check or decision.master_row is not None:
            raise HTTPException(422, "Choose a finding from the current analysis")
        if decision.action != "approved":
            if decision.source:
                raise HTTPException(422, "Only an approved decision may select a source value")
            continue
        if check.outcome == "PASS":
            if decision.source:
                raise HTTPException(422, "A passing finding does not need a replacement value")
            continue
        offer = offers.get(decision.key)
        selected = (
            next(
                (
                    option
                    for option in offer["options"]
                    if decision.source
                    and option["source"] == decision.source.model_dump(mode="json")
                ),
                None,
            )
            if offer
            else None
        )
        if not selected or not offer["target"]:
            raise HTTPException(
                422, "Select a cited source value or correct the field with a reason"
            )
        # OCR values need a separate explicit field correction; selecting one is not verification.
        if selected["field"]["status"] != "present":
            raise HTTPException(422, "Verify the uncertain source with a field correction first")
        changes.append(
            {
                **offer["target"],
                "value": selected["field"]["value"],
                "unit": selected["field"]["unit"],
                "currency": selected["field"]["currency"],
                "note": decision.note,
                "suggestion_source": decision.source,
                "finding_key": decision.key,
            }
        )
    return changes


def source_field(docs, ref):
    return next((value for source, value in fields(docs) if source == ref and usable(value)), None)
