"""Conservative source adapters around the unchanged CDC matcher services."""

import io
import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from threading import Lock
from uuid import UUID
from zipfile import ZipFile

import pymupdf
import xlrd
from defusedxml.ElementTree import iterparse
from openpyxl.utils import column_index_from_string, get_column_letter
from services.bill_extractor import extract_bill
from services.extraction import extract_shipping, rows_from_workbook
from services.packing import extract_packing

from shipping_ai.review.schemas import EnglishText, Evidence, Extraction, Item, Role
from shipping_ai.review.values import (
    UNIT_ALIASES,
    clean,
    currency,
    decimal,
    field,
    folded,
    unit,
    year_first_date,
)

from .languages import LABELS as LOCAL_LABELS
from .languages import ROW_FIELDS, column_map, languages, reference_text, spellings
from .pdf_extract import PDFLimit, extract_positioned_pdf
from .text_representation import annotate_languages
from .workbook_layout import TOTAL_TEXT, Region, regions, workbook_merges

PDF_LOCK = Lock()

MAX_ROWS = 5000
MAX_COLS = 100
MAX_SHEETS = 12
MAX_ITEMS = 200
MAX_PAGES = 12
MAX_OCR_PAGES = 3

WEIGHT = re.compile(
    r"(?<![a-z])(?:kilograms?|kgs?|kg|lbs?|tonnes?|g(?!\.)|t)(?![a-z])|公斤|千克|吨|噸|គីឡូក្រាម", re.I
)
IDENTIFIER = re.compile(r"\b[A-Z]{4}\s?[0-9]{6}[ -]?[0-9]\b", re.I)
CONTAINER_VALUE_RE = re.compile(
    r"^(?:[A-Z]{3,4}\s?[0-9]{6,7}[ -]?[0-9]?|\d+\s*[xX*]\s*(?:20|40|45)\s*(?:HC|HQ|GP|OT|FR|RF|RH)|[A-Z]{3,4}\s?[0-9]{6,7}[ -]?[0-9]?\s*/\s*\d+\s*[xX*]\s*(?:20|40|45)\s*(?:HC|HQ|GP|OT|FR|RF|RH))",
    re.I,
)
BILL_MARKER = re.compile(
    r"bill of lading|\bwaybill\b|\bB\s*/\s*L\b|提单|提單|ប័ណ្ណដឹកជញ្ជូន|\btelex release\b|\bsea waybill\b",
    re.I,
)
BILL_LABELS = (
    re.compile(r"(?:\bB\s*/?\s*L|bill of lading)\s*(?:no\.?|number)|提单号", re.I),
    re.compile(r"(?m)^\s*(?:shipper\b|发货人)", re.I),
    re.compile(r"(?m)^\s*(?:consignee\b|收货人)", re.I),
)
ROUTE_MODE = re.compile(
    r"\b(?:by (?:sea|air|truck|road)|ocean vessel|sea freight|air freight|truck waybill)\b", re.I
)
INVOICE_LABEL = re.compile(r"^(?:inv(?:oice)?\s*(?:number|no\.?)(?![\w])|发票号码?|發票號碼?)\s*[:：]?", re.I)
PACKING_REF = re.compile(r"^(?:contract\s*no\.?(?![\w])|合同号码?)\s*[:：]?", re.I)
META_LABELS = {
    "invoice_no": INVOICE_LABEL,
    "contract_no": PACKING_REF,
    "bl_no": re.compile(
        r"^(?:[bt]/?[lb]\s*(?:number|no\.?)|bill of lading\s*(?:number|no\.?)|提单号码?)\s*[:：]?", re.I
    ),
    "invoice_date": re.compile(
        r"^(?:invoice\s*date|date\s+of\s+invoice|date(?=\s*[:：]|$)|发票日期)\s*[:：]?", re.I
    ),
    "supplier": re.compile(r"^(?:supplier|seller|exporter|供应商)\s*[:：]?\s*$", re.I),
    "shipper": re.compile(r"^(?:shipper|发货人)\s*[:：]?\s*$", re.I),
    "consignee": re.compile(
        r"^(?:consignee|to\s*:\s*mess[e]?rs|ship to(?: messrs)?|sold to(?: messrs)?|收货人)(?=\s*[:：]|$)\s*[:：]?", re.I
    ),
    "notify_party": re.compile(r"^(?:notify party|通知方)\s*[:：]?\s*$", re.I),
    "origin": re.compile(r"^(?:from|port of loading|place of loading|起运港|起运地|装船口岸)(?=\s*[:：]|$)\s*[:：]?", re.I),
    "destination": re.compile(
        r"^(?:destination|place of delivery|final destination|port of discharge|目的港|目的地|to)(?=\s*[:：]|$)\s*[:：]?", re.I
    ),
    "port": re.compile(
        r"^(?:port of discharge|place of discharge|discharge port|border checkpoint|port|border|口岸|卸货口岸|卸货港)(?=\s*[:：]|$)\s*[:：]?",
        re.I,
    ),
    "route_legs": re.compile(r"^(?:route|routing|route\s*legs)\s*[:：]?\s*$", re.I),
    "container": re.compile(r"^(?:container(?:\s*(?:no\.?|number))?|集装箱号)\s*[:：]?\s*$", re.I),
    "seal": re.compile(r"^(?:seal(?:\s*(?:no\.?|number))?|封条号)\s*[:：]?\s*$", re.I),
    "booking_no": re.compile(r"^(?:booking(?:\s*(?:no\.?|number))|订舱号)\s*[:：]?\s*$", re.I),
    "vessel": re.compile(r"^(?:vessel|船名)\s*[:：]?\s*$", re.I),
    "voyage": re.compile(r"^(?:voyage(?:\s*no\.?)?|航次)\s*[:：]?\s*$", re.I),
    "etd": re.compile(r"^(?:etd|estimated departure|预计离港)\s*[:：]?\s*$", re.I),
    "eta": re.compile(r"^(?:eta|estimated arrival|预计到港)\s*[:：]?\s*$", re.I),
}
for _key, _english in tuple(META_LABELS.items()):
    _labels = LOCAL_LABELS.get(_key, ())
    if _key == "destination":
        _labels += LOCAL_LABELS["discharge"] + LOCAL_LABELS["delivery"]
    if _key == "port":
        _labels += LOCAL_LABELS["discharge"]
    if _labels:
        META_LABELS[_key] = re.compile(
            rf"^(?:{spellings(*_labels)})(?=\s*[:：/（(]|\s*$)\s*[:：]?|{_english.pattern}",
            re.I,
        )
