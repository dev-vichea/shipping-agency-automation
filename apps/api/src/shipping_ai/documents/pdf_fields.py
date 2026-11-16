"""Bind printed labels to values inside positioned PDF regions."""

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime

import pymupdf

from shipping_ai.review.schemas import ExtractedField, FieldCandidate
from shipping_ai.review.values import decimal, field, identity

from .pdf_layout import Layout, Line

TITLES = (
    ("freight_invoice", r"(?:original |copy )?(?:tax invoice|freight invoice|invoice for freight)"),
    ("release_order", r"(?:(?:cargo|delivery) )?release order|delivery order|提货单"),
    ("arrival_notice", r"(?:cargo )?arrival notice|到货通知(?:书)?"),
    ("debit_note", r"debit note"),
    ("fee_statement", r"(?:clearance |freight )?(?:fee statement|statement of charges)"),
    ("packing_list", r"packing list|装箱单"),
    ("invoice", r"commercial invoice|invoice|商业发票"),
    (
        "bill_confirmation",
        r"(?:bill of lading|b/?l) (?:confirmation|draft)|提单确认(?:样本|件)?|提单样本",
    ),
    ("waybill", r"(?:truck |air |sea )?way\s*bill(?: of lading)?"),
    ("bill_of_lading", r"(?:draft |original |copy |ocean |house )?bill of lading|提单"),
)
BILLS = {"bill_of_lading", "bill_confirmation", "waybill"}
LABELS = {
    "bl_no": r"(?:truck )?(?:bill of lading|b\s*/?\s*l|way\s*bill|t\s*/?\s*b)[ .]*(?:no\.?|number)|提单号码?",
    "invoice_no": r"(?:invoice|debit note)[ .]*(?:no\.?|number)|发票号码?",
    "booking_no": r"booking\s*(?:no\.?|number)",
    "shipper": r"(?:shipper(?:\s*/\s*exporter)?|发货人)(?:\s*\(complete name and address\))?",
    "consignee": r"(?:consignee|收货人)(?:\s*\(complete name and address\))?",
    "notify_party": r"(?:notify party|通知人|通知方)(?:\s*\(complete name and address\))?",
    "supplier": r"supplier|seller|exporter|供应商",
    "billed_to": r"(?:bill(?:ed)? to|invoice to|customer(?: name)?)",
    "carrier": r"carrier|signed on behalf of the carrier",
    "origin": r"(?:port|place) of loading|起运港口?|装货港|装船口岸",
    "receipt": r"place of (?:initial )?receipt",
    "discharge": r"(?:port|place) of discharge|卸货港|卸货口岸",
    "delivery": r"(?:(?:final )?place of delivery|final destination)(?!\s*\()",
    "destination_port": r"port of destination|目的港",
    "vessel_voyage": r"vessel\s*/\s*voyage(?:\s*/\s*flag)?",
    "vessel": r"(?:ocean )?vessel(?: name)?|船名",
    "voyage": r"voyage(?:\s*(?:no\.?|number))?|航次",
    "issue_date": r"(?:place and )?date of issue|issue(?:d)? date|签发日期|日期",
    "invoice_date": r"(?:invoice date|date of invoice|发票日期)",
    "on_board_date": r"(?:shipped|laden) on board(?: date(?:d)?)?|date laden on board",
    "eta": r"estimated time of arrival(?:\s*\(eta\))?|estimated arrival|eta(?: at pod)?|预计到港",
    "etd": r"estimated time of departure(?:\s*\(etd\))?|estimated departure|etd|预计离港",
    "packages": r"(?:total (?:no\.?|number) of |no\.? (?:and kind )?of |kind of )?(?:packages?|pkgs?\.?|cartons?|ctns?)|件数|包数|箱数",
    "gross_weight": r"(?:cargo )?gross weight(?: cargo)?|g\.?w\.?|毛重",
    "net_weight": r"net weight|n\.?w\.?|净重",
    "measurement": r"measurement|volume|体积",
    "tare": r"tare",
    "count_unit": r"(?:[（(]?\s*单位\s*[）)]?|unit(?: of measure)?)",
    "cargo_summary": r"description of (?:packages and )?goods(?: as stated by shipper)?|cargo description|brief description|货物描述|品名",
    "container": r"container(?:\s*(?:no\.?|number))|cntr\.?\s*(?:no\.?s?\.?|number)|集装箱号|箱号",
    "container_type": r"container type|箱型和箱量",
    "seal": r"seal(?:\s*(?:no\.?|number))?|封条号|封号",
    "boundary": r"type of shipment|term of service|freight payable at|freight and charges|"
    r"number of original bills|marks and (?:nos\.?|numbers)|export references|"
    r"pre carriage by|loading pier\s*/\s*terminal|运输条款|运输条件|唛头",
}
PATTERNS = [
    (
        key,
        re.compile(
            rf"^(?:{pattern})(?:(?![^\W\d_])|(?<=[\u3400-\u9fff])(?=[A-Za-z]))",
            re.I,
        ),
    )
    for key, pattern in LABELS.items()
]
NUM = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
UNITS = {
    "packages": (
        r"packages?(?:\s*\(s\))?|pkgs?\.?|ctns?|cartons?|rolls?|boxes|件|箱",
        {
            "PKG": "PKG",
            "CTN": "CTN",
            "CARTON": "CTN",
            "ROLL": "ROLL",
            "BOXES": "BOX",
            "件": "PKG",
            "箱": "CTN",
        },
    ),
    "gross_weight": (
        r"kg(?:s)?|kilograms?|lbs?|tonnes?|公斤|千克|吨",
        {
            "KG": "KG",
            "KILOGRAM": "KG",
            "LB": "LB",
            "TONNE": "T",
            "公斤": "KG",
            "千克": "KG",
            "吨": "T",
        },
    ),
    "net_weight": (
        r"kg(?:s)?|kilograms?|lbs?|tonnes?|公斤|千克|吨",
        {
            "KG": "KG",
            "KILOGRAM": "KG",
            "LB": "LB",
            "TONNE": "T",
            "公斤": "KG",
            "千克": "KG",
            "吨": "T",
        },
    ),
    "measurement": (r"cbm|m³|m3", {"CBM": "CBM", "M3": "CBM", "M³": "CBM"}),
}
PARTIES = {"shipper", "consignee", "notify_party", "supplier", "billed_to", "carrier"}
ROUTES = {"origin", "discharge", "delivery", "destination_port", "receipt"}
DATES = {"issue_date", "invoice_date", "on_board_date", "eta", "etd"}
CORP = re.compile(
    r"(?:\bco(?:mpany)?|\bcorp(?:oration)?|\bltd|\blimited|\binc|\bllc|\bpte|\bgmbh|\bsarl|公司)[., )]*$",
    re.I,
)
ADDRESS = re.compile(
    r"^(?:\d+\b|#|address\b|room\b|[\w\d]+ floor\b|p\.?o\.? box|tel\b|fax\b|email\b|mobile\b)|@|\b(?:road|street|postal code|vat no)\b",
    re.I,
)
CONTAINER = re.compile(r"\b[A-Z]{4}[ -]?\d{6}[ -]?\d\b", re.I)
EQUIPMENT = re.compile(r"\b\d+[ ]*[x*][ ]*(?:20|40|45)[ ]*(?:HQ|HC|GP|OT|FR|RF|RH)\b", re.I)
REF = re.compile(r"(?=[A-Z0-9/+ .-]*\d)[A-Z0-9][A-Z0-9/+.-]{2,55}", re.I)
IGNORE_BLOCK = re.compile(
    r"^(?:total\b|no\.?(?: and kind)? of\b|or units\b|as stated by|said to contain|in words|freight\b|shipping marks|container\b|\(continued|load and count\b|/?FCL/|[\d,]+\s*(?:PKGS?|PACKAGES?)\b)",
    re.I,
)


