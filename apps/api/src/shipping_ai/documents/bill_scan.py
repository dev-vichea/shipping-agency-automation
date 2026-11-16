"""Read scanned B/Ls using nearby printed labels and the positions of their values."""

import re
import subprocess
from dataclasses import dataclass
from time import monotonic
from uuid import UUID

import pymupdf

from shipping_ai.review.schemas import Evidence, ExtractedField
from shipping_ai.review.values import clean, decimal, field

from .ocr import ocr_words

BILL = re.compile(r"bill of lading|\bway\s*bill\b|\bB\s*/\s*L\b|提单", re.I)
LABELS = {
    "bl_no": r"(?:truck\s+)?(?:bill of lading\s*(?:no\.?|number)|B\s*/\s*L\s*(?:no\.?|number))|提单号码",
    "shipper": r"shipper(?:\s*/\s*exporter)?|发货人",
    "consignee": r"consignee|收货人",
    "notify_party": r"notify party(?:,.*)?",
    "carrier": r"carrier",
    "vessel": r"(?:ocean\s+)?vessel(?:\s+name)?|船名",
    "voyage": r"voyage(?:\s*(?:no\.?|number))?|航次",
    "origin": r"(?:port|place) of loading|起运港|装船口岸",
    "destination": r"(?:port|place) of discharge|卸货港|目的港",
    "issue_date": r"(?:place and )?date of issue|issue date|shipped on board(?: date)?",
    "packages": r"(?:total\s+|no\.?\s+(?:and kind\s+)?of\s+)?(?:packages?|cartons?|pkgs?|ctns?)",
    "gross_weight": r"gross\s+weight(?:\s+cargo)?|g\.?w\.?|毛重",
    "net_weight": r"net\s+weight|n\.?w\.?|净重",
    "measurement": r"measurement|volume",
    "cargo_summary": r"description of (?:packages and )?goods(?: as stated by shipper)?|cargo description|货物描述",
}
NEIGHBOR_LABEL = re.compile(
    r"tare|final place of delivery|freight to be paid at|place of receipt|marks and nos", re.I
)
LABEL_PATTERNS = {
    key: re.compile(rf"^(?:{pattern})(?![\w])", re.I) for key, pattern in LABELS.items()
}
NUMBER = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
WEIGHT_UNIT = r"kg(?:s)?|lbs?|tonnes?"
DATE = r"(?:\d{1,2}[- /][A-Za-z]{3,9}[- /]20\d{2}|20\d{2}[-/]\d{1,2}[-/]\d{1,2})"
CONTAINER = re.compile(r"[A-Z]{4}\s?\d{6}[- ]?\d", re.I)
SEAL = re.compile(r"^seal(?:\s+(?:no\.?|number))?\s*[:：]?\s*([A-Z0-9-]*\d[A-Z0-9-]{3,19})$", re.I)
IDENTIFIER = re.compile(r"(?=[A-Z0-9/+-]*\d)[A-Z0-9][A-Z0-9/+-]{3,35}", re.I)
SKIP_TEXT = re.compile(
    r"\b(?:marks and nos|said to contain|load stow|shipping person|postal code|e-mail|"
    r"made in|container and seals|tare|\(see|as stated by shipper)\b|[@:*]",
    re.I,
)


@dataclass
class ScanLine:
    rect: pymupdf.Rect
    text: str
    evidence: Evidence
    words: list
    confidence: float

    @property
    def center(self):
        return (self.rect.x0 + self.rect.x1) / 2


