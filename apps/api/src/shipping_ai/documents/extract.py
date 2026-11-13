"""Conservative source adapters around the unchanged CDC matcher services."""

import io
import re
from collections.abc import Callable
from datetime import date, datetime
from pathlib import Path
from uuid import UUID
from zipfile import ZipFile

import pymupdf
import xlrd
from defusedxml.ElementTree import iterparse
from openpyxl.utils import get_column_letter
from services.bill_extractor import extract_bill
from services.extraction import extract_shipping, rows_from_workbook
from services.packing import extract_packing

from shipping_ai.review.schemas import Evidence, Extraction, Item, Role
from shipping_ai.review.values import UNIT_ALIASES, clean, currency, decimal, field, folded, unit

MAX_ROWS = 5000
MAX_COLS = 100
MAX_SHEETS = 12
MAX_ITEMS = 200
MAX_PAGES = 12
MAX_OCR_PAGES = 3

WEIGHT = re.compile(
    r"(?<![a-z])(?:kilograms?|kgs?|kg|lbs?|tonnes?|g(?!\.)|t)(?![a-z])|公斤|千克|吨", re.I
)
IDENTIFIER = re.compile(r"\b[A-Z]{4}\s?\d{7}\b", re.I)
BILL_MARKER = re.compile(r"bill of lading|\bwaybill\b|\bB\s*/\s*L\b|提单", re.I)
ROUTE_MODE = re.compile(
    r"\b(?:by (?:sea|air|truck|road)|ocean vessel|sea freight|air freight|truck waybill)\b", re.I
)
INVOICE_LABEL = re.compile(r"^(?:inv(?:oice)?\s*(?:no\.?|number)|发票号|發票號)\s*[:：]?", re.I)
PACKING_REF = re.compile(r"^(?:contract\s*no\.?|合同号)\s*[:：]?", re.I)
META_LABELS = {
    "invoice_no": INVOICE_LABEL,
    "contract_no": PACKING_REF,
    "bl_no": re.compile(
        r"^(?:b/?l\s*(?:no\.?|number)|bill of lading\s*(?:no\.?|number)|提单号码)\s*[:：]?", re.I
    ),
    "invoice_date": re.compile(r"^(?:invoice date|date of invoice|date\s*[:：]|发票日期)", re.I),
    "supplier": re.compile(r"^(?:supplier|seller|exporter|供应商)\s*[:：]?\s*$", re.I),
    "shipper": re.compile(r"^(?:shipper|发货人)\s*[:：]?\s*$", re.I),
    "consignee": re.compile(
        r"^(?:consignee|to\s*:\s*messers|ship to|sold to|收货人)\s*[:：]?\s*$", re.I
    ),
    "notify_party": re.compile(r"^(?:notify party|通知方)\s*[:：]?\s*$", re.I),
    "origin": re.compile(r"^(?:from|port of loading|起运港|装船口岸)\s*[:：]?\s*$", re.I),
    "destination": re.compile(
        r"^(?:destination|port of discharge|目的港|目的地)\s*[:：]?\s*$", re.I
    ),
    "container": re.compile(r"^(?:container(?:\s*(?:no\.?|number))?|集装箱号)\s*[:：]?\s*$", re.I),
    "seal": re.compile(r"^(?:seal(?:\s*(?:no\.?|number))?|封条号)\s*[:：]?\s*$", re.I),
    "booking_no": re.compile(r"^(?:booking(?:\s*(?:no\.?|number))|订舱号)\s*[:：]?\s*$", re.I),
    "vessel": re.compile(r"^(?:vessel|船名)\s*[:：]?\s*$", re.I),
    "voyage": re.compile(r"^(?:voyage(?:\s*no\.?)?|航次)\s*[:：]?\s*$", re.I),
    "etd": re.compile(r"^(?:etd|estimated departure|预计离港)\s*[:：]?\s*$", re.I),
    "eta": re.compile(r"^(?:eta|estimated arrival|预计到港)\s*[:：]?\s*$", re.I),
}
TOTAL_FIELDS = ("packages", "gross_weight", "net_weight")
ROW_FIELDS = (
    "description",
    "english_description",
    "hs_code",
    "quantity",
    "unit",
    "unit_price",
    "amount",
    "packages",
    "gross_weight",
    "net_weight",
)
TOTAL_MARKER = re.compile(
    r"^(?:total|ttl\.?|grand total|合计|总计)(?:\s*[:：]?\s*$|\s*[:：])", re.I
)
ROLE_MARKERS = {
    "invoice": re.compile(r"\b(?:invoice|inv|commercial invoice|ci)\b|发票", re.I),
    "packing_list": re.compile(r"packing|^pl\.?$|装箱单", re.I),
}
Row = tuple[int, list]