@dataclass(frozen=True)
class Anchor:
    key: str
    line: Line
    tail: Line
    extra: str


def title_role(layout):
    for key, pattern in TITLES:
        for line in layout.lines:
            if line.box.y0 > layout.page.rect.height * 0.43:
                continue
            raw = line.text.strip(" |:*.")
            # A reference such as BILL OF LADING NO is not a primary title.
            if re.fullmatch(pattern, raw, re.I):
                return key
    return None


def anchors(layout):
    output = []
    for line in layout.lines:
        text = line.text
        start = len(text) - len(text.lstrip(" |*\"'"))
        for key, pattern in PATTERNS:
            match = pattern.match(text, start) if start == 0 else pattern.match(text[start:])
            if not match:
                continue
            end = match.end() + start
            header = Line(
                tuple(
                    w
                    for i, w in enumerate(line.tokens)
                    if sum(len(x.text) + 1 for x in line.tokens[:i]) < end
                )
            )
            tail = text[end:].lstrip(" :：|*")
            if (
                key == "packages"
                and not tail
                and re.fullmatch(r"packages?|pkgs?\.?|ctns?", text.strip(" |:"), re.I)
            ):
                break  # A unit printed under a number is not a second heading.
            output.append(Anchor(key, header, line.tail(len(text) - len(tail)), tail))
            break
    return output


