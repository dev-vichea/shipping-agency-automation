"""Find independent workbook sections and preserve the original cell grid."""

import io
import posixpath
import re
from collections import defaultdict
from dataclasses import dataclass
from zipfile import ZipFile

import xlrd
from defusedxml.ElementTree import parse
from openpyxl.utils.cell import range_boundaries

from shipping_ai.review.values import clean, folded

TITLE = {
    "invoice": r"(?:commercial\s+)?invoice|i\s*n\s*v\s*o\s*i\s*c\s*e|商业发票",
    "packing_list": r"packing\s*list|装箱单|清单",
    "draft_bl": r"(?:(?:truck|air|sea|ocean)\s+)?way\s*bill(?: of lading)?|(?:draft )?bill of lading|提单",
}
SHEET_TITLE = {
    "invoice": r"(?:commercial )?(?:inv\.?|invoice|ci)|商业发票|发票",
    "packing_list": r"pack(?:ing(?:\s*list)?)?|pl\.?|装箱单",
    "draft_bl": r"(?:(?:truck|air|sea)\s+)?way\s*bill|(?:draft )?bill of lading",
}
TOTAL_TEXT = re.compile(
    r"^(?:(?:grand\s+)?total|ttl\.?|合计|总计|總計|合計)(?:\s*[:：]?\s*(?:total|合计|总计|總計|合計))?\s*[:：]?\s*$",
    re.I,
)


@dataclass(frozen=True)
class Region:
    role: str
    sheet: str
    rows: list
    merges: dict
    start: int
    stop: int


def title(value):
    text = folded(clean(value))
    text = re.split(r"\s*[(（]", text, maxsplit=1)[0].strip(" :：")
    return next((key for key, pattern in TITLE.items() if re.fullmatch(pattern, text)), None)


def sheet_title(name):
    text = re.sub(r"\s*\(\d+\)$", "", folded(name))
    return next((key for key, pattern in SHEET_TITLE.items() if re.fullmatch(pattern, text)), None)


def regions(workbook, merges, classification):
    output = []
    for sheet, rows in workbook.items():
        if not any(any(clean(value) for value in cells) for _, cells in rows):
            continue
        width = max(map(len, (cells for _, cells in rows)), default=0)
        titles = [
            (number, col, kind)
            for number, cells in rows[:16]
            for col, cell in enumerate(cells)
            if (kind := title(cell))
        ]
        bands = defaultdict(list)
        for number, col, role in titles:
            bands[number].append((col, role))
        panels = next(
            (sorted(band) for band in bands.values() if len({role for _, role in band}) > 1), None
        )
        bounds = merges.get(sheet, {})
        if panels:
            for idx, (col, role) in enumerate(panels):
                stop = panels[idx + 1][0] if idx + 1 < len(panels) else width
                start = col if idx else 0
                masked = [(n, [None] * start + list(cells[start:stop])) for n, cells in rows]
                output.append(Region(role, sheet, masked, bounds, start, stop))
            continue
        role = titles[0][2] if titles else sheet_title(sheet)
        if role:
            output.append(Region(role, sheet, rows, bounds, 0, width))
    if not output and classification in {"invoice", "packing_list"} and workbook:
        sheet, rows = next(iter(workbook.items()))
        output.append(
            Region(
                classification,
                sheet,
                rows,
                merges.get(sheet, {}),
                0,
                max((len(row) for _, row in rows), default=0),
            )
        )
    return output


def workbook_merges(data, name):
    if name.lower().endswith(".xls"):
        book = xlrd.open_workbook(file_contents=data, formatting_info=True, on_demand=True)
        try:
            return {
                sheet.name: {
                    (lo + 1, left): (hi, right)
                    for lo, hi, left, right in sheet.merged_cells
                    if lo < 40 and right <= 100
                }
                for sheet in book.sheets()
            }
        finally:
            book.release_resources()
    with ZipFile(io.BytesIO(data)) as archive:
        with archive.open("xl/workbook.xml") as stream:
            sheets = parse(stream).getroot().findall(".//{*}sheet")
        with archive.open("xl/_rels/workbook.xml.rels") as stream:
            paths = {node.get("Id"): node.get("Target", "") for node in parse(stream).getroot()}
        output = {}
        for sheet in sheets:
            key = next((value for name, value in sheet.attrib.items() if name.endswith("}id")), "")
            target = paths.get(key, "")
            path = (
                target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            )
            if (
                not re.fullmatch(r"xl/worksheets/[^/]+\.xml", path)
                or path not in archive.namelist()
            ):
                continue
            ranges = {}
            with archive.open(path) as stream:
                for merge in parse(stream).getroot().findall(".//{*}mergeCell"):
                    left, lo, right, hi = range_boundaries(merge.get("ref", ""))
                    if lo <= 40 and right <= 100:
                        ranges[lo, left - 1] = (hi, right)
            output[sheet.get("name")] = ranges
        return output