class ProcessingLimit(ValueError):
    pass


def guarded_workbook(data: bytes, name: str) -> None:
    if name.lower().endswith(".xls"):
        book = xlrd.open_workbook(file_contents=data, on_demand=True)
        try:
            if book.nsheets > MAX_SHEETS:
                raise ProcessingLimit("workbook_limit")
            for sheet in book.sheets():
                if sheet.nrows > MAX_ROWS or sheet.ncols > MAX_COLS:
                    raise ProcessingLimit("workbook_limit")
        finally:
            book.release_resources()
        return

    with ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        sheets = [e for e in entries if re.fullmatch(r"xl/worksheets/[^/]+\.xml", e.filename)]
        if (
            len(entries) > 500
            or sum(e.file_size for e in entries) > 24 * 1024**2
            or len(sheets) > MAX_SHEETS
        ):
            raise ProcessingLimit("workbook_limit")
        for sheet in sheets:
            with archive.open(sheet) as xml:
                for _, element in iterparse(xml, events=("end",)):
                    tag = element.tag.rsplit("}", 1)[-1]
                    if tag == "dimension":
                        coord = element.get("ref", "").split(":")[-1]
                    elif tag == "row":
                        coord = "A" + element.get("r", "1")
                    elif tag == "c":
                        coord = element.get("r", "")
                    else:
                        coord = ""
                    if coord:
                        match = re.fullmatch(r"([A-Z]{1,3})([0-9]{1,8})", coord)
                        if not match:
                            raise ProcessingLimit("workbook_limit")
                        letters, row = match.groups()
                        column = 0
                        for letter in letters:
                            column = column * 26 + ord(letter) - 64
                        if column > MAX_COLS or int(row) > MAX_ROWS:
                            raise ProcessingLimit("workbook_limit")
                    element.clear()


def at(cells: list, column: int | None) -> object:
    return cells[column] if column is not None and column < len(cells) else None


def cell_evidence(doc: UUID, sheet: str, row: int, column: int, value: object) -> Evidence:
    return Evidence(
        document_id=doc,
        sheet=sheet,
        row=row,
        cell=f"{get_column_letter(column + 1)}{row}",
        raw=clean(value)[:350] or None,
    )


def row_evidence(doc: UUID, sheet: str, row: int, cells: list) -> Evidence:
    return Evidence(
        document_id=doc,
        sheet=sheet,
        row=row,
        raw=" | ".join(clean(value) for value in cells if clean(value))[:350] or None,
    )


def column_map(headers: list[str]) -> dict[str, int]:
    tests: dict[str, Callable[[str], bool]] = {
        "description": lambda h: (
            bool(re.search(r"description|commodity|commodities|品名|货品名称|货名", h))
            and not re.search(r"english|英文", h)
        ),
        "english_description": lambda h: bool(re.search(r"english|英文", h)),
        "hs_code": lambda h: bool(re.search(r"h\.?s\.?[ -]*code|税号", h)),
        "quantity": lambda h: bool(re.search(r"quantity|^qty\b|数量", h)),
        "unit": lambda h: (
            bool(re.search(r"^unit(?:\b|$)|单位|^uom\b", h))
            and not re.search(r"price|value|单价|价格", h)
        ),
        "unit_price": lambda h: bool(re.search(r"unit\s*price|^price\b|单价|u\.price", h)),
        "amount": lambda h: (
            bool(re.search(r"subtotal|amount|total\s*(?:price|value)|总价|总值|金额", h))
            and not re.search(r"unit\s*price|balance", h)
        ),
        "packages": lambda h: bool(re.search(r"^packages?\b|^cartons?\b|包数|件数", h)),
        "gross_weight": lambda h: bool(re.search(r"gross\s*weight|\bg\.?w\b|毛重", h)),
        "net_weight": lambda h: bool(re.search(r"net\s*weight|\bn\.?w\b|净重", h)),
    }
    return {
        key: col
        for key, matches in tests.items()
        if (col := next((i for i, header in enumerate(headers) if matches(header)), None))
        is not None
    }