def normalized_unit(key, value):
    raw = re.sub(r"\s*\(s\)|\.", "", value, flags=re.I).strip().upper()
    if raw.startswith("PACKAG"):
        return "PKG"
    mapping = UNITS[key][1]
    return mapping.get(raw) or mapping.get(raw.removesuffix("S"))


def numeric(key, text, default=None):
    pattern, _ = UNITS[key]
    match = re.fullmatch(rf"({NUM})\s*({pattern})?", text.strip(" |:："), re.I)
    if not match:
        return None
    amount = decimal(match[1])
    units = normalized_unit(key, match[2]) if match[2] else default
    if amount is None or amount < 0 or not units or (key == "packages" and amount != int(amount)):
        return None
    return format(amount.normalize(), "f"), units


def typed_date(text):
    match = re.search(
        r"\b(?:20\d\d[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/ ](?:[A-Za-z]{3,9}|\d{1,2})[-/ ]20\d\d)\b",
        text,
    )
    if not match:
        return None
    raw = match.group()
    if re.fullmatch(r"20\d\d[-/.]\d{1,2}[-/.]\d{1,2}", raw):
        try:
            return date(*map(int, re.split(r"[-/.]", raw))).isoformat()
        except ValueError:
            return None
    for form in ("%d-%m-%Y", "%d-%b-%Y", "%d-%B-%Y"):
        try:
            return datetime.strptime(re.sub(r"[/ ]", "-", raw), form).date().isoformat()
        except ValueError:
            pass
    return None


def geometry(anchor, labels, layout):
    """Use aligned labels as boundaries between neighboring logical fields."""
    box = anchor.line.box
    height = max(box.height, layout.height)
    cell = layout.cell(anchor.line.tokens[0].x, anchor.line.tokens[0].y)
    if cell:
        x = cell.x0 + min(cell.width / 2, 10)
        below = layout.cell(x, cell.y1 + 4)
        end = cell.y1
        if below and abs(below.x0 - cell.x0) <= 4:
            if below.height <= height * 8:
                end = below.y1
            elif anchor.key == "cargo_summary":
                end = min(below.y1, cell.y1 + height * 7)
        if anchor.key == "cargo_summary" and end - box.y1 < height * 7:
            # Cargo cells can span a code row and the first few description lines.
            end = min(layout.page.rect.height, box.y1 + height * 8)
        return pymupdf.Rect(cell.x0, box.y1 - 1, cell.x1, max(end, box.y1))
    peers = sorted(
        (a for a in labels if a != anchor and abs(a.line.box.y0 - box.y0) < height * 1.4),
        key=lambda a: a.line.box.x0,
    )
    prev = next((p.line.box for p in reversed(peers) if p.line.box.x1 <= box.x0 + 2), None)
    following = next((p.line.box for p in peers if p.line.box.x0 >= box.x1 - 2), None)
    left = max(0, box.x0 - max(12, min(box.width * 0.3, 35)))
    if prev:
        left = max(left, min(box.x0, prev.x1 + 1))
    right = (
        following.x0 - 2
        if following
        else min(layout.page.rect.width, box.x1 + max(90, box.width * 0.55))
    )
    stop = box.y1 + height * (8 if anchor.key in PARTIES | {"cargo_summary"} else 5)
    for label in labels:
        other = label.line.box
        # Keep split unit/measurement headings in the same table band.
        if (
            other.y0 > box.y1 + height * 0.15
            and left <= other.x0 < right
            and label.key not in UNITS
        ):
            stop = min(stop, other.y0 - 1)
    # Separate the printed identifying label itself from the value beneath it.
    return pymupdf.Rect(
        left, box.y1 - height * 0.15, max(right, left + 2), min(stop, layout.page.rect.height)
    )