TOTAL_FIELDS = ("packages", "gross_weight", "net_weight", "measurement")
TOTAL_MARKER = TOTAL_TEXT
ROLE_MARKERS = {
    "invoice": re.compile(r"\b(?:invoice|inv|commercial invoice|ci)\b|发票", re.I),
    "packing_list": re.compile(r"packing|^pl\.?$|装箱单", re.I),
}
Row = tuple[int, list]


class ProcessingLimit(ValueError):
    pass


def guarded_workbook(
    data: bytes, name: str, *, trim_formatting: bool = False
) -> tuple[int, int] | None:
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
        return None

    max_row = max_col = 1
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
            populated_row = None
            with archive.open(sheet) as xml:
                for _, element in iterparse(xml, events=("end",)):
                    tag = element.tag.rsplit("}", 1)[-1]
                    if trim_formatting:
                        if tag == "row" and populated_row is not None:
                            if element.get("r") != str(populated_row):
                                raise ProcessingLimit("unsupported_cell_coordinates")
                            populated_row = None
                        has_data = tag == "c" and any(
                            child.tag.rsplit("}", 1)[-1] in {"v", "f", "is"} for child in element
                        )
                        coord = element.get("r", "") if has_data else ""
                        if has_data and not coord:
                            raise ProcessingLimit("unsupported_cell_coordinates")
                    elif tag == "dimension":
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
                        row_number = int(row)
                        if column > MAX_COLS or not 1 <= row_number <= MAX_ROWS:
                            raise ProcessingLimit("workbook_limit")
                        if trim_formatting:
                            if populated_row is not None and populated_row != row_number:
                                raise ProcessingLimit("unsupported_cell_coordinates")
                            populated_row = row_number
                        max_row = max(max_row, row_number)
                        max_col = max(max_col, column)
                    # Keep cell children until their parent has been inspected for content.
                    if not trim_formatting or tag in {"c", "row"}:
                        element.clear()
    return (max_row, max_col) if trim_formatting else None


