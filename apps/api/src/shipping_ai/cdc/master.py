import re
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from services.extraction import extract_cdc, rows_from_workbook
from services.matching import candidate_score

from shipping_ai.documents.extract import at, cell_evidence, guarded_workbook, numeric_cell
from shipping_ai.review.compare import compare, descriptions, finding
from shipping_ai.review.schemas import Candidate, Extraction, MasterData, MasterItem
from shipping_ai.review.values import (
    clean,
    convert,
    currency,
    decimal,
    field,
    folded,
    identity,
    unit,
    usable,
)

BALANCE_MAX_AGE = timedelta(days=30)


def company_key(name: str | None) -> str:
    return identity(name)


def approval_key(ref: str) -> str:
    return re.sub(r"^(?:qip|cib)[\s:#/-]*", "", folded(ref)).strip().upper()


def parse_master(data: bytes, name: str, source: UUID) -> MasterData:
    guarded_workbook(data, name)
    meta, parsed = extract_cdc(data, name)
    if not parsed:
        raise ValueError("Unsupported CDC Master List layout")
    sheet = meta["sheet"]
    rows = dict(rows_from_workbook(data, name))[sheet]
    headers: dict[int, str] = defaultdict(str)
    for number, cells in rows[:20]:
        if number >= parsed[0]["row"]:
            break
        for col, value in enumerate(cells):
            headers[col] = f"{headers[col]} {folded(clean(value))}".strip()

    def col(pattern):
        return next((i for i, value in headers.items() if re.search(pattern, value, re.I)), None)

    is_english = col(r"description[s]? of goods") is not None
    desc_col = col(r"description[s]? of goods") if is_english else 1
    unit_col = col(r"(?:^| )unit(?: |$)(?! price)") if is_english else 2
    qty_col = col(r"\bquantity\b") if is_english else 3
    price_col = col(r"unit\s*price|u\.price|តម្លៃរាយ|单价")
    value_col = col(r"total\s*(?:price|value|amount)|approved\s*value|តម្លៃសរុប")
    remaining_col = col(r"\bending\b") if is_english else 16
    remaining_value_col = col(r"balance\s*(?:amount|value)|remaining\s*value")
    if unit_col is None or qty_col is None:
        raise ValueError("CDC unit and approved quantity columns are required")

    indexed = dict(rows)
    items = []
    for item in parsed:
        number = item["row"]
        cells = indexed[number]
        name_value = clean(at(cells, desc_col))
        unit_value = unit(clean(at(cells, unit_col)))
        if not name_value or not unit_value:
            continue

        def number_at(column, *, units=None, money=False):
            code = currency(headers.get(column, "")) if money else None
            return numeric_cell(source, sheet, number, cells, column, units=units, code=code)

        items.append(
            MasterItem(
                row=number,
                description=field(
                    name_value[:350], cell_evidence(source, sheet, number, desc_col, name_value)
                ),
                unit=field(
                    unit_value, cell_evidence(source, sheet, number, unit_col, at(cells, unit_col))
                ),
                approved_quantity=number_at(qty_col, units=unit_value),
                approved_value=number_at(value_col, money=True),
                unit_price=number_at(price_col, units=unit_value, money=True),
                remaining_quantity=number_at(remaining_col, units=unit_value),
                remaining_value=number_at(remaining_value_col, money=True),
            )
        )
    if not items:
        raise ValueError("No CDC item rows could be read")
    layout = (
        "english_cut_stock"
        if is_english and remaining_col is not None
        else "english_application"
        if is_english
        else "khmer_quota"
    )
    return MasterData(
        company=clean(meta.get("company")),
        approval_ref=clean(meta.get("qip")),
        layout=layout,
        items=items,
    )


