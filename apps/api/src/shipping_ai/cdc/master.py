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
    source_identity,
    unit,
    usable,
)

BALANCE_MAX_AGE = timedelta(days=30)


def company_key(name: str | None) -> str:
    return identity(name)


REFERENCE_LABEL = r"(?:(?:file|letter|reference|ref)\s+(?:no\.?|number|[:：])|no\.?|number)"
REFERENCE_NUMBER = r"(?:[A-Z]*[0-9][A-Z0-9]*(?:[/-][A-Z0-9]+)*|[A-Z]{2,}[/-][0-9][A-Z0-9/-]*)"
DOCUMENT_REFERENCE = re.compile(
    rf"\b(?P<kind>CDC|QIP|CIB)\s*(?P<label>{REFERENCE_LABEL})?\s*(?:[.:：#/-]\s*)?"
    rf"(?P<code>{REFERENCE_NUMBER})\b",
    re.I,
)


def document_reference(text: str) -> re.Match[str] | None:
    for match in DOCUMENT_REFERENCE.finditer(text):
        code = match["code"]
        # A bare CIB form code (for example, CIB 01E(i)) is a template identifier.
        if match["kind"].upper() == "QIP" or match["label"] or "/" in code or "-" in code:
            return match
    return None


def approval_key(ref: str) -> str:
    return (
        re.sub(rf"^(?:cdc|qip|cib)\s*(?:{REFERENCE_LABEL})?[\s:#./：-]*", "", folded(ref))
        .strip()
        .upper()
    )


def format_category_title(raw: str) -> str:
    cleaned = re.sub(r"^[\s.:：#/-]+", "", raw).strip()
    cleaned = re.sub(r"[\s.:：#/-]+$", "", cleaned).strip()
    upper = cleaned.upper()
    if "MACHIN" in upper:
        return "Machinery & Equipment"
    if "RAW MATERIAL" in upper or "ACCESSOR" in upper or "FABRIC" in upper:
        return "Raw Materials & Accessories"
    if "PACKAG" in upper:
        return "Packaging Materials"
    if "SPARE" in upper:
        return "Spare Parts"
    if "CONSTRUCTION" in upper:
        return "Construction Materials"
    return cleaned.title()


def detect_category_header(cells: list) -> str | None:
    non_empty = [str(c).strip() for c in cells if c is not None and str(c).strip()]
    if not non_empty:
        return None
    joined = " ".join(non_empty).strip()
    if re.search(
        r"\b(?:TOTAL|SUB-TOTAL|SUBTOTAL|GRAND TOTAL|DATE|SIGNATURE|DIRECTOR|STAMP)\b", joined, re.I
    ):
        return None
    if re.search(
        r"\b(?:APPLICATION|COMPANY|ADRESS|ADDRESS|PHONE|VILLAGE|FACTORY|CIB FILE|QIP)\b", joined, re.I
    ):
        return None

    first = non_empty[0]
    roman_match = re.match(r"^(I|II|III|IV|V|VI|VII|VIII|IX|X)\b[\s.:：-]*(.*)", first, re.I)
    if roman_match:
        rest = roman_match.group(2).strip()
        if not rest and len(non_empty) > 1:
            rest = non_empty[1].strip()
        if rest:
            return format_category_title(rest)

    for kw, title in [
        (r"MACHIN", "Machinery & Equipment"),
        (r"RAW MATERIAL|ACCESSOR|FABRIC", "Raw Materials & Accessories"),
        (r"PACKAG", "Packaging Materials"),
        (r"SPARE PART", "Spare Parts"),
        (r"CONSTRUCTION", "Construction Materials"),
    ]:
        if re.search(kw, joined, re.I):
            return title
    return None


def classify_item_description(desc: str | None) -> str:
    if not desc:
        return "General"
    upper = desc.upper()
    if re.search(
        r"\b(?:MACHINE|CUTTER|SPREADER|IRON|BOILER|GENERATOR|MOTOR|COMPRESSOR|TABLE|PRINTER|SCANNER|PUMP|DRYER|WASHER|SYSTEM|CHILLER|FUSING|MOULD|PRESS|SEWING|BARTACK|HEMMING|HOLING|INTERLOCK|ATTACHING)\b",
        upper,
    ):
        return "Machinery & Equipment"
    if re.search(
        r"\b(?:FABRIC|COTTON|POLYESTER|YARN|THREAD|LABEL|ZIPPER|BUTTON|ELASTIC|TAPE|INTERLINING|LINING|POLYBAG|CARTON|HANGTAG|BOX|HANGER|PIN|RIVET|HOOK|BADGE|RIBBON|WEBBING|FOAM|VELCRO|BUCKLE|SNAP|GLOVE|MATERIAL|ACCESSORY|ACCESSORIES)\b",
        upper,
    ):
        return "Raw Materials & Accessories"
    return "General"