def read_supplier_workbook(data: bytes, name: str) -> dict[str, list[Row]]:
    bounds = guarded_workbook(data, name, trim_formatting=True)
    return dict(rows_from_workbook(data, name, bounds=bounds))


def at(cells: list, column: int | None) -> object:
    return cells[column] if column is not None and column < len(cells) else None


def cell_evidence(doc: UUID, sheet: str, row: int, column: int, value: object) -> Evidence:
    return Evidence(
        document_id=doc,
        sheet=sheet,
        row=row,
        cell=f"{get_column_letter(column + 1)}{row}",
        raw=clean(value)[:350] or None,
        method="workbook",
    )


def row_evidence(doc: UUID, sheet: str, row: int, cells: list) -> Evidence:
    return Evidence(
        document_id=doc,
        sheet=sheet,
        row=row,
        raw=" | ".join(clean(value) for value in cells if clean(value))[:350] or None,
    )


def headers_for(rows: list[Row], before: int) -> tuple[dict[str, int], list[str], int]:
    # Two header tiers are common. Limit the search to rows before the first legacy item.
    best: tuple[dict[str, int], list[str], int] = ({}, [], 0)
    for pos, (number, first) in enumerate(rows[:40]):
        if number >= before:
            break
        first_headers = [folded(clean(value)) for value in first]
        choices = [(number, first_headers)]
        if pos + 1 < len(rows) and rows[pos + 1][0] < before and heading_row(rows[pos + 1][1]):
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


def heading_row(cells):
    values = [folded(clean(value)) for value in cells if clean(value)]
    return bool(values) and not any(decimal(value) is not None for value in values) and (
        bool(column_map(values)) or all(
            value in UNIT_ALIASES or currency(value) or weight_unit(value)
            or re.fullmatch(r"cbm|m3", value, re.I)
            for value in values
        )
    )


def is_any_meta_label(text: str) -> bool:
    # Bilingual routing labels can share one cell with a newline or slash.
    parts = [value.strip() for value in re.split(r"[\n/]", text) if value.strip()]
    if len(parts) > 1 and all(
        any(pattern.fullmatch(part) for pattern in META_LABELS.values()) for part in parts
    ):
        return True
    for p in META_LABELS.values():
        if p.match(text):
            return True
    return False


def labelled(
    rows: list[Row], doc: UUID, sheet: str, pattern: re.Pattern, *, accept=bool
) -> tuple[object, Evidence] | None:
    for idx, (number, cells) in enumerate(rows[:35]):
        for col, value in enumerate(cells):
            raw = clean(value)
            match = pattern.match(raw)
            if not match:
                continue
            tail = raw[match.end():].lstrip(":：/(（ \n\t")
            for _ in range(2):
                duplicate = pattern.match(tail)
                if not duplicate:
                    break
                tail = tail[duplicate.end():].lstrip(":：/)） \n\t")
            if tail and not is_any_meta_label(tail) and accept(tail):
                return tail, cell_evidence(doc, sheet, number, col, value)
            # 1. Search horizontally in current row
            for nxt in range(col + 1, min(len(cells), col + 5)):
                val = clean(cells[nxt])
                if val:
                    if is_any_meta_label(val):
                        break
                    if accept(cells[nxt]):
                        return cells[nxt], cell_evidence(doc, sheet, number, nxt, cells[nxt])
            # 2. Check row directly below for vertical column alignment
            if idx + 1 < len(rows[:35]):
                next_number, next_cells = rows[idx + 1]
                for below_col in range(col, min(len(next_cells), col + 2)):
                    val = clean(next_cells[below_col])
                    if val:
                        if is_any_meta_label(val) or val.lower() in ("from", "to"):
                            continue
                        if pattern in (META_LABELS["invoice_no"], META_LABELS["bl_no"]):
                            if re.search(
                                r"\b(?:co\.?,?\s*ltd|inc|corporation|corp|llc|limited)\b", val, re.I
                            ):
                                continue
                        if accept(next_cells[below_col]):
                            return next_cells[below_col], cell_evidence(
                                doc, sheet, next_number, below_col, next_cells[below_col]
                            )
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
    text = clean(value)
    if standard := year_first_date(text):
        return standard
    try:
        serial = float(text)
        if 35000 <= serial <= 55000:
            return (date(1899, 12, 30) + timedelta(days=int(serial))).isoformat()
    except (ValueError, TypeError):
        pass
    return None


