"""Collect printed consignee names from the same shipment for staff review."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from shipping_ai.documents.extract import party_value
from shipping_ai.review.schemas import Evidence
from shipping_ai.review.values import clean, folded

from .guidance import ReviewRole

SOURCE_ORDER = ("draft_bl", "invoice", "packing_list")
NON_NAMES = {"same as consignee", "to order", "to the order", "as per invoice", "as per b/l"}


class ConsigneeRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: UUID
    role: ReviewRole
    alternative_index: int | None = Field(default=None, ge=0)


class ConsigneeSource(BaseModel):
    ref: ConsigneeRef
    value: str
    status: Literal["present", "uncertain"]
    evidence: list[Evidence]


class ConsigneeOption(BaseModel):
    value: str
    sources: list[ConsigneeSource]


def consignee_options(docs):
    sources = []
    for role in SOURCE_ORDER:
        for doc in docs:
            if doc.role != role or doc.error == "multiple_workbook_sections":
                continue
            field = doc.fields.get("consignee")
            if not field:
                continue
            values = [
                (None, field.value, field.evidence),
                *(
                    (index, value.value, value.evidence)
                    for index, value in enumerate(field.alternatives)
                ),
            ]
            for index, value, evidence in values:
                name = clean(value)
                if (
                    not name
                    or len(name) > 254
                    or not party_value(name)
                    or folded(name).strip(" .,:;") in NON_NAMES
                    or not evidence
                    or any(cite.document_id != doc.document_id for cite in evidence)
                ):
                    continue
                sources.append(
                    ConsigneeSource(
                        ref=ConsigneeRef(
                            document_id=doc.document_id, role=role, alternative_index=index
                        ),
                        value=name,
                        status="present"
                        if index is None and field.status == "present"
                        else "uncertain",
                        evidence=evidence,
                    )
                )

    options = {}
    for source in sorted(sources, key=lambda entry: entry.ref.alternative_index is not None):
        key = folded(source.value)
        if key not in options:
            options[key] = ConsigneeOption(value=source.value, sources=[])
        options[key].sources.append(source)
    return list(options.values())