def headers_for(rows: list[Row], before: int) -> tuple[dict[str, int], list[str], int]:
    # Two header tiers are common. Limit the search to rows before the first legacy item.
    best: tuple[dict[str, int], list[str], int] = ({}, [], 0)
    for pos, (number, first) in enumerate(rows[:40]):
        if number >= before:
            break
        first_headers = [folded(clean(value)) for value in first]
        choices = [(number, first_headers)]
        if pos + 1 < len(rows) and rows[pos + 1][0] < before:
            second = rows[pos + 1][1]
            combined = [
                " ".join(filter(None, (folded(clean(at(first, i))), folded(clean(at(second, i))))))
                for i in range(max(len(first), len(second)))
            ]
            choices.append((number + 1, combined))
        for end, headers in choices:
            columns = column_map(headers)
            if "description" not in columns or not (
                {"quantity", "gross_weight", "packages"} & columns.keys()
            ):
                continue
            if len(columns) > len(best[0]) or (len(columns) == len(best[0]) and end > best[2]):
                best = columns, headers, end
    return best


def labelled(
    rows: list[Row], doc: UUID, sheet: str, pattern: re.Pattern
) -> tuple[object, Evidence] | None:
    for number, cells in rows[:35]:
        for col, value in enumerate(cells):
            raw = clean(value)
            match = pattern.match(raw)
            if not match:
                continue
            tail = raw[match.end() :].lstrip(":： ")
            if tail:
                return tail, cell_evidence(doc, sheet, number, col, value)
            for nxt in range(col + 1, min(len(cells), col + 5)):
                if clean(cells[nxt]):
                    return cells[nxt], cell_evidence(doc, sheet, number, nxt, cells[nxt])
    return None


def anchored(rows: list[Row], doc: UUID, sheet: str, value: object) -> Evidence | None:
    expected = folded(clean(value))
    if not expected:
        return None
    for number, cells in rows[:35]:
        for col, cell in enumerate(cells):
            if expected in {folded(line) for line in clean(cell).splitlines()}:
                return cell_evidence(doc, sheet, number, col, cell)
    return None


def date_text(value: object) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    match = re.fullmatch(r"(20\d{2})[-./](\d{1,2})[-./](\d{1,2})(?:\s+00:00:00)?", clean(value))
    if match:
        try:
            return date(*map(int, match.groups())).isoformat()
        except ValueError:
            pass
    return None


def metadata(doc: UUID, sheet: str, rows: list[Row], legacy: dict, role: Role) -> dict:
    keys = [
        "supplier",
        "shipper",
        "consignee",
        "notify_party",
        "origin",
        "destination",
        "container",
        "seal",
        "booking_no",
        "bl_no",
        "vessel",
        "voyage",
        "etd",
        "eta",
    ]
    keys += ["invoice_no", "invoice_date"] if role == "invoice" else ["invoice_no", "contract_no"]
    result = {}
    for key in keys:
        source = labelled(rows, doc, sheet, META_LABELS[key])
        if source:
            raw, evidence = source
            value = date_text(raw) if key in {"invoice_date", "etd", "eta"} else clean(raw)[:350]
            result[key] = field(value or None, evidence, uncertain=not value)
        elif key in {"supplier", "consignee", "invoice_no", "invoice_date", "contract_no"} and (
            evidence := anchored(rows, doc, sheet, legacy.get(key))
        ):
            value = clean(legacy[key])[:350]
            result[key] = field(value or None, evidence)
        else:
            result[key] = field(None)
    for number, cells in rows[:35]:
        mode = next(
            (
                (col, ROUTE_MODE.search(clean(value)))
                for col, value in enumerate(cells)
                if ROUTE_MODE.search(clean(value))
            ),
            None,
        )
        if mode:
            col, match = mode
            word = match.group().lower()
            value = (
                "BY AIR"
                if "air" in word
                else "BY TRUCK"
                if "truck" in word or "road" in word
                else "BY SEA"
            )
            result["shipping_mode"] = field(
                value, cell_evidence(doc, sheet, number, col, cells[col])
            )
            break
    result.setdefault("shipping_mode", field(None))
    return result