def value_lines(anchor, labels, layout):
    box = anchor.line.box
    area = geometry(anchor, labels, layout)
    below = layout.region(area, split=True)
    below = [
        line
        for line in below
        if not any(pattern.match(line.text) for _, pattern in PATTERNS)
        or re.fullmatch(r"packages?|pkgs?\.?|ctns?", line.text, re.I)
    ]
    if anchor.extra and anchor.tail.tokens:
        return [anchor.tail, *below]
    cell = layout.cell(anchor.line.tokens[0].x, anchor.line.tokens[0].y)
    if cell:
        adjacent = layout.cell(cell.x1 + 4, anchor.line.tokens[0].y)
        if adjacent and abs(adjacent.y0 - cell.y0) <= 2 and abs(adjacent.y1 - cell.y1) <= 2:
            right_rows = layout.region(adjacent, split=True)
            if right_rows and not any(pattern.match(right_rows[0].text) for _, pattern in PATTERNS):
                inside = [line for line in below if cell.contains(line.box)]
                return (
                    [*below, *right_rows]
                    if anchor.key in UNITS or inside
                    else [*right_rows, *below]
                )
    # An adjacent form cell is often on the same baseline as a label.
    right = [
        line
        for line in layout.lines
        if line.box.x0 >= box.x1 + 2
        and line.box.x0 - box.x1 <= min(125, layout.page.rect.width * 0.22)
        and abs(line.box.y0 - box.y0) <= max(box.height, line.box.height) * 0.55
        and not any(line.box.intersects(other.line.box) for other in labels if other != anchor)
    ]
    if anchor.key in UNITS:
        return below or right[:1]
    if anchor.key in PARTIES:
        return below if below else right[:1]
    if below and below[0].box.x0 <= box.x0 + layout.height * 2:
        return [*below, *right[:1]]
    return [*right[:1], *below]


def contiguous_text(lines, *, party, height):
    result = []
    for line in lines:
        text = line.text.strip(" |:*")
        if (
            not text
            or IGNORE_BLOCK.match(text)
            or (party and ADDRESS.search(text))
            or any(pattern.match(text) for _, pattern in PATTERNS)
        ):
            if result:
                break
            continue
        if sum(c.isalpha() for c in text) < 3:
            if result:
                break
            continue
        if result:
            prior = result[-1]
            if line.box.y0 - prior.box.y1 > height or abs(prior.box.x0 - line.box.x0) > height * 2:
                break
        result.append(line)
        if len(result) >= 4 or (
            party and (CORP.search(text) or re.match(r"same as\b", text, re.I))
        ):
            break
    return result


class Observations:
    def __init__(self):
        self.values: dict[str, list[tuple[int, FieldCandidate]]] = defaultdict(list)
        self.authority = set()

    def add(self, key, value, evidence, rank, *, unit=None, currency=None):
        if not value or not evidence:
            return
        candidate = FieldCandidate(
            value=str(value)[:350], unit=unit, currency=currency, evidence=evidence
        )
        self.values[key].append((rank, candidate))

    def fields(self):
        output = {}
        for key, ranked in self.values.items():
            if not ranked:
                continue
            ranked = sorted(ranked, key=lambda entry: -entry[0])
            options = {}
            for rank, value in ranked:
                numeric_value = decimal(value.value) if key in UNITS else None
                canonical = (
                    numeric_value if numeric_value is not None else identity(value.value),
                    value.unit,
                    value.currency,
                )
                options.setdefault(canonical, (rank, value))
            best, primary = next(iter(options.values()))
            alternatives = [
                option for rank, option in list(options.values())[1:] if rank >= best - 8
            ][:5]
            uncertain = any(e.method != "pdf_text" for e in primary.evidence)
            critical = (
                key in UNITS
                or key in {"bl_no", "invoice_no", "linked_bl", "seal"}
                or key in PARTIES | ROUTES
            )
            conflict = critical and any(rank >= best - 3 for rank, _ in list(options.values())[1:])
            if conflict:
                output[key] = ExtractedField(
                    status="uncertain",
                    alternatives=[primary, *alternatives],
                    evidence=[e for option in [primary, *alternatives] for e in option.evidence][
                        :8
                    ],
                    review_reason="conflicting_source_values",
                )
                continue
            output[key] = field(
                primary.value,
                *primary.evidence,
                unit=primary.unit,
                currency=primary.currency,
                uncertain=uncertain,
            )
            output[key].alternatives = alternatives
            if uncertain:
                output[key].review_reason = "verify_ocr_value"
        return output