def reference_value(raw):
    text = str(int(raw)) if isinstance(raw, float) and raw.is_integer() else clean(raw)
    return reference_text(text)


def place_value(raw):
    return bool(re.search(r"\w", clean(raw))) and not re.search(
        r"\b(?:ltd|limited|corp|llc|company|inc)\b|公司", clean(raw), re.I
    )


def party_value(raw):
    text = clean(raw)
    return sum(c.isalpha() for c in text) >= 2 and not is_any_meta_label(text)


def printed_route_name(rows, key, source, raw):
    """Bind an English continuation to the same labelled route value column."""
    match = re.fullmatch(r"([A-Z]+)\d+", source.cell or "")
    if not match or source.row is None or not set(languages(clean(raw))) & {"km", "zh"}:
        return None
    value_col = column_index_from_string(match[1]) - 1
    sheet_rows = dict(rows[:35])
    label = META_LABELS[key]
    original = sheet_rows.get(source.row, [])
    label_col = next(
        (col for col in range(value_col - 1, max(-1, value_col - 5), -1)
         if label.fullmatch(clean(at(original, col)))),
        None,
    )
    if label_col is None:
        return None
    following = sheet_rows.get(source.row + 1, [])
    if heading_row(following):
        return None
    # The adjacent value belongs to this field when its left side is blank
    # or repeats the route label. A new label or value ends this block.
    for col in range(label_col, value_col):
        text = clean(at(following, col))
        if text and (col != label_col or not label.fullmatch(text)):
            return None
    value = clean(at(following, value_col))
    if (
        not value
        or len(value) > 72
        or languages(value) != ["en"]
        or not re.fullmatch(r"[A-Za-z][A-Za-z .,'()/-]*", value)
        or is_any_meta_label(value)
        or not place_value(value)
    ):
        return None
    return EnglishText(
        status="source", value=value,
        evidence=[cell_evidence(source.document_id, source.sheet, source.row + 1, value_col, value)],
    )


def metadata(doc: UUID, sheet: str, rows: list[Row], legacy: dict, role: Role) -> dict:
    keys = [
        "supplier",
        "shipper",
        "consignee",
        "notify_party",
        "origin",
        "destination",
        "port",
        "container",
        "seal",
        "booking_no",
        "bl_no",
        "vessel",
        "voyage",
        "etd",
        "eta",
    ]
    keys += ["invoice_no", "invoice_date", "contract_no"]
    result = {}
    for key in keys:
        if key in {"invoice_no", "bl_no", "contract_no", "booking_no"}:
            accept = reference_value
        elif key in {"invoice_date", "etd", "eta"}:
            accept = date_text
        elif key in {"origin", "destination", "port"}:
            accept = place_value
        elif key in {"supplier", "consignee"}:
            accept = party_value
        else:
            accept = bool
        source = labelled(rows, doc, sheet, META_LABELS[key], accept=accept)
        if source:
            raw, evidence = source
            value = date_text(raw) if key in {"invoice_date", "etd", "eta"} else clean(raw)[:350]
            result[key] = field(value or None, evidence, uncertain=not value)
            if key in {"origin", "destination", "port"}:
                result[key].english = printed_route_name(rows, key, evidence, raw)
        elif key in {"supplier", "consignee", "invoice_no", "invoice_date", "contract_no"} and (
            evidence := anchored(rows, doc, sheet, legacy.get(key))
        ) and accept(legacy.get(key)):
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
        if seen_item and any(TOTAL_MARKER.fullmatch(clean(value)) for value in cells):
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
            measured = any(decimal(at(cells, columns.get(k))) is not None for k in TOTAL_FIELDS)
            if qty is None and not measured and not first_legacy_row <= number <= last_legacy_row:
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
                dimension = package_unit(heading)
            elif key == "measurement":
                dimension = "CBM" if re.search(r"\b(?:m3|cbm)\b|m³", heading, re.I) else None
            else:
                dimension = values["unit"].value if key == "unit_price" else None
            code = currency(heading) if key in {"unit_price", "amount"} else None
            values[key] = numeric_cell(doc, sheet, number, cells, col, units=dimension, code=code)
            if values[key].value is not None and key in {"quantity", "unit_price"} and dimension:
                values[key].evidence.extend(values["unit"].evidence)
        results.append(Item(row=number, fields=values))
        if len(results) > MAX_ITEMS:
            raise ProcessingLimit("item_limit")
    return results