def numeric_cell(doc, sheet, number, cells, column, *, units=None, code=None):
    raw = at(cells, column)
    amount = decimal(raw)
    if column is None:
        return field(None)
    evidence = cell_evidence(doc, sheet, number, column, raw)
    if amount is None:
        return field(None, evidence, uncertain=bool(clean(raw)))
    if amount < 0:
        return field(str(amount), evidence, unit=units, currency=code, uncertain=True)
    return field(str(amount), evidence, unit=units, currency=code)


def excel_items(doc, sheet, rows, parsed, columns, headers, end):
    parsed_rows = {item["row"]: item for item in parsed}
    if not columns:
        # Preserve candidate descriptions at the legacy row while withholding ambiguous dimensions.
        return [
            Item(
                row=number,
                fields={
                    **{key: field(None) for key in ROW_FIELDS},
                    "description": field(
                        clean(parsed_rows[number].get("chinese"))[:350] or None,
                        row_evidence(doc, sheet, number, cells),
                        uncertain=True,
                    ),
                },
            )
            for number, cells in rows
            if number in parsed_rows
        ][:MAX_ITEMS]

    results = []
    seen_item = False
    first_legacy_row = min(parsed_rows, default=0)
    last_legacy_row = max(parsed_rows, default=0)
    for number, cells in rows:
        if number <= end:
            continue
        if seen_item and any(TOTAL_MARKER.match(clean(value)) for value in cells):
            break
        desc = clean(at(cells, columns.get("description")))
        qty = decimal(at(cells, columns.get("quantity")))
        if number not in parsed_rows:
            if not desc and seen_item and qty is not None:
                break
            if not desc or desc.startswith(("=", "—")):
                continue
            # Keep missing-quantity item rows in the legacy item span. Avoid
            # treating signature/footer text after the parsed rows as cargo.
            if qty is None and not first_legacy_row <= number <= last_legacy_row:
                continue
        if not desc and number not in parsed_rows:
            continue
        seen_item = True
        values = {}
        for key in ("description", "english_description", "hs_code", "unit"):
            col = columns.get(key)
            if key == "english_description" and col is None and "quantity" in columns:
                possible = columns["description"] + 1
                if possible < columns["quantity"] and not headers[possible]:
                    sample = clean(at(cells, possible))
                    if re.search(r"[A-Za-z]{2}", sample):
                        col = possible
            if key == "unit" and col is None and "quantity" in columns:
                possible = columns["quantity"] + 1
                if (
                    possible < len(headers)
                    and not headers[possible]
                    and folded(clean(at(cells, possible))) in UNIT_ALIASES
                ):
                    col = possible
            raw = clean(at(cells, col))
            normalized = unit(raw) if key == "unit" else raw[:350] or None
            if (
                key == "hs_code"
                and isinstance(at(cells, col), float)
                and at(cells, col).is_integer()
            ):
                normalized = str(int(at(cells, col)))
            values[key] = (
                field(normalized, cell_evidence(doc, sheet, number, col, raw))
                if col is not None
                else field(None)
            )
        for key in ("quantity", "unit_price", "amount", *TOTAL_FIELDS):
            col = columns.get(key)
            heading = headers[col] if col is not None else ""
            if key == "quantity":
                dimension = values["unit"].value or header_unit(heading)
                if dimension and values["unit"].value is None:
                    values["unit"] = field(dimension, cell_evidence(doc, sheet, end, col, heading))
            elif key in {"gross_weight", "net_weight"}:
                dimension = weight_unit(heading)
            elif key == "packages":
                dimension = "PKG"
            else:
                dimension = values["unit"].value if key == "unit_price" else None
            code = currency(heading) if key in {"unit_price", "amount"} else None
            values[key] = numeric_cell(doc, sheet, number, cells, col, units=dimension, code=code)
        results.append(Item(row=number, fields=values))
        if len(results) > MAX_ITEMS:
            raise ProcessingLimit("item_limit")
    return results


def header_unit(text: str) -> str | None:
    match = re.search(r"[（(]([^）)]+)[）)]", text)
    return unit(match.group(1)) if match else None


def weight_unit(text: str) -> str | None:
    match = WEIGHT.search(re.sub(r"\b[gn]\.?w\b\.?", "", text, flags=re.I))
    return unit(match.group()) if match else None


