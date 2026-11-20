"""Read item cells from ruled or aligned regions of an invoice or packing list."""

import re
from bisect import bisect_right

import pymupdf

from shipping_ai.review.schemas import Item
from shipping_ai.review.values import currency, decimal, field, folded, unit

from .languages import ROW_FIELDS, SEPARATORS, TOTAL, column_map, spellings
from .pdf_layout import Line, visual_rows
from .workbook_layout import TOTAL_TEXT

NUMERIC = {
    "quantity",
    "unit_price",
    "amount",
    "packages",
    "gross_weight",
    "net_weight",
    "measurement",
}
FOOTER = re.compile(
    rf"^(?:sub\s*total|(?:grand\s+)?total|{spellings(*TOTAL)})(?:\b|(?=[\s:：\d])|$)", re.I
)
WEIGHT_UNIT = re.compile(r"\b(?:kg|kgs|lb|lbs|tonnes?)\b|公斤|千克|គីឡូក្រាម", re.I)
VOLUME_UNIT = re.compile(r"\b(?:cbm|m3)\b|m³", re.I)


def raw(lines):
    return " ".join(line.text for line in lines).strip()


def positioned_headers(layout):
    for label in layout.lines[:160]:
        scanned = any(token.method != "pdf_text" for token in label.tokens)
        if "description" not in column_map([folded(label.text)], ocr=scanned):
            continue
        band = sorted(
            (
                segment
                for segment in layout.lines
                if abs(segment.box.y0 - label.box.y0) <= layout.height * 0.86
            ),
            key=lambda segment: segment.box.x0,
        )
        groups = []
        for segment in band:
            if groups and (
                segment.box.x0 < max(line.box.x1 for line in groups[-1])
                or (
                    re.fullmatch(r"\(\s*[A-Z]{3}\s*\)", segment.text)
                    and segment.box.x0 - groups[-1][-1].box.x1 <= layout.height * 4
                )
            ):
                groups[-1].append(segment)
            else:
                groups.append([segment])
        columns = column_map([folded(raw(cell)) for cell in groups], ocr=scanned)
        if "description" in columns and columns.keys() & {"quantity", "packages", "gross_weight"}:
            return groups
    return []


def positioned_rows(layout):
    """Yield aligned cells on text-only and raster pages with no vector grid."""
    headers = positioned_headers(layout)
    if not headers:
        return
    yield headers
    starts = [min(s.box.x0 for s in cell) - layout.height * 0.65 for cell in headers]
    bottom = max(line.box.y1 for cell in headers for line in cell)
    prior = bottom
    grouped = []
    for words in visual_rows(t for t in layout.words if t.y > bottom)[:205]:
        line = Line(tuple(words))
        if line.box.y0 - prior > max(42, layout.height * 4):
            break
        slots = [[] for _ in starts]
        for token in words:
            col = max(0, bisect_right(starts, token.x) - 1)
            slots[col].append(token)
        if (
            grouped
            and abs(line.box.y0 - grouped[-1][0]) <= layout.height * 0.8
            and not any(left and right for left, right in zip(grouped[-1][1], slots, strict=True))
        ):
            for left, right in zip(grouped[-1][1], slots, strict=True):
                left.extend(right)
        else:
            grouped.append((line.box.y0, slots))
        prior = line.box.y1
    for _, slots in grouped:
        yield [[Line(tuple(tokens))] if tokens else [] for tokens in slots]


def grid_rows(layout):
    try:
        tables = layout.page.find_tables().tables
    except (ValueError, RuntimeError):
        return
    matrix = layout.page.rotation_matrix
    for table in tables[:16]:
        yield (
            [layout.region(pymupdf.Rect(cell) * matrix) if cell else [] for cell in row.cells]
            for row in table.rows[:230]
        )


def parse_rows(layout, doc, rows, start):
    columns, headings = {}, []
    items = []
    for cells in rows:
        values = [raw(cell) for cell in cells]
        scanned = any(
            token.method != "pdf_text" for cell in cells for line in cell for token in line.tokens
        )
        mapped = column_map([folded(value) for value in values], ocr=scanned)
        if "description" in mapped and mapped.keys() & {"quantity", "packages", "gross_weight"}:
            columns, headings = mapped, cells
            continue
        if not columns or any(
            TOTAL_TEXT.fullmatch(value)
            or FOOTER.match(value)
            or (value and any(SEPARATORS.sub("", value).startswith(marker) for marker in TOTAL))
            for value in values
        ):
            if items and columns:
                break
            continue

        def source(key):
            index = columns.get(key)
            return cells[index] if index is not None and index < len(cells) else []

        def heading(key):
            return headings[columns[key]] if key in columns else []

        desc = source("description")
        numerical = {key for key in NUMERIC if decimal(raw(source(key))) is not None}
        if not desc or not (numerical - {"amount"}):
            # A continuation line inside a ruled cell is already part of its description.
            continue
        proposed = {key: field(None) for key in ROW_FIELDS}
        unit_source = source("unit")
        dimension = unit(raw(unit_source))
        for key in ROW_FIELDS:
            lines = source(key)
            value = raw(lines)
            if not value:
                continue
            header = heading(key)
            citations = layout.evidence(doc, lines)
            code, units = None, None
            if key in NUMERIC:
                number = decimal(value)
                if key == "packages" and number is None and value:
                    m = re.match(
                        r"^(?:(?:case|ctn|carton|pkg|box|no\.?)\s*)?(\d+)\s*(?:[-~～至到/]|to)\s*(\d+)",
                        value.strip(),
                        re.I,
                    )
                    if m:
                        s, e = int(m.group(1)), int(m.group(2))
                        if e >= s:
                            number = Decimal(e - s + 1)
                if number is None or number < 0:
                    continue
                value = format(number, "f")
                if key == "packages":
                    units = "PKG"
                if key in {"unit_price", "amount"}:
                    code = currency(raw(header))
                    if code:
                        citations.extend(layout.evidence(doc, header))
                if key in {"quantity", "unit_price"} and dimension:
                    units = dimension
                    citations.extend(layout.evidence(doc, unit_source))
                if key in {"gross_weight", "net_weight", "measurement"}:
                    match = (VOLUME_UNIT if key == "measurement" else WEIGHT_UNIT).search(
                        raw(header)
                    )
                    if match:
                        units = "CBM" if key == "measurement" else unit(match[0])
                        citations.extend(layout.evidence(doc, header))
            elif key == "unit":
                value = dimension
            uncertain = any(e.method != "pdf_text" for e in citations)
            proposed[key] = field(value, *citations, unit=units, currency=code, uncertain=uncertain)
            if uncertain:
                proposed[key].review_reason = "verify_ocr_value"
        items.append(Item(row=start + len(items) + 1, fields=proposed))
        if len(items) >= 200:
            break
    return items


def collect_items(layout, doc, start):
    items = []
    for table in grid_rows(layout):
        items.extend(parse_rows(layout, doc, table, start + len(items)))
        if len(items) >= 200:
            break
    return items[:200] or parse_rows(layout, doc, positioned_rows(layout), start)