def apply_invoice_footer_currency(doc, sheet, rows, items, amount_col, total_row):
    if total_row is None or amount_col is None:
        return
    number, cells = total_row
    label_row = dict(rows).get(number + 1, [])
    label = clean(at(label_row, amount_col))
    if decimal(at(cells, amount_col)) is None or not re.fullmatch(
        r"USD|CNY|RMB|KHR|EUR", label, re.I
    ):
        return
    code = currency(label)
    money = [item.fields[key] for item in items for key in ("unit_price", "amount")]
    if any(value.currency and value.currency != code for value in money):
        return
    evidence = cell_evidence(doc, sheet, number + 1, amount_col, label)
    for value in money:
        if value.value is not None and value.currency is None:
            value.currency = code
            value.evidence.append(evidence)
    return evidence


def header_unit(text: str) -> str | None:
    match = re.search(r"[（(]([^）)]+)[）)]", text)
    return unit(match.group(1)) if match else None


def weight_unit(text: str) -> str | None:
    match = WEIGHT.search(re.sub(r"\b[gn]\.?w\b\.?", "", text, flags=re.I))
    return unit(match.group()) if match else None


def package_unit(text):
    text = folded(text)
    if re.search(r"(?<!\w)(?:cartons?|ctns?)(?!\w)", text):
        return "CTN"
    if re.search(r"(?<!\w)rolls?(?!\w)", text):
        return "ROLL"
    if re.search(r"(?<!\w)(?:packages?|pkgs?)(?!\w)|件数|件數|包数|包數|កញ្ចប់", text):
        return "PKG"
    return None


def declared_total(rows, items, columns=None):
    if not items:
        return None
    for number, cells in rows:
        if number <= items[-1].row:
            continue
        if any(TOTAL_MARKER.fullmatch(clean(value)) for value in cells):
            return number, cells
        if number == items[-1].row + 1 and columns and not clean(at(cells, columns.get("description"))):
            numeric = [value for value in cells if clean(value)]
            if numeric and all(decimal(value) is not None for value in numeric):
                return number, cells
    return None


def totals(doc, sheet, items, columns, total_row, footer_currency, rows=None, merges=None):
    result = {key: field(None) for key in (*TOTAL_FIELDS, "amount")}
    if not items:
        return result
    for key in result:
        col = columns.get(key)
        if col is None:
            continue
        if total_row:
            number, cells = total_row
            if not clean(at(cells, col)):
                col = next((start for (row, start), (_, stop) in (merges or {}).items()
                            if row == number and start <= col < stop and decimal(at(cells, start)) is not None),
                           col)
            sample = items[0].fields[key]
            code = sample.currency
            if key == "amount" and footer_currency is not None:
                code = currency(footer_currency.raw or "")
            printed = numeric_cell(doc, sheet, number, cells, col, units=sample.unit, code=code)
            if printed.value is not None or printed.status == "uncertain":
                if key == "amount" and footer_currency is not None:
                    printed.evidence.append(footer_currency)
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


    # An explicitly printed package unit can follow the count on the next row.
    if total_row and rows and (not result["packages"].value or not result["packages"].unit):
        number, cells = total_row
        next_cells = dict(rows).get(number + 1, [])
        for col, label in enumerate(next_cells):
            dimension = package_unit(clean(label))
            if dimension and decimal(at(cells, col)) is not None:
                printed = numeric_cell(doc, sheet, number, cells, col, units=dimension)
                printed.evidence.append(cell_evidence(doc, sheet, number + 1, col, label))
                result["packages"] = printed
                break

    return result