def totals(doc, sheet, rows, items, columns, headers):
    result = {key: field(None) for key in (*TOTAL_FIELDS, "amount")}
    if not items:
        return result
    total_row = next(
        (
            (number, cells)
            for number, cells in rows
            if number > items[-1].row and any(TOTAL_MARKER.match(clean(value)) for value in cells)
        ),
        None,
    )
    for key in result:
        col = columns.get(key)
        if col is None:
            continue
        if total_row:
            number, cells = total_row
            sample = items[0].fields[key]
            printed = numeric_cell(
                doc, sheet, number, cells, col, units=sample.unit, code=sample.currency
            )
            if printed.value is not None or printed.status == "uncertain":
                result[key] = printed
                continue
        # Never sum incomplete data or mix dimensions. The operands remain visible at their cells.
        parts = [item.fields[key] for item in items]
        labels = {(part.unit, part.currency) for part in parts}
        if (
            all(part.status == "present" and part.value is not None for part in parts)
            and len(labels) == 1
        ):
            units, code = next(iter(labels))
            if units or code:
                value = sum(decimal(part.value) for part in parts)
                result[key] = field(
                    str(value),
                    *(e for part in parts for e in part.evidence),
                    unit=units,
                    currency=code,
                )
    return result


def workbook_role(data, name, doc, workbook, role: Role, classification: str):
    parser = extract_shipping if role == "invoice" else extract_packing
    legacy, parsed = parser(data, name)
    likely = [
        sheet
        for sheet, rows in workbook.items()
        if ROLE_MARKERS[role].search(sheet)
        or any(
            ROLE_MARKERS[role].search(clean(value))
            for _, cells in rows[:8]
            for value in cells
            if clean(value).strip().casefold()
            in {
                "invoice",
                "commercial invoice",
                "packing list",
                "商业发票",
                "装箱单",
            }
        )
    ]
    sheet = legacy.get("sheet")
    if sheet and sheet not in likely and classification != role:
        return None
    if not sheet:
        if not likely and classification != role:
            return None
        sheet = likely[0] if likely else next(iter(workbook), None)
    if sheet is None:
        return None
    rows = workbook[sheet]
    relevant = [item for item in parsed if item["sheet"] == sheet]
    before = min((item["row"] for item in relevant), default=min(len(rows) + 1, 36))
    columns, headers, end = headers_for(rows, before)
    if columns.get("quantity") == columns.get("description"):
        columns.pop("quantity", None)
    # The known merged supplier invoice puts quantity and unit in E/F and
    # unit price and amount in H/J under the combined heading. Require the
    # bilingual header plus multiple legacy rows with that exact shape.
    merged = role == "invoice" and any(
        "数量与货品名称" in clean(at(cells, 2)) and "总值" in clean(at(cells, 8))
        for _, cells in rows[: before - 1]
    )
    sample = [cells for n, cells in rows if n in {item["row"] for item in relevant[:4]}]
    if (
        merged
        and len(sample) >= 2
        and all(
            decimal(at(cells, 4)) is not None
            and folded(clean(at(cells, 5))) in UNIT_ALIASES
            and decimal(at(cells, 7)) is not None
            and decimal(at(cells, 9)) is not None
            for cells in sample
        )
    ):
        columns.update(description=2, quantity=4, unit=5, unit_price=7, amount=9)
        headers = (headers + [""] * 10)[: max(len(headers), 10)]
        code = next(
            (
                currency(clean(value))
                for _, cells in rows[: before - 1]
                for value in cells
                if re.fullmatch(r"(?:USD|CNY|RMB|KHR|EUR)", clean(value), re.I)
            ),
            None,
        )
        headers[7] = headers[9] = code or ""
    items = excel_items(doc, sheet, rows, relevant, columns, headers, end)
    fields = metadata(doc, sheet, rows, legacy, role)
    fields.update(totals(doc, sheet, rows, items, columns, headers))
    missing_core = not items or any(
        item.fields[key].status != "present"
        for item in items
        for key in ("description", "quantity")
    )
    missing_core |= role == "invoice" and fields["invoice_no"].status != "present"
    status = (
        "unsupported_layout"
        if not columns or not items
        else "partial"
        if missing_core
        else "extracted"
    )
    return Extraction(
        document_id=doc,
        role=role,
        status=status,
        method=parser.__name__,
        sheet=sheet,
        fields=fields,
        items=items,
        source_excerpt=[
            row_evidence(doc, sheet, number, cells)
            for number, cells in rows[:35]
            if any(clean(c) for c in cells)
        ],
    )


