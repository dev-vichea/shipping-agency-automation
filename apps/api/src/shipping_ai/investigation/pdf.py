"""Read a single scoped, checksum-verified B/L and locate package count evidence."""

import csv
import re
import subprocess
from collections import defaultdict
from contextlib import contextmanager
from hashlib import sha256
from io import StringIO
from time import monotonic

import pymupdf

from shipping_ai.documents.storage import LocalStorage

from .schemas import Observation, Reason, StepResult

# Require a package count with unit, matching standalone lines or package table cells.
COUNT = r"([0-9]{1,9}|[0-9]{1,3}(?:,[0-9]{3}){1,2})"
UNIT = r"(?:PKGS?|PACKAGES?(?:\s*\(S\))?|CTNS?|CARTONS?|件(?:数)?|包(?:数)?)"
PACKAGE_LINE = re.compile(
    rf"(?:(?:TOTAL\s+|NO\.?\s+OF\s+)?{UNIT}\s*[:：]?\s*{COUNT}(?:\s+{UNIT})?"
    rf"|{COUNT}\s+{UNIT})",
    re.I,
)
MAX_PAGES = 6
MAX_OBSERVATIONS = 12
OCR_CONFIDENCE = 80
OCR_TIMEOUT = 25.0


class EvidenceUnavailable(Exception):
    def __init__(self, code: Reason):
        self.code = code


@contextmanager
def open_bill(store: LocalStorage, document):
    try:
        with store.path(document.storage_key).open("rb") as original:
            data = original.read(document.size_bytes + 1)
    except OSError:
        raise EvidenceUnavailable("archive_unavailable") from None
    if len(data) != document.size_bytes or sha256(data).hexdigest() != document.sha256:
        raise EvidenceUnavailable("archive_checksum_mismatch")
    try:
        pdf = pymupdf.open(stream=data, filetype="pdf")
    except (pymupdf.FileDataError, ValueError):
        raise EvidenceUnavailable("unreadable_pdf") from None
    with pdf:
        if pdf.needs_pass or not 1 <= pdf.page_count <= MAX_PAGES:
            raise EvidenceUnavailable("unsupported_pdf")
        # Rotated pages need explicit coordinate transforms for OCR cropping.
        if any(page.rotation or max(page.rect.width, page.rect.height) > 1000 for page in pdf):
            raise EvidenceUnavailable("unsupported_pdf")
        yield pdf


def locate(lines, method, page):
    for words in lines.values():
        raw = " ".join(word[1] for word in words)
        match = PACKAGE_LINE.search(raw)
        if match is None:
            continue
        count = next(value for value in match.groups() if value is not None)
        m_start, m_end = match.start(), match.end()
        matched_words = []
        char_pos = 0
        for w_rect, w_text, w_conf in words:
            w_start = char_pos
            w_end = char_pos + len(w_text)
            char_pos = w_end + 1
            if w_end > m_start and w_start < m_end:
                matched_words.append((w_rect, w_text, w_conf))
        target_words = matched_words if matched_words else words
        box = pymupdf.Rect(target_words[0][0])
        for rect, _, _ in target_words[1:]:
            box |= rect
        if box.is_empty:
            continue
        yield Observation(
            page=page,
            bbox=tuple(round(value, 2) for value in box),
            method=method,
            raw=raw,
            value=str(int(count.replace(",", ""))),
            confidence=None if method == "pdf_text" else min(word[2] for word in target_words),
        )


def pdf_text(pdf) -> StepResult:
    observations = []
    for page in pdf:
        lines = defaultdict(list)
        for *rect, word, block, line, _ in page.get_text("words"):
            lines[block, line].append((pymupdf.Rect(rect), word, None))
        observations.extend(locate(lines, "pdf_text", page.number + 1))
    return summarize(observations)


def summarize(observations):
    return StepResult(
        observations=observations[:MAX_OBSERVATIONS],
        ambiguous=(
            len(observations) > MAX_OBSERVATIONS or len({item.value for item in observations}) > 1
        ),
    )


def ocr_page(page, clip, *, scale, segmentation, deadline):
    if monotonic() >= deadline:
        raise EvidenceUnavailable("time_limit")
    pix = page.get_pixmap(
        matrix=pymupdf.Matrix(scale, scale),
        clip=clip,
        colorspace=pymupdf.csGRAY,
        alpha=False,
    )
    remaining = deadline - monotonic()
    if remaining <= 0:
        raise EvidenceUnavailable("time_limit")
    try:
        result = subprocess.run(
            ["tesseract", "stdin", "stdout", "-l", "eng+chi_sim", "--psm", str(segmentation), "tsv"],
            input=pix.tobytes("png"),
            capture_output=True,
            check=True,
            timeout=min(OCR_TIMEOUT, remaining),
        )
    except subprocess.TimeoutExpired:
        raise EvidenceUnavailable("ocr_timeout") from None
    except (OSError, subprocess.CalledProcessError):
        raise EvidenceUnavailable("ocr_unavailable") from None
    lines = defaultdict(list)
    for row in csv.DictReader(StringIO(result.stdout.decode(errors="replace")), delimiter="\t"):
        if row["level"] != "5" or not row["text"].strip():
            continue
        x, y = int(row["left"]) + pix.x, int(row["top"]) + pix.y
        width, height = int(row["width"]), int(row["height"])
        rect = pymupdf.Rect(x / scale, y / scale, (x + width) / scale, (y + height) / scale)
        key = row["block_num"], row["par_num"], row["line_num"]
        lines[key].append((rect, row["text"].strip(), float(row["conf"])))
    return lines


def ocr_scan(pdf, deadline):
    observations = []
    for page in pdf:
        lines = ocr_page(page, page.rect, scale=3, segmentation=11, deadline=deadline)
        observations.extend(locate(lines, "ocr_scan", page.number + 1))
    return summarize(observations)


def ocr_focused(pdf, source: Observation, deadline):
    page = pdf[source.page - 1]
    rect = pymupdf.Rect(source.bbox)
    clip = (rect + (-12, -3, 12, 3)) & page.rect
    lines = ocr_page(page, clip, scale=4, segmentation=7, deadline=deadline)
    return summarize(list(locate(lines, "ocr_focused", source.page)))