def resolve_workbook_columns(rows, columns, headers, end, region):
    """Bind merged headings to their uniquely populated columns."""
    sample = [cells for number, cells in rows if end < number <= end + 28
              and clean(at(cells, columns.get("description")))
              and not any(TOTAL_MARKER.fullmatch(clean(v)) for v in cells)]
    limits = {}
    extra_heading = next((cells for n, cells in rows if n == end + 1 and heading_row(cells)), [])
    for key, col in columns.items():
        if key in {"gross_weight", "net_weight", "measurement", "unit_price", "amount"}:
            extra = clean(at(extra_heading, col))
            if extra and (weight_unit(extra) or currency(extra) or re.fullmatch(r"cbm|m3", extra, re.I)):
                headers[col] += " " + extra
    for key, col in columns.items():
        merge = next((span for (row, start), span in region.merges.items()
                      if start == col and end - 2 <= row <= end <= span[0] + 2), None)
        limits[key] = min(merge[1], region.stop) if merge else col + 1
    amount_label = columns.get("amount")
    for key in {"gross_weight", "net_weight", "measurement", "amount", "packages"} & columns.keys():
        col = columns[key]
        populated = [i for i in range(col, limits[key])
                     if any(decimal(at(cells, i)) is not None for cells in sample)]
        if len(populated) == 1 and populated[0] != col:
            headers[populated[0]] = headers[col]
            columns[key] = populated[0]
    desc = columns.get("description")
    amount = columns.get("amount")
    if desc is not None and columns.get("quantity") == desc:
        columns.pop("quantity")
        quantity = [i for i in range(desc + 1, limits["description"] - 1)
                    if any(decimal(at(cells, i)) is not None
                           and folded(clean(at(cells, i + 1))) in UNIT_ALIASES for cells in sample)]
        if len(quantity) != 1:
            return
        col = quantity[0]
        columns.update(quantity=col, unit=col + 1)
        if region.role == "invoice" and "unit_price" not in columns and amount is not None:
            valid = []
            for possible in range(col + 2, amount_label):
                populated = [
                    (decimal(at(row, col)), decimal(at(row, possible)), decimal(at(row, amount)))
                    for row in sample if decimal(at(row, col)) is not None
                ]
                if populated and all(
                    price is not None and price >= 0 and
                    (total is None or abs(qty * price - total) <= Decimal("0.01"))
                    for qty, price, total in populated
                ):
                    valid.append(possible)
            if len(valid) == 1:
                columns["unit_price"] = valid[0]
                codes = {
                    code for n, row in rows if n <= end
                    for v in row if re.fullmatch(r"USD|CNY|RMB|KHR|EUR", clean(v), re.I)
                    if (code := currency(clean(v)))
                }
                if len(codes) == 1:
                    code = next(iter(codes))
                    headers[valid[0]] += " " + code
                    headers[amount] += " " + code


def workbook_role(data, name, doc, region: Region):
    sheet, rows, role = region.sheet, region.rows, region.role
    parser = extract_shipping if role == "invoice" else extract_packing
    legacy, parsed = parser(data, name, workbook=[(sheet, rows)])
    relevant = [item for item in parsed if item["sheet"] == sheet]
    before = min((item["row"] for item in relevant), default=min(len(rows) + 1, 40))
    columns, headers, end = headers_for(rows, before)
    if not columns:
        columns, headers, end = headers_for(rows, 40)
    if columns:
        resolve_workbook_columns(rows, columns, headers, end, region)
    items = excel_items(doc, sheet, rows, relevant, columns, headers, end)
    total_row = declared_total(rows, items, columns)
    footer_currency = None
    if role == "invoice":
        footer_currency = apply_invoice_footer_currency(
            doc, sheet, rows, items, columns.get("amount"), total_row
        )
    meta_rows = [(n, row) for n, row in rows if n < end] if end else rows
    fields = metadata(doc, sheet, meta_rows, legacy, role)
    if fields["invoice_no"].value is None and role in {"invoice", "packing_list"}:
        short_ref = re.compile(r"^(?:no\.?|number)\s*[:：]\s*", re.I)
        result = labelled(meta_rows, doc, sheet, short_ref, accept=reference_value)
        if result and fields["invoice_date"].value:
            raw, citation = result
            fields["invoice_no"] = field(clean(raw), citation)
    fields.update(totals(doc, sheet, items, columns, total_row, footer_currency, rows=rows, merges=region.merges))
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