def numeric_anchor(observations, layout, labels, anchor, lines, doc, rank):
    key = anchor.key
    pattern = UNITS[key][0]
    dimension = re.fullmatch(rf"\s*\(?({pattern})\)?\s*", anchor.extra, re.I)
    dimension_line = anchor.tail if dimension else None
    if not dimension:
        # "No. of Pkgs." provides a count unit without a separate printed unit cell.
        dimension = re.search(rf"\b({pattern})\s*$", anchor.line.text, re.I)
        dimension_line = anchor.line if dimension else None
    units = normalized_unit(key, dimension[1]) if dimension else None
    for idx, line in enumerate(lines[:6]):
        raw = line.text.strip(" |:*")
        if idx == 0 and anchor.tail.tokens and line == anchor.tail:
            raw = anchor.extra
        if re.fullmatch(pattern, raw, re.I):
            units, dimension_line = normalized_unit(key, raw), line
            continue
        # A labeled row can carry two explicit dimensions in one table cell.
        if match := re.search(rf"(?<![\d.])({NUM})\s*({pattern})(?=\s|/|$)", raw, re.I):
            if match.start() and key != "measurement":
                continue
            raw = match.group(0)
            line = trim_line(line.tail(match.start()), raw)
        if not re.fullmatch(NUM, raw) and not re.fullmatch(rf"{NUM}\s*(?:{pattern})", raw, re.I):
            continue
        citations = [line]
        if re.fullmatch(NUM, raw):
            unit_line = next(
                (
                    other
                    for other in lines[idx + 1 : idx + 3]
                    if re.fullmatch(pattern, other.text.strip(" |:*"), re.I)
                ),
                None,
            )
            if unit_line is None and key == "packages":
                area = geometry(anchor, labels, layout)
                side = [
                    a
                    for a in labels
                    if a.key == "count_unit"
                    and abs(a.line.box.y0 - anchor.line.box.y0) <= layout.height * 1.5
                    and abs(a.line.box.x0 - area.x1) <= layout.height * 2
                ]
                if side:
                    unit_line = next(
                        (
                            row
                            for row in value_lines(side[0], labels, layout)
                            if re.fullmatch(pattern, row.text.strip(" |:*"), re.I)
                        ),
                        None,
                    )
            if unit_line:
                units = normalized_unit(key, unit_line.text)
                citations.append(unit_line)
            elif dimension_line:
                citations.append(dimension_line)
        parsed = numeric(key, raw, units)
        if parsed:
            value, unit = parsed
            observations.add(key, value, layout.evidence(doc, citations), rank, unit=unit)
            return


def trim_line(line, value):
    # Preserve full tokens (including punctuation) when a source token contains the whole pair.
    if not value:
        return line
    for end in range(1, len(line.tokens) + 1):
        first = Line(line.tokens[:end])
        if identity(first.text).startswith(identity(value)):
            return first
    return line


def collect_fields(layout: Layout, doc, obs: Observations, kind, *, rank=90):
    labels = anchors(layout)
    used = set()
    for anchor in labels:
        key = anchor.key
        if key in {"tare", "count_unit", "receipt", "boundary"}:
            continue
        if key in PARTIES and key in used:
            continue  # Delivery contacts further down are distinct from header parties.
        used.add(key)
        obs.authority.add(key)
        lines = value_lines(anchor, labels, layout)
        if key in UNITS:
            numeric_anchor(obs, layout, labels, anchor, lines, doc, rank)
            continue
        if key in PARTIES | {"cargo_summary"}:
            if anchor.extra.startswith(("(", ",")):
                lines = [line for line in lines if line != anchor.tail]
            multi = contiguous_text(lines, party=key in PARTIES, height=layout.height)
            if multi:
                if key in PARTIES:
                    # OCR can fuse a logo or neighboring column into the same visual line.
                    tokens = multi[-1].tokens
                    last = next(
                        (
                            i
                            for i in range(1, len(tokens))
                            if re.search(
                                r"(?:\blimited|\bltd|\binc|\bllc|\bgmbh)\.?$",
                                tokens[i - 1].text,
                                re.I,
                            )
                        ),
                        None,
                    )
                    if last and multi[-1] != anchor.tail:
                        multi[-1] = Line(tokens[:last])
                joiner = " " if key in PARTIES else " / "
                value = joiner.join(
                    (anchor.extra if line == anchor.tail else line.text).strip(" |:")
                    for line in multi
                )
                quality = (
                    0
                    if key not in PARTIES
                    or CORP.search(value)
                    or re.match(r"same as\b", value, re.I)
                    else -4
                )
                obs.add(key, value, layout.evidence(doc, multi), rank + quality)
            continue
        for line in lines[:5]:
            raw = anchor.extra if line == anchor.tail else line.text.strip(' |:*"')
            if not raw or IGNORE_BLOCK.match(raw):
                continue
            if key in DATES:
                value = typed_date(raw)
            elif key in {"bl_no", "invoice_no", "booking_no", "seal", "voyage"}:
                value = raw if REF.fullmatch(raw) else None
            elif key == "container":
                value = re.sub(r"[ -]", "", raw) if CONTAINER.fullmatch(raw) else None
            elif key == "container_type":
                value = raw if EQUIPMENT.search(raw) else None
            elif key in ROUTES | {"vessel", "vessel_voyage"}:
                value = (
                    raw
                    if len(raw) <= 72
                    and sum(c.isalpha() for c in raw) >= 3
                    and not any(pattern.match(raw) for _, pattern in PATTERNS)
                    else None
                )
            else:
                value = None
            if value:
                output_key = "linked_bl" if key == "bl_no" and kind not in BILLS else key
                if key == "vessel_voyage":
                    combined = re.fullmatch(r"(.+?)\s+([A-Z0-9/-]*\d[A-Z0-9/-]*)", value, re.I)
                    if combined:
                        obs.add(
                            "vessel",
                            combined[1],
                            layout.evidence(doc, [trim_line(line, combined[1])]),
                            rank,
                        )
                        obs.add(
                            "voyage",
                            combined[2],
                            layout.evidence(doc, [line.tail(combined.start(2))]),
                            rank,
                        )
                        break
                obs.add(output_key, value, layout.evidence(doc, [line]), rank)
                break

    if kind in BILLS:
        collect_cargo(layout, doc, obs, rank - 9)
    return labels