def bill_lines(pdf):
    return [
        Evidence(document_id=UUID(int=0), page=index, line=number, raw=clean(text)[:350])
        for index, page in enumerate(pdf, 1)
        for number, text in enumerate(page.get_text().splitlines(), 1)
        if clean(text)
    ]


def extract_pdf(data: bytes, name: str, doc: UUID, classification: str):
    with pymupdf.open(stream=data, filetype="pdf") as pdf:
        if pdf.needs_pass:
            raise ProcessingLimit("encrypted_pdf")
        if not 1 <= pdf.page_count <= MAX_PAGES or any(
            page.rect.width > 1800 or page.rect.height > 1800 for page in pdf
        ):
            raise ProcessingLimit("pdf_limit")
        lines = [item.model_copy(update={"document_id": doc}) for item in bill_lines(pdf)]
        if sum(len(line.raw or "") for line in lines) < 50 and pdf.page_count > MAX_OCR_PAGES:
            raise ProcessingLimit("ocr_page_limit")

    raw = extract_bill(data, name)
    text = clean(raw.get("raw_text"))
    if not text:
        return Extraction(
            document_id=doc,
            role="draft_bl",
            status="failed",
            method="extract_bill",
            error="unreadable_pdf",
        )
    used_ocr = raw.get("ocr_used", False)
    if used_ocr:
        # The legacy OCR result is flattened. Avoid inventing an OCR page number.
        lines = [
            Evidence(document_id=doc, line=i, raw=clean(value)[:350])
            for i, value in enumerate(text.splitlines(), 1)
            if clean(value)
        ]
    if classification != "draft_bl" and not BILL_MARKER.search(text):
        return Extraction(
            document_id=doc,
            role="other",
            status="unsupported_layout",
            method="extract_bill",
            error="unrecognized_pdf",
            source_excerpt=lines[:45],
        )

    def locate(value):
        expected = folded(clean(value))
        if not expected:
            return None
        for line in lines:
            raw_line = line.raw or ""
            if expected in folded(raw_line):
                return line
        return None

    fields = {}
    for key in (
        "bl_no",
        "issue_date",
        "shipper",
        "consignee",
        "carrier",
        "vessel",
        "voyage",
        "container",
        "seal",
        "origin",
        "destination",
    ):
        value = clean(raw.get(key))[:350]
        if key == "container" and not IDENTIFIER.fullmatch(value):
            value = ""
        original = clean(raw.get("raw_date")) if key == "issue_date" else value
        evidence = locate(original)
        if key in {"origin", "destination"} and evidence:
            context = " ".join(
                line.raw or ""
                for line in lines
                if line.page == evidence.page and abs((line.line or 0) - (evidence.line or 0)) <= 1
            )
            labels = (
                r"loading|receipt|起运|装船"
                if key == "origin"
                else r"discharge|delivery|destination|目的|卸货"
            )
            if not re.search(labels, context, re.I):
                evidence = None
        if value and evidence:
            uncertain = used_ocr
            if key in {"shipper", "consignee"}:
                pattern = r"shipper|发货人" if key == "shipper" else r"consignee|收货人"
                uncertain |= not any(
                    line.page == evidence.page
                    and 0 <= (evidence.line or 0) - (line.line or 0) <= 2
                    and re.search(pattern, line.raw or "", re.I)
                    for line in lines
                )
            fields[key] = field(value, evidence, uncertain=uncertain)
        else:
            fields[key] = field(None)
    for key in ("notify_party", "booking_no", "etd", "eta"):
        token = {
            "notify_party": "notify party",
            "booking_no": r"booking\s*(?:no\.?|number)",
            "etd": "etd",
            "eta": "eta",
        }[key]
        matches = [
            (line, re.match(rf"^\s*(?:{token})\s*[:：]\s*(.+)$", line.raw or "", re.I))
            for line in lines
        ]
        source = next(((line, match.group(1)) for line, match in matches if match), None)
        fields[key] = field(None)
        if source:
            evidence, value = source
            normalized = date_text(value) if key in {"etd", "eta"} else clean(value)
            fields[key] = field(normalized, evidence, uncertain=used_ocr or not normalized)
    numeric_labels = {
        "packages": r"(?:no\.? of packages|packages?|cartons?|ctns?|pkgs?|件数|包数)",
        "gross_weight": r"(?:gross\s*weight|g\.?w\.?|毛重)",
        "net_weight": r"(?:net\s*weight|n\.?w\.?|净重)",
    }
    for key, label_pattern in numeric_labels.items():
        fields[key] = field(None)
        for line in lines:
            value = line.raw or ""
            # A printed label binds the number to its meaning. A standalone
            # mass without a gross/net label is not sufficient evidence.
            match = re.search(
                rf"{label_pattern}\s*[:：]?\s*([\d,]+(?:\.\d+)?)",
                value,
                re.I,
            )
            if not match and key == "packages":
                match = re.search(rf"(?<![\w.])([\d,]+)\s*{label_pattern}\b", value, re.I)
            if not match:
                continue
            amount = decimal(match.group(1))
            units = "PKG" if key == "packages" else weight_unit(value)
            if amount is not None:
                fields[key] = field(
                    str(amount), line, unit=units, uncertain=used_ocr or units is None
                )
                break
    for key, label_pattern in (
        ("cargo_summary", r"description of goods|cargo description|货物描述"),
        ("container", r"container(?:\s*(?:no\.?|number))?|集装箱号"),
        ("seal", r"seal(?:\s*(?:no\.?|number))?|封条号"),
        ("origin", r"port of loading|起运港"),
        ("destination", r"port of discharge|目的港|卸货港"),
        ("shipper", r"shipper|发货人"),
        ("consignee", r"consignee|收货人"),
        ("vessel", r"vessel|船名"),
        ("voyage", r"voyage(?:\s*no\.?)?|航次"),
    ):
        for line in lines:
            match = re.match(rf"^(?:{label_pattern})\s*[:：]\s*(.+)$", line.raw or "", re.I)
            if match:
                value = clean(match.group(1))
                if key != "container" or IDENTIFIER.fullmatch(value):
                    fields[key] = field(value, line, uncertain=used_ocr)
                break
    mode = ROUTE_MODE.search(text)
    evidence = locate(mode.group()) if mode else None
    fields["shipping_mode"] = (
        field(clean(raw.get("shipping_mode")) or None, evidence, uncertain=used_ocr)
        if evidence
        else field(None)
    )
    cargo = [(clean(value)[:140], locate(value)) for value in raw.get("descriptions", [])[:5]]
    cargo = [(value, evidence) for value, evidence in cargo if value and evidence]
    if "cargo_summary" not in fields:
        fields["cargo_summary"] = field(
            " / ".join(value for value, _ in cargo) or None,
            *(evidence for _, evidence in cargo),
            uncertain=used_ocr and bool(cargo),
        )
    core = all(fields[key].status == "present" for key in ("bl_no", "shipper", "consignee"))
    return Extraction(
        document_id=doc,
        role="draft_bl",
        status="extracted" if core else "partial",
        method="tesseract" if used_ocr else "extract_bill",
        fields=fields,
        source_excerpt=lines[:60],
    )