def workbook_waybill(doc, region):
    """Read numbered form cells while keeping ambiguous count dimensions visible."""
    sheet, rows = region.sheet, region.rows
    fields = metadata(doc, sheet, rows, {}, "draft_bl")
    labels = {
        "bl_no": r"(?:tb|b/l|truck waybill|bill of lading)\s*(?:no\.?|number)",
        "shipper": r"shipper", "consignee": r"consignee", "notify_party": r"notify party",
        "origin": r"place of loading|port of loading",
        "port": r"place of discharge|port of discharge",
        "destination": r"place of delivery|final destination",
        "issue_date": r"date of issue|issue date",
        "packages": r"(?:(?:no\.|number) of )?(?:containers? or )?packages",
        "gross_weight": r"gross weight", "measurement": r"measurement|volume",
    }
    for key, label in labels.items():
        pattern = re.compile(rf"^(?:\d+\.\s*)?(?:{label})(?!\w)\s*[:：]?", re.I)
        for pos, (n, cells) in enumerate(rows[:65]):
            for col, cell in enumerate(cells):
                raw = clean(cell)
                match = pattern.match(raw)
                if not match:
                    continue
                tail = raw[match.end():].strip()
                boundary = next((i for i in range(col + 1, len(cells)) if re.match(r"^\d+\.\s", clean(at(cells, i)))), len(cells))
                stop = min(region.merges.get((n, col), (n, boundary))[1], boundary)
                candidates = []
                if key in {"bl_no", "issue_date"}:
                    candidates.extend((n, i, at(cells, i)) for i in range(col + 1, min(boundary, col + 9)))
                if tail:
                    candidates.insert(0, (n, col, tail))
                low = region.merges.get((n, col), (n, stop))[0]
                candidates.extend((nr, i, at(values, i)) for nr, values in rows[pos+1:pos+8]
                                  if nr > low for i in range(col, stop))
                for nr, i, value in candidates:
                    evidence = cell_evidence(doc, sheet, nr, i, value if (nr, i) != (n, col) else cell)
                    if key in {"packages", "gross_weight", "measurement"}:
                        amount = decimal(value)
                        dimension = (package_unit(raw) if " or " not in folded(raw) else None) if key == "packages" else (
                            weight_unit(raw) if key == "gross_weight" else "CBM" if "cbm" in folded(raw) else None
                        )
                        if amount is None or amount < 0:
                            continue
                        fields[key] = field(str(amount), evidence, cell_evidence(doc, sheet, n, col, cell), unit=dimension, uncertain=not dimension)
                    else:
                        text = date_text(value) if key == "issue_date" else clean(value).split("\n")[0]
                        if not text or (key == "bl_no" and not reference_value(text)) or is_any_meta_label(text):
                            continue
                        fields[key] = field(text, evidence)
                    break
                if fields.get(key) and fields[key].value is not None:
                    break
            if fields.get(key) and fields[key].value is not None:
                break

    fields["delivery"] = fields["destination"]
    fields["discharge"] = fields["port"]
    return Extraction(document_id=doc, role="draft_bl", method="excel_regions", document_kind="waybill",
                      status="partial", sheet=sheet, fields=fields,
                      source_excerpt=[row_evidence(doc, sheet, n, row) for n, row in rows[:35]
                                      if any(clean(value) for value in row)])

def bill_lines(pdf):
    return [
        Evidence(document_id=UUID(int=0), page=index, line=number, raw=clean(text)[:350])
        for index, page in enumerate(pdf, 1)
        for number, text in enumerate(page.get_text().splitlines(), 1)
        if clean(text)
    ]



