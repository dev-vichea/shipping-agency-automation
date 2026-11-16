"""Positioned PDF text shared by native extraction, OCR, and evidence rendering."""

from dataclasses import dataclass
from itertools import groupby
from statistics import median
from uuid import UUID

import pymupdf

from shipping_ai.review.schemas import Evidence
from shipping_ai.review.values import clean, identity


@dataclass(frozen=True)
class Token:
    box: pymupdf.Rect
    text: str
    method: str = "pdf_text"
    confidence: float | None = None
    group: tuple[str, ...] | None = None

    @property
    def y(self):
        return (self.box.y0 + self.box.y1) / 2

    @property
    def x(self):
        return (self.box.x0 + self.box.x1) / 2


@dataclass(frozen=True)
class Line:
    tokens: tuple[Token, ...]

    @property
    def text(self):
        return " ".join(word.text for word in self.tokens)

    @property
    def box(self):
        return union(word.box for word in self.tokens)

    def tail(self, offset: int):
        """Retain the source words that intersect the captured value."""
        end = 0
        for i, word in enumerate(self.tokens):
            end += len(word.text)
            if end > offset:
                return Line(self.tokens[i:])
            end += 1
        return Line(())


def union(rects):
    rect = pymupdf.Rect()
    for other in rects:
        rect |= other
    return rect


def native_tokens(page):
    return [
        Token(pymupdf.Rect(word[:4]) * page.rotation_matrix, value)
        for word in page.get_text("words")
        if (value := clean(word[4])) and value.count("\ufffd") == 0
    ]


def ocr_tokens(groups, method):
    return [
        Token(box, value, method, confidence, key)
        for key, group in groups.items()
        for box, text, confidence in group
        if (value := clean(text)) and confidence >= 15
    ]


def hybrid_tokens(native, ocr):
    """Use native words in a shared region. Keep OCR labels outside the native overlay."""
    native_rows = visual_rows(native)
    result = list(native)
    for word in ocr:
        nearby = [
            source
            for row in native_rows
            if abs(row[0].y - word.y) <= max(word.box.height, row[0].box.height)
            for source in row
            if abs(source.y - word.y) <= word.box.height / 2
        ]
        if any(
            (source.box & word.box).width >= min(source.box.width, word.box.width) * 0.35
            for source in nearby
        ):
            continue
        result.append(word)
    return result


def visual_rows(words):
    rows: list[list[Token]] = []
    for word in sorted(words, key=lambda token: (token.y, token.box.x0)):
        match = next(
            (
                row
                for row in reversed(rows[-8:])
                if abs(row[0].y - word.y)
                <= max(2.0, min(row[0].box.height, word.box.height) * 0.48)
            ),
            None,
        )
        if match is None:
            rows.append([word])
        else:
            match.append(word)
    return [sorted(row, key=lambda token: token.box.x0) for row in rows]


def lines_for(words, *, split=True, vertical=()):
    lines = []
    for row in visual_rows(words):
        segment: list[Token] = []
        for word in row:
            if segment and split:
                prior = segment[-1]
                gap = word.box.x0 - prior.box.x1
                crosses_rule = any(
                    prior.x < x < word.x and top < word.y < bottom for x, top, bottom in vertical
                )
                if crosses_rule or gap > max(8, min(prior.box.height, word.box.height) * 0.9):
                    lines.append(Line(tuple(segment)))
                    segment = []
            segment.append(word)
        lines.append(Line(tuple(segment)))
    return lines