def extract(data: bytes, name: str, doc: UUID, classification: str) -> list[Extraction]:
    suffix = Path(name).suffix.lower()
    try:
        if suffix == ".pdf":
            return [extract_pdf(data, name, doc, classification)]
        guarded_workbook(data, name)
        workbook = dict(rows_from_workbook(data, name))
        results = [
            result
            for role in ("invoice", "packing_list")
            if (result := workbook_role(data, name, doc, workbook, role, classification))
        ]
        if results:
            return results
        sheet, rows = next(iter(workbook.items()), (None, []))
        return [
            Extraction(
                document_id=doc,
                role="other",
                status="unsupported_layout",
                method="excel",
                sheet=sheet,
                error="unrecognized_workbook",
                source_excerpt=[row_evidence(doc, sheet, n, c) for n, c in rows[:35]],
            )
        ]
    except ProcessingLimit as exc:
        error = str(exc)
    except Exception:
        # Parser diagnostics can contain document contents. Persist a fixed code.
        error = "unreadable_pdf" if suffix == ".pdf" else "unreadable_workbook"
    role = (
        "draft_bl"
        if suffix == ".pdf"
        else classification
        if classification in {"invoice", "packing_list"}
        else "other"
    )
    return [
        Extraction(
            document_id=doc,
            role=role,
            status="failed",
            method="pdf" if suffix == ".pdf" else "excel",
            error=error,
        )
    ]