def collect_cargo(layout, doc, obs, rank):
    for line in layout.lines:
        text = line.text
        if container := CONTAINER.search(text):
            evidence = layout.evidence(doc, [line])
            obs.add("container", re.sub(r"[ -]", "", container[0]), evidence, rank)
            after = re.match(r"\s*/\s*([A-Z0-9-]{4,22})(?=\s*/|$)", text[container.end() :], re.I)
            if after and REF.fullmatch(after[1]) and not EQUIPMENT.fullmatch(after[1]):
                obs.add("seal", after[1], evidence, rank)
        if equipment := EQUIPMENT.search(text):
            obs.add(
                "container_type",
                re.sub(r"\s+", "", equipment[0]).replace("*", "X"),
                layout.evidence(doc, [line]),
                rank,
            )
        pattern = UNITS["packages"][0]
        for match in re.finditer(rf"(?<![\w.])({NUM})\s*({pattern})(?![\w])", text, re.I):
            value = numeric("packages", match.group(0))
            if value:
                span = trim_line(line.tail(match.start()), match.group(0))
                obs.add(
                    "packages", value[0], layout.evidence(doc, [span]), rank + 13, unit=value[1]
                )


def collect_tables(layout, doc, obs):
    """Read the first data row adjoining a ruled cargo summary heading."""
    if not layout.words:
        return
    try:
        tables = layout.page.find_tables().tables
    except (ValueError, RuntimeError):
        return
    matrix = layout.page.rotation_matrix
    for table in tables[:16]:
        for index, row in enumerate(table.rows[:25]):
            cells = [pymupdf.Rect(cell) * matrix if cell else None for cell in row.cells]
            headers = [
                " ".join(line.text for line in layout.region(cell)).strip() if cell else ""
                for cell in cells
            ]
            numeric_keys = {
                col: key
                for col, header in enumerate(headers)
                for key in UNITS
                if header and re.match(LABELS[key], header, re.I)
            }
            if not numeric_keys or index + 1 == len(table.rows):
                continue
            next_cells = table.rows[index + 1].cells
            for col, key in numeric_keys.items():
                if col >= len(next_cells) or not next_cells[col]:
                    continue
                lines = layout.region(pymupdf.Rect(next_cells[col]) * matrix)
                if not lines:
                    continue
                header_lines = layout.region(cells[col])
                label = header_lines[0] if header_lines else lines[0]
                fake = Anchor(key, label, Line(()), headers[col].strip())
                unit_col = next(
                    (
                        i
                        for i, h in enumerate(headers)
                        if re.fullmatch(LABELS["count_unit"], h, re.I)
                    ),
                    None,
                )
                if key == "packages" and unit_col is not None and next_cells[unit_col]:
                    lines.extend(layout.region(pymupdf.Rect(next_cells[unit_col]) * matrix))
                if key != "packages":
                    unit_match = re.search(
                        rf"(?<![\w])({UNITS[key][0]})(?![\w])", headers[col], re.I
                    )
                    if unit_match:
                        fake = Anchor(key, label, label, unit_match[1])
                numeric_anchor(obs, layout, [], fake, lines, doc, 99)