def check_cdc(invoice: Extraction | None, master, today: date | None = None):
    group = "cdc"
    if master is None:
        return [
            finding(
                group,
                "version",
                "NEEDS_REVIEW",
                "Select the verified CDC Master List for this company, year and approval reference.",
            )
        ], []
    company = invoice.fields.get("consignee") if invoice else None
    if not usable(company) or company_key(company.value) != master.company_key:
        return [
            finding(
                group,
                "company",
                "NEEDS_REVIEW",
                "The invoice consignee could not be matched to the selected CDC company.",
                company,
                field(master.company),
            )
        ], []

    rows = [MasterItem.model_validate(item) for item in master.items]
    result = [
        finding(
            group,
            "version",
            "PASS",
            f"Selected workbook is recorded for {master.year} / {master.approval_ref}. Company agrees.",
            company,
            field(master.company),
        )
    ]
    candidates = []
    quantity_totals: dict[int, Decimal] = defaultdict(Decimal)
    amount_totals: dict[int, Decimal] = defaultdict(Decimal)
    amount_unknown: set[int] = set()
    amount_evidence: dict[int, list] = defaultdict(list)
    paired: dict[int, list] = defaultdict(list)
    today = today or datetime.now(UTC).date()
    fresh = bool(
        master.balance_as_of and timedelta(0) <= today - master.balance_as_of <= BALANCE_MAX_AGE
    )

    for item in invoice.items:
        labels = descriptions(item)
        ranked = sorted(
            (
                (
                    max(
                        (candidate_score(label, row.description.value) for label in labels),
                        default=0,
                    ),
                    row,
                )
                for row in rows
            ),
            key=lambda pair: (-pair[0], pair[1].row),
        )
        for score, row in ranked[:3]:
            if score >= 40:
                candidates.append(
                    Candidate(
                        invoice_document_id=invoice.document_id,
                        invoice_row=item.row,
                        master_row=row.row,
                        description=row.description.value,
                        score=score,
                        evidence=row.description.evidence[0],
                    )
                )

        a = item.fields
        prefix = f"cdc.row.{item.row}"
        if not ranked or ranked[0][0] < 60:
            result.append(
                finding(
                    group,
                    "description",
                    "NEEDS_REVIEW",
                    "No sufficiently similar CDC item was found.",
                    a.get("description"),
                    key=f"{prefix}.unmatched",
                )
            )
            continue
        score, row = ranked[0]
        if len(ranked) > 1 and score - ranked[1][0] < 8:
            result.append(
                finding(
                    group,
                    "description",
                    "NEEDS_REVIEW",
                    "Several CDC candidates have similar scores.",
                    a.get("description"),
                    row.description,
                    key=f"{prefix}.ambiguous",
                )
            )
            continue

        result.append(
            finding(
                group,
                "description",
                "NEEDS_REVIEW",
                "A candidate is available. Staff must confirm the item, specifications and eligibility.",
                a.get("description"),
                row.description,
                key=f"{prefix}.candidate",
            )
        )
        units = compare(
            group, "unit", a.get("unit"), row.unit, required=True, suffix=f".{item.row}"
        )
        if units:
            result.append(units)
        if row.unit_price.value is not None:
            price = compare(
                group,
                "unit_price",
                a.get("unit_price"),
                row.unit_price,
                required=True,
                suffix=f".{item.row}",
            )
            if price:
                result.append(price)
        qty = a.get("quantity")
        normalized = (
            convert(decimal(qty.value), qty.unit, row.unit.value)
            if usable(qty) and decimal(qty.value) is not None
            else None
        )
        if normalized is None:
            if not fresh or decimal(usable(row.remaining_quantity)) is None:
                result.append(
                    finding(
                        group,
                        "balance_unknown",
                        "NEEDS_REVIEW",
                        "Remaining quantity is absent, uncertain or not dated within 30 days.",
                        qty,
                        row.remaining_quantity,
                        key=f"{prefix}.balance_unknown",
                    )
                )
            result.append(
                finding(
                    group,
                    "quantity",
                    "NEEDS_REVIEW",
                    "Quantity cannot be compared in the CDC unit.",
                    qty,
                    row.approved_quantity,
                    key=f"{prefix}.quantity",
                )
            )
            continue
        quantity_totals[row.row] += normalized
        paired[row.row].append(qty)
        amount = a.get("amount")
        if (
            usable(amount)
            and decimal(amount.value) is not None
            and amount.currency
            and amount.currency == (row.approved_value.currency or row.remaining_value.currency)
        ):
            amount_totals[row.row] += decimal(amount.value)
            amount_evidence[row.row].extend(amount.evidence)
        else:
            amount_unknown.add(row.row)

    for row in rows:
        if row.row not in quantity_totals:
            continue
        total = quantity_totals[row.row]
        qty = field(
            str(total),
            *(e for value in paired[row.row] for e in value.evidence),
            unit=row.unit.value,
        )
        prefix = f"cdc.quota.{row.row}"
        for name, limit in (
            ("approved_quantity", row.approved_quantity),
            ("remaining_quantity", row.remaining_quantity),
        ):
            ceiling = decimal(usable(limit))
            if name == "remaining_quantity" and (not fresh or ceiling is None):
                result.append(
                    finding(
                        group,
                        "balance_unknown",
                        "NEEDS_REVIEW",
                        "Remaining quantity is absent, uncertain or not dated within 30 days.",
                        qty,
                        limit,
                        key=f"{prefix}.balance_unknown",
                    )
                )
                continue
            if ceiling is not None:
                result.append(
                    finding(
                        group,
                        name,
                        "MISMATCH" if total > ceiling else "PASS",
                        "Combined candidate quantity exceeds the workbook limit."
                        if total > ceiling
                        else "Combined candidate quantity is within the stated workbook limit.",
                        qty,
                        limit,
                        key=f"{prefix}.{name}",
                    )
                )
        for name, limit in (
            ("approved_value", row.approved_value),
            ("remaining_value", row.remaining_value),
        ):
            ceiling = decimal(usable(limit))
            if ceiling is None:
                continue
            if (
                row.row in amount_unknown
                or not limit.currency
                or (name == "remaining_value" and not fresh)
            ):
                result.append(
                    finding(
                        group,
                        name,
                        "NEEDS_REVIEW",
                        "No comparable current value is available.",
                        None,
                        limit,
                        key=f"{prefix}.{name}",
                    )
                )
                continue
            amount = amount_totals[row.row]
            result.append(
                finding(
                    group,
                    name,
                    "MISMATCH" if amount > ceiling else "PASS",
                    "Combined candidate value exceeds the workbook limit."
                    if amount > ceiling
                    else "Combined candidate value is within the stated workbook limit.",
                    field(str(amount), *amount_evidence[row.row], currency=limit.currency),
                    limit,
                    key=f"{prefix}.{name}",
                )
            )
    return result, candidates