def detect_categories_for_rows(rows: list, sheet: str) -> dict[int, str]:
    initial_cat = None
    for kw, title in [
        (r"MACHIN", "Machinery & Equipment"),
        (r"RAW MATERIAL|ACCESSOR", "Raw Materials & Accessories"),
        (r"PACKAG", "Packaging Materials"),
        (r"SPARE", "Spare Parts"),
    ]:
        if re.search(kw, sheet, re.I):
            initial_cat = title
            break
    current_cat = initial_cat
    row_cats: dict[int, str] = {}
    for number, cells in rows:
        cat = detect_category_header(cells)
        if cat:
            current_cat = cat
        if current_cat:
            row_cats[number] = current_cat
    return row_cats


def parse_master(data: bytes, name: str, source: UUID) -> MasterData:
    master, _ = parse_master_with_headers(data, name, source)
    return master


def parse_master_with_headers(data: bytes, name: str, source: UUID):
    guarded_workbook(data, name)
    meta, parsed = extract_cdc(data, name)
    if not parsed:
        raise ValueError("Unsupported CDC Master List layout")
    sheet = meta["sheet"]
    workbook = dict(rows_from_workbook(data, name))
    rows = workbook[sheet]
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
    code_col = col(r"(?:material|item|product)\s*(?:code|no|number)|物料编码")
    hs_col = col(r"h\.?s\.?[ -]*code|税号")
    spec_col = col(r"specification|规格")
    if unit_col is None or qty_col is None:
        raise ValueError("CDC unit and approved quantity columns are required")

    indexed = dict(rows)
    row_cats = detect_categories_for_rows(rows, sheet)
    items = []
    found_categories: list[str] = []
    for item in parsed:
        number = item["row"]
        cells = indexed[number]
        name_value = clean(at(cells, desc_col))
        unit_value = unit(clean(at(cells, unit_col)))
        if not name_value or not unit_value:
            continue

        item_cat = row_cats.get(number) or classify_item_description(name_value)
        if item_cat and item_cat not in found_categories:
            found_categories.append(item_cat)

        def number_at(column, *, units=None, money=False):
            code = currency(headers.get(column, "")) if money else None
            return numeric_cell(source, sheet, number, cells, column, units=units, code=code)

        def text_at(column):
            raw = clean(at(cells, column)) if column is not None else None
            return field(raw or None, *([cell_evidence(source, sheet, number, column, raw)] if raw else []))

        items.append(
            MasterItem(
                row=number,
                serial=clean(item.get("serial"))[:80] or None,
                item_code=text_at(code_col),
                hs_code=text_at(hs_col),
                specification=text_at(spec_col),
                category=item_cat,
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
    # Read metadata before the first item. Cover sheets can contain the approval header.
    header_rows = {
        title: [row for row in entries[:12] if title != sheet or row[0] < parsed[0]["row"]]
        for title, entries in workbook.items()
    }
    approval_ref = clean(meta.get("qip"))
    if not approval_ref:
        cib_references = {
            approval_key(match[0]): match[0]
            for entries in header_rows.values()
            for _, cells in entries
            for cell in cells
            if (match := document_reference(clean(cell)))
            and match["kind"].upper() == "CIB"
            and match["label"]
        }
        if len(cib_references) == 1:
            approval_ref = next(iter(cib_references.values()))
    master = MasterData(
        company=clean(meta.get("company")),
        approval_ref=approval_ref,
        layout=layout,
        categories=found_categories,
        items=items,
    )
    return master, header_rows


def ranked_descriptions(item, rows, *, proposed=False):
    labels = descriptions(item)
    field = item.fields.get("description")
    translation = field.english if field else None
    if proposed and translation and translation.status == "proposed" and translation.value:
        labels.add(translation.value)
    def score(row):
        similarity = max((candidate_score(label, row.description.value) for label in labels), default=0)
        code = usable(item.fields.get("item_code"))
        if code and source_identity(code) == source_identity(usable(row.item_code)):
            return 100
        hs = usable(item.fields.get("hs_code"))
        if hs and usable(row.hs_code):
            similarity = min(99, similarity + 5) if hs == row.hs_code.value else max(0, similarity - 25)
        return similarity

    return sorted(
        (
            (score(row), row)
            for row in rows
        ),
        key=lambda pair: (-pair[0], pair[1].row),
    )


def candidates_for(invoice, item, ranked):
    def checks(row):
        result = []
        for name, value in (("unit", row.unit), ("unit_price", row.unit_price), ("hs_code", row.hs_code), ("specification", row.specification)):
            if usable(value):
                check = compare("cdc", name, item.fields.get(name), value, required=True, suffix=f".{item.row}.{row.row}")
                if check:
                    result.append(check)
        return result

    return [
        Candidate(
            invoice_document_id=invoice.document_id,
            invoice_row=item.row,
            master_row=row.row,
            description=row.description.value,
            score=score,
            evidence=row.description.evidence[0],
            serial=row.serial,
            reasons=[
                "Exact material code" if usable(item.fields.get("item_code")) and source_identity(usable(item.fields.get("item_code"))) == source_identity(usable(row.item_code)) else "Description similarity; verify material specifications",
            ],
            checks=checks(row),
            unit=usable(row.unit),
            remaining_quantity=usable(row.remaining_quantity),
            unit_price=usable(row.unit_price),
            currency=row.unit_price.currency,
        )
        for score, row in ranked[:3]
        if score >= 40 and usable(row.description) and row.description.evidence
    ]


def description_suggestions(invoice, master):
    """Search the chosen CDC workbook using English proposals as search text only."""
    rows = [MasterItem.model_validate(item) for item in master.items]
    return [
        candidate
        for item in invoice.items
        for candidate in candidates_for(invoice, item, ranked_descriptions(item, rows, proposed=True))
    ]


def matches_master_company(invoice, master):
    printed = invoice.fields.get("consignee") if invoice else None
    consignee = usable(printed)
    alias = printed.english if printed else None
    if master and consignee and alias and alias.status == "verified_company_alias" and alias.company_id and alias.company_id == getattr(master, "company_id", None):
        return True
    if not (master and consignee):
        return False
    ck_c = company_key(consignee)
    ck_m = master.company_key
    si_c = source_identity(consignee)
    si_m = source_identity(master.company)
    return bool(
        (ck_c == ck_m or ck_m in ck_c or ck_c in ck_m or ck_c.startswith(ck_m))
        and (si_c == si_m or si_m in si_c or si_c in si_m or si_c.startswith(si_m))
    )


def check_cdc(invoice: Extraction | None, master, today: date | None = None, *, selections=None):
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
    if not matches_master_company(invoice, master):
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

    printed_date = usable(invoice.fields.get("invoice_date"))
    if printed_date and printed_date[:4] != str(master.year):
        return [finding(group, "year", "MISMATCH", "The invoice year differs from the selected CDC approval year.", invoice.fields.get("invoice_date"))], []

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
        ranked = ranked_descriptions(item, rows)
        candidates.extend(candidates_for(invoice, item, ranked))

        a = item.fields
        prefix = f"cdc.row.{item.row}"
        chosen = next((row for row in rows if selections and selections.get(item.row) == row.row), None)
        if chosen is None and (not ranked or ranked[0][0] < 60):
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
        score, row = (100, chosen) if chosen else ranked[0]
        if chosen is None and len(ranked) > 1 and score - ranked[1][0] < 8:
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
                "PASS" if chosen else "NEEDS_REVIEW",
                "Staff selected this material identity. Quantity, unit and price checks remain separate."
                if chosen else "A candidate is available. Staff must confirm the item, specifications and eligibility.",
                a.get("description"),
                row.description,
                key=f"{prefix}.candidate",
            )
        )
        for name, value in (("hs_code", row.hs_code), ("specification", row.specification)):
            if usable(value):
                result.append(compare(group, name, a.get(name), value, required=True, suffix=f".{item.row}"))
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
                        "Remaining quantity is unknown: absent, uncertain or not dated within 30 days.",
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
                        "Remaining quantity is unknown: absent, uncertain or not dated within 30 days.",
                        qty,
                        limit,
                        key=f"{prefix}.balance_unknown",
                    )
                )
                continue
            if ceiling is None:
                result.append(finding(group, name, "NEEDS_REVIEW", "The approved quantity is missing or uncertain.", qty, limit, key=f"{prefix}.{name}"))
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
                approved = decimal(usable(row.approved_quantity))
                if (
                    name == "remaining_quantity"
                    and approved is not None
                    and approved > 0
                    and Decimal(0) <= ceiling - total < approved * Decimal("0.15")
                ):
                    result.append(
                        finding(
                            group,
                            "low_quota",
                            "WARNING",
                            "The remaining quantity would be below 15% of the approved quantity if this candidate were used.",
                            qty,
                            limit,
                            key=f"{prefix}.low_quota",
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