def read_lines(page, doc: UUID, deadline: float, *, threshold: int, start: int, language="eng"):
    try:
        words = ocr_words(
            page,
            page.rect,
            scale=250 / 72,
            segmentation=11,
            deadline=deadline,
            threshold=threshold,
            language=language,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    return scan_lines(page, doc, words, start=start)


def scan_lines(page, doc: UUID, words, *, start=0):
    lines = []
    for group in words.values():
        parts: list[list] = []
        for word in sorted(group, key=lambda item: item[0].x0):
            rect, symbol, _ = word
            if not parts or rect.x0 - parts[-1][-1][0].x1 > max(8, rect.height * 1.75):
                parts.append([])
            parts[-1].append(word)
        for part in parts:
            text = clean(" ".join(symbol for _, symbol, _ in part)).strip(" |*_~’‘[]")
            text = re.sub(r"(?<=\w)\s*[‘’](?=\w)", "", text)
            if not any(char.isalnum() for char in text):
                continue
            box = pymupdf.Rect()
            for rect, _, _ in part:
                box |= rect
            box &= page.rect
            if box.is_empty:
                continue
            lines.append(
                ScanLine(
                    box,
                    text,
                    Evidence(
                        document_id=doc,
                        page=page.number + 1,
                        raw=text[:350],
                        bbox=(
                            box.x0 / page.rect.width,
                            box.y0 / page.rect.height,
                            box.width / page.rect.width,
                            box.height / page.rect.height,
                        ),
                    ),
                    part,
                    min(confidence for _, _, confidence in part),
                )
            )
    lines.sort(key=lambda item: (item.rect.y0, item.rect.x0))
    for index, line in enumerate(lines, start + 1):
        line.evidence.line = index
    return lines


def below(header: ScanLine, lines: list[ScanLine], neighbors: list[ScanLine], *, depth: float = 44):
    peers = [
        item.center
        for item in neighbors
        if item is not header and abs(item.rect.y0 - header.rect.y0) <= 10
    ]
    left_peer = max((x for x in peers if x < header.center), default=None)
    right_peer = min((x for x in peers if x > header.center), default=None)
    margin = max(42, header.rect.width * 0.8)
    left = header.rect.x0 - margin if left_peer is None else (header.center + left_peer) / 2
    right = header.rect.x1 + margin if right_peer is None else (header.center + right_peer) / 2
    return [
        item
        for item in lines
        if item is not header
        and header.rect.y1 - 4 <= item.rect.y0 <= header.rect.y1 + depth
        and left <= item.center <= right
        and item.confidence >= 30
    ]


def read_value(key: str, value: str, unit_text: str = "") -> tuple[str, str | None] | None:
    text = value.strip(" |*_~‘’[]:;")[:140]
    if not text or any(pattern.fullmatch(text) for pattern in LABEL_PATTERNS.values()):
        return None
    if key in {"bl_no", "voyage"}:
        return (text, None) if IDENTIFIER.fullmatch(text) else None
    if key == "issue_date":
        return (text, None) if re.fullmatch(DATE, text, re.I) else None
    if key == "packages":
        match = re.fullmatch(
            rf"({NUMBER})(?:\s+(?:packages?\s*(?:\(s\))?|pkg[s]?|ctns?|cartons?))?", text, re.I
        )
        amount = decimal(match[1]) if match else None
        return (str(int(amount)), "PKG") if amount and amount == int(amount) else None
    if key in {"gross_weight", "net_weight", "measurement"}:
        unit_pattern = r"cbm|m³|m3" if key == "measurement" else WEIGHT_UNIT
        match = re.fullmatch(rf"({NUMBER})\s*({unit_pattern})?", text, re.I)
        units = (match[2] or unit_text).upper() if match else ""
        amount = decimal(match[1]) if match else None
        normalized = {
            "KGS": "KG",
            "LBS": "LB",
            "TONNES": "T",
            "TONNE": "T",
            "M³": "CBM",
            "M3": "CBM",
        }
        return (
            (format(amount.normalize(), "f"), normalized.get(units, units))
            if amount and units
            else None
        )
    if key == "cargo_summary" and re.match(
        r"^\d+\s*(?:packages?|pkg|cartons?|ctns?|x\s*\d)", text, re.I
    ):
        return None
    if SKIP_TEXT.search(text) or sum(char.isalpha() for char in text) < 3:
        return None
    return text, None


def read_fields(lines: list[ScanLine]) -> dict[str, ExtractedField]:
    fields = {}
    labelled = []
    for item in lines:
        for key, pattern in LABEL_PATTERNS.items():
            match = pattern.match(item.text)
            if match and (match.end() == len(item.text) or item.text[match.end()] in " :："):
                labelled.append((key, item, item.text[match.end() :].lstrip(" :：")))
                break
    # Separate OCR blocks can split a printed label even in the middle of a word.
    for index, first in enumerate(lines):
        for second in lines[index + 1 :]:
            if second.rect.y0 - first.rect.y0 > 5:
                break
            left, right = sorted((first, second), key=lambda item: item.rect.x0)
            if (
                not -1 <= right.rect.x0 - left.rect.x1 <= 4
                or min(left.confidence, right.confidence) < 40
            ):
                continue
            prefix = left.text.rstrip(" /\\|")
            for key, pattern in LABEL_PATTERNS.items():
                if pattern.fullmatch(prefix + right.text) or pattern.fullmatch(
                    f"{prefix} {right.text}"
                ):
                    header = ScanLine(
                        left.rect | right.rect,
                        f"{prefix} {right.text}",
                        left.evidence,
                        [],
                        min(left.confidence, right.confidence),
                    )
                    labelled.append((key, header, ""))
                    break
    neighbors = [line for _, line, _ in labelled]
    neighbors.extend(line for line in lines if NEIGHBOR_LABEL.match(line.text))
    for key, header, tail in labelled:
        if key in fields:
            continue
        if tail and (parsed := read_value(key, tail)):
            fields[key] = field(parsed[0], header.evidence, unit=parsed[1], uncertain=True)
            continue

        candidates = below(header, lines, neighbors, depth=56 if key == "cargo_summary" else 39)
        if key == "issue_date":
            # Some forms print the city and date in separate spans on the same line.
            candidates = [
                item
                for item in lines
                if item.rect.x0 > header.rect.x1
                and abs(item.rect.y0 - header.rect.y0) < 10
                and item.confidence >= 30
            ] + candidates
        unit_text = ""
        for item in candidates:
            if key == "vessel" and any(item is neighbor for neighbor in neighbors):
                # A blank vessel box can sit directly above the loading port.
                break
            if re.fullmatch(rf"{WEIGHT_UNIT}|cbm|m³|m3", item.text, re.I):
                unit_text = item.text
                continue
            parsed = read_value(key, item.text, unit_text)
            if not parsed:
                continue
            if key == "cargo_summary":
                # Goods lines are normally consecutive in this column. Stop at contact or form text.
                next_lines = below(item, lines, [], depth=5)
                continuation = next(
                    (
                        line
                        for line in next_lines
                        if abs(line.rect.x0 - item.rect.x0) < 10 and read_value(key, line.text)
                    ),
                    None,
                )
                if continuation:
                    fields[key] = field(
                        f"{parsed[0]} / {continuation.text}",
                        item.evidence,
                        continuation.evidence,
                        uncertain=True,
                    )
                    break
            fields[key] = field(parsed[0], item.evidence, unit=parsed[1], uncertain=True)
            break

    for item in lines:
        if "container" not in fields and CONTAINER.fullmatch(item.text):
            fields["container"] = field(
                re.sub(r"[ -]", "", item.text), item.evidence, uncertain=True
            )
        if "seal" not in fields and (seal := SEAL.fullmatch(item.text)):
            fields["seal"] = field(seal[1], item.evidence, uncertain=True)

    # Explicit count plus unit can be printed in the description column.
    counts = {}
    for item in lines:
        match = re.match(
            rf"^({NUMBER})\s*(?:packages?\s*(?:\(s\))?|pkgs?|ctns?|cartons?)(?=\s*(?:/|$))",
            item.text,
            re.I,
        )
        if match and (parsed := read_value("packages", match[1])):
            counts[parsed[0]] = parsed, item.evidence
    if len(counts) == 1:
        parsed, citation = next(iter(counts.values()))
        fields["packages"] = field(parsed[0], citation, unit=parsed[1], uncertain=True)
    elif len(counts) > 1:
        fields.pop("packages", None)
    vessel = fields.get("vessel")
    if vessel:
        fields["shipping_mode"] = field("BY SEA", *vessel.evidence, uncertain=True)
    return fields


def refine_seal(page, selection: ExtractedField, lines: list[ScanLine], deadline: float):
    line = next(item for item in lines if item.evidence == selection.evidence[0])
    value = selection.value
    last_word, _, _ = line.words[-1]
    if not value or len(line.words) < 2:
        return
    clip = last_word + (0, -2, 10, 5)
    try:
        reread = ocr_words(
            page, clip & page.rect, scale=340 / 72, segmentation=7, deadline=deadline
        )
    except (OSError, subprocess.SubprocessError):
        return
    for words in reread.values():
        text = "".join(word for _, word, _ in words)
        if (
            len(text) == len(value)
            and text[1:] == value[1:]
            and text.isalnum()
            and text[0].isalpha()
        ):
            selection.value = text
            selection.evidence = [line.evidence.model_copy(update={"raw": f"SEAL {text}"})]
            return


def scan_bill(pdf, doc: UUID) -> tuple[dict[str, ExtractedField], list[Evidence], bool]:
    fields = {}
    excerpts = []
    is_bill = False
    deadline = monotonic() + 28
    for page in pdf:
        if monotonic() >= deadline:
            break
        lines = read_lines(page, doc, deadline, threshold=0, start=0)
        has_bill_marker = any(BILL.search(line.text) for line in lines)
        is_bill |= has_bill_marker
        found = read_fields(lines)
        if (
            not {"bl_no", "shipper", "consignee", "origin", "destination", "gross_weight"}
            <= (fields | found).keys()
        ):
            alternate = read_lines(
                page,
                doc,
                deadline,
                threshold=2,
                start=len(lines),
                language="eng" if has_bill_marker else "eng+chi_sim",
            )
            is_bill |= any(BILL.search(line.text) for line in alternate)
            for key, value in read_fields(alternate).items():
                found.setdefault(key, value)
            lines.extend(alternate)
        if found.get("seal"):
            refine_seal(page, found["seal"], lines, deadline)
        for key, value in found.items():
            fields.setdefault(key, value)
        if len(excerpts) < 60:
            excerpts.extend(line.evidence for line in lines[: 60 - len(excerpts)])
    return fields, excerpts, is_bill