def extract_pdf_legacy(data: bytes, name: str, doc: UUID, classification: str):
    """Fallback for native layouts with geometrically verifiable legacy candidates."""
    with pymupdf.open(stream=data, filetype="pdf") as pdf:
        lines = [item.model_copy(update={"document_id": doc}) for item in bill_lines(pdf)]

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
    if classification not in ("draft_bl", "final_bl") and not BILL_MARKER.search(text):
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
        "port",
    ):
        value = clean(raw.get(key))[:350]
        if key == "container" and not CONTAINER_VALUE_RE.match(value):
            value = ""
        original = clean(raw.get("raw_date")) if key == "issue_date" else value
        evidence = locate(original)
        if key in {"origin", "destination", "port"} and evidence:
            context = " ".join(
                line.raw or ""
                for line in lines
                if line.page == evidence.page and abs((line.line or 0) - (evidence.line or 0)) <= 3
            )
            labels = (
                r"loading|receipt|起运|装船"
                if key == "origin"
                else r"discharge|delivery|destination|border|port|目的|卸货|口岸"
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
    for num_key in ("packages", "gross_weight"):
        if fields[num_key].status != "present" and raw.get(num_key) is not None:
            val_num = raw[num_key]
            val_str = (
                str(int(val_num))
                if isinstance(val_num, float) and val_num.is_integer()
                else str(val_num)
            )
            ev_line = None
            for line in lines:
                l_raw = line.raw or ""
                if val_str in l_raw or (isinstance(val_num, float) and f"{val_num:.3f}" in l_raw):
                    ev_line = line
                    break
            if ev_line:
                u = "PKG" if num_key == "packages" else "KG"
                fields[num_key] = field(val_str, ev_line, unit=u, uncertain=used_ocr)
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
                if key != "container" or CONTAINER_VALUE_RE.match(value):
                    fields[key] = field(value, line, uncertain=used_ocr)
                break
    mode = ROUTE_MODE.search(text)
    mode_val = clean(raw.get("shipping_mode")) or (mode.group().upper() if mode else None)
    evidence = (
        locate(mode.group())
        if mode
        else (
            locate(fields["origin"].value)
            or locate(fields["destination"].value)
            or (lines[0] if lines else None)
        )
    )
    fields["shipping_mode"] = (
        field(mode_val, evidence, uncertain=used_ocr) if evidence and mode_val else field(None)
    )
    cargo = [(clean(value)[:140], locate(value)) for value in raw.get("descriptions", [])[:5]]
    cargo = [(value, evidence) for value, evidence in cargo if value and evidence]
    if "cargo_summary" not in fields:
        fields["cargo_summary"] = field(
            " / ".join(value for value, _ in cargo) or None,
            *(evidence for _, evidence in cargo),
            uncertain=used_ocr and bool(cargo),
        )
    route = [fields[key] for key in ("origin", "port", "destination")]
    if all(point.value and point.evidence for point in route):
        fields["route_legs"] = field(
            raw.get("route_legs"),
            *(point.evidence[0] for point in route),
            uncertain=True,
        )

    core = all(fields[key].value for key in ("bl_no", "shipper", "consignee"))
    return Extraction(
        document_id=doc,
        role="draft_bl",
        status="extracted" if core else "partial",
        method="tesseract" if used_ocr else "extract_bill",
        fields=fields,
        source_excerpt=lines[:60],
    )


def _extract(data: bytes, name: str, doc: UUID, classification: str) -> list[Extraction]:
    suffix = Path(name).suffix.lower()
    try:
        if suffix == ".pdf":
            return [extract_positioned_pdf(data, name, doc, classification, extract_pdf_legacy)]
        workbook = read_supplier_workbook(data, name)
        sections = regions(workbook, workbook_merges(data, name), classification)
        results = []
        for role in ("invoice", "packing_list", "draft_bl"):
            candidates = [region for region in sections if region.role == role]
            if not candidates:
                continue
            extracted = [
                workbook_waybill(doc, region) if role == "draft_bl" else workbook_role(data, name, doc, region)
                for region in candidates
            ]
            primary, *other_sections = extracted
            primary.sections = other_sections
            if any(candidates[0].rows != region.rows for region in candidates[1:]):
                primary.status = "partial"
                primary.error = "multiple_workbook_sections"
            results.append(primary)
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
    except (ProcessingLimit, PDFLimit) as exc:
        error = str(exc)
    except Exception:
        # Parser diagnostics can contain document contents. Persist a fixed code.
        error = "unreadable_pdf" if suffix == ".pdf" else "unreadable_workbook"
    role = (
        classification
        if classification in ("draft_bl", "final_bl")
        else "draft_bl"
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


def extract(data: bytes, name: str, doc: UUID, classification: str) -> list[Extraction]:
    return [annotate_languages(item) for item in _extract(data, name, doc, classification)]
