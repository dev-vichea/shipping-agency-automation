"""Explicit worksheet/column imports with original cell evidence and Decimal validation."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from services.extraction import rows_from_workbook

from shipping_ai.documents.extract import at, cell_evidence, guarded_workbook, numeric_cell
from shipping_ai.review.schemas import MasterData, MasterItem
from shipping_ai.review.values import clean, currency, decimal, field, unit

Column = Literal[
    "serial",
    "item_code",
    "hs_code",
    "specification",
    "description",
    "unit",
    "approved_quantity",
    "approved_value",
    "remaining_quantity",
    "remaining_value",
    "unit_price",
]


class WorkbookSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sheet: str = Field(min_length=1, max_length=100)
    header_row: int = Field(ge=1, le=4999)
    columns: dict[Column, int] = Field(min_length=3, max_length=11)
    currency: str | None = None

    @model_validator(mode="after")
    def validate_columns(self):
        if not {"description", "unit", "approved_quantity"} <= self.columns.keys():
            raise ValueError("Map description, unit and approved quantity")
        if any(not 1 <= column <= 100 for column in self.columns.values()):
            raise ValueError("Columns must be between 1 and 100")
        if len(set(self.columns.values())) != len(self.columns):
            raise ValueError("Each column can be mapped once")
        if self.currency is not None and currency(self.currency) != self.currency:
            raise ValueError("Use a supported three-letter currency")
        return self


def workbook_catalog(data, name):
    guarded_workbook(data, name)
    return [
        {
            "name": title,
            "rows": [
                {"row": number, "cells": [clean(value)[:350] for value in cells]}
                for number, cells in rows[:30]
            ],
        }
        for title, rows in rows_from_workbook(data, name)
    ]


def parse_selection(data, name, source, selection):
    from .master import approval_key, company_key, document_reference

    guarded_workbook(data, name)
    workbook = dict(rows_from_workbook(data, name))
    if selection.sheet not in workbook:
        raise ValueError("Selected worksheet is missing")
    rows = workbook[selection.sheet]
    headers = dict(rows).get(selection.header_row, [])
    items = []
    for number, cells in rows:
        if number <= selection.header_row:
            continue

        def text(key):
            column = selection.columns.get(key)
            value = clean(at(cells, column - 1)) if column else None
            return field(
                value or None,
                *(
                    [cell_evidence(source, selection.sheet, number, column - 1, value)]
                    if value
                    else []
                ),
            )

        description, dimension = text("description"), text("unit")
        if not description.value and not dimension.value:
            continue
        if re.match(r"^(?:sub[- ]?total|grand total|total)\b", description.value or "", re.I):
            continue
        # Footer/category rows have no material quantity. Partially populated material
        # rows are rejected, rather than silently registered with incomplete limits.
        qty_col = selection.columns["approved_quantity"] - 1
        raw_quantity = clean(at(cells, qty_col))
        if not raw_quantity and not dimension.value:
            continue
        if not description.value or not dimension.value or decimal(raw_quantity) is None:
            raise ValueError(
                f"Row {number}: description, unit and a numeric approved quantity are required"
            )
        dimension.value = unit(dimension.value)

        def numeric(key, *, money=False):
            column = selection.columns.get(key)
            code = (
                selection.currency or currency(clean(at(headers, column - 1)))
                if money and column
                else None
            )
            result = numeric_cell(
                source,
                selection.sheet,
                number,
                cells,
                column - 1 if column else None,
                units=None if money and key != "unit_price" else dimension.value,
                code=code,
            )
            if result.value is not None and (
                decimal(result.value) is None or decimal(result.value) < 0
            ):
                raise ValueError(f"Row {number}: {key} must be a nonnegative number")
            return result

        items.append(
            MasterItem(
                row=number,
                serial=text("serial").value,
                item_code=text("item_code"),
                hs_code=text("hs_code"),
                specification=text("specification"),
                description=description,
                unit=dimension,
                approved_quantity=numeric("approved_quantity"),
                approved_value=numeric("approved_value", money=True),
                remaining_quantity=numeric("remaining_quantity"),
                remaining_value=numeric("remaining_value", money=True),
                unit_price=numeric("unit_price", money=True),
            )
        )
    if not items:
        raise ValueError("No material rows were found under the selected header")
    names, references = {}, {}
    for title, entries in workbook.items():
        for number, cells in entries[:12]:
            if title == selection.sheet and number >= selection.header_row:
                continue
            for raw in cells:
                text = clean(raw)
                if match := re.match(
                    r"^(?:company(?: name)?|ក្រុមហ៊ុន|公司名称)\s*[:：ៈ]\s*(.+)$", text, re.I
                ):
                    names[company_key(match[1])] = match[1]
                if match := document_reference(text):
                    references[approval_key(match[0])] = match[0]
    if len(names) > 1 or len(references) > 1:
        raise ValueError("Workbook approval headers are ambiguous; verify the original approval")
    return MasterData(
        company=next(iter(names.values()), ""),
        approval_ref=next(iter(references.values()), ""),
        layout="mapped_worksheet",
        items=items,
    )