class Layout:
    def __init__(self, page, words):
        self.page = page
        self.words = words
        self.vertical, self.horizontal = rules(page) if words else ([], [])
        self.lines = lines_for(words, vertical=self.vertical)
        self.height = median(token.box.height for token in words) if words else 10

    def region(self, rect, *, split=False):
        return lines_for(
            (word for word in self.words if rect.contains(pymupdf.Point(word.x, word.y))),
            split=split,
            vertical=self.vertical,
        )

    def cell(self, x, y):
        columns = [rule for rule, low, high in self.vertical if low + 1 < y < high - 1]
        rows = [rule for rule, low, high in self.horizontal if low + 1 < x < high - 1]
        left = max((rule for rule in columns if rule < x), default=None)
        right = min((rule for rule in columns if rule > x), default=None)
        top = max((rule for rule in rows if rule < y), default=None)
        bottom = min((rule for rule in rows if rule > y), default=None)
        if None in (left, top, right, bottom):
            return None
        rect = pymupdf.Rect(left, top, right, bottom)
        if rect.width > 10 and rect.height > 5:
            return rect
        return None

    def evidence(self, document_id: UUID, lines: list[Line]) -> list[Evidence]:
        """Keep separate rectangles for disjoint spans, with one citation per page."""
        tokens = [word for line in lines for word in line.tokens]
        if not tokens:
            return []
        page = self.page.rect
        boxes = []
        for line in lines:
            # Text within a line can come from different columns, e.g. number and unit.
            for _, words in groupby(line.tokens, key=lambda token: token.method):
                segment = []
                for word in words:
                    if segment and word.box.x0 - segment[-1].box.x1 > max(8, self.height):
                        boxes.append(union(w.box for w in segment))
                        segment = []
                    segment.append(word)
                if segment:
                    boxes.append(union(w.box for w in segment))

        def normalize(box):
            box = box & page
            return (
                box.x0 / page.width,
                box.y0 / page.height,
                box.width / page.width,
                box.height / page.height,
            )

        boxes = [box for box in boxes if not (box & page).is_empty]
        if not boxes:
            return []
        methods = {token.method for token in tokens}
        confidence = min((t.confidence for t in tokens if t.confidence is not None), default=None)
        return [
            Evidence(
                document_id=document_id,
                page=self.page.number + 1,
                raw="\n".join(line.text for line in lines)[:2000],
                bbox=normalize(union(boxes)),
                boxes=[normalize(box) for box in boxes] if len(boxes) > 1 else [],
                method="ocr_retry"
                if "ocr_retry" in methods
                else "ocr"
                if "ocr" in methods
                else "pdf_text",
                confidence=confidence,
            )
        ]

    def locate(self, value):
        """Resolve a flat parser value only when its complete normalized text can be located."""
        expected = identity(value)
        if not expected:
            return []
        for line in self.lines:
            for i, word in enumerate(line.tokens):
                fragment = identity(word.text)
                if not fragment or fragment[0] != expected[0]:
                    continue
                for j in range(i + 1, min(len(line.tokens), i + 28) + 1):
                    span = Line(line.tokens[i:j])
                    actual = identity(span.text)
                    if actual == expected:
                        return [span]
                    if not expected.startswith(actual):
                        break
        return []


def rules(page):
    vertical, horizontal = [], []
    matrix = page.rotation_matrix

    def add(start, stop):
        a, b = pymupdf.Point(start) * matrix, pymupdf.Point(stop) * matrix
        if abs(a.x - b.x) < 0.7 and abs(a.y - b.y) >= 8:
            vertical.append(((a.x + b.x) / 2, min(a.y, b.y), max(a.y, b.y)))
        if abs(a.y - b.y) < 0.7 and abs(a.x - b.x) >= 12:
            horizontal.append(((a.y + b.y) / 2, min(a.x, b.x), max(a.x, b.x)))

    for drawing in page.get_cdrawings()[:400]:
        for command, *coords in drawing["items"][:150]:
            if command == "l":
                add(*coords)
            elif command == "re":
                rect = pymupdf.Rect(coords[0])
                if rect.width >= 12 and rect.height <= 2:
                    add(rect.tl, rect.tr)
                elif rect.height >= 8 and rect.width <= 2:
                    add(rect.tl, rect.bl)
                elif drawing["type"] != "f":
                    for a, b in (
                        (rect.tl, rect.tr),
                        (rect.tl, rect.bl),
                        (rect.tr, rect.br),
                        (rect.bl, rect.br),
                    ):
                        add(a, b)
    return vertical[:800], horizontal[:800]
