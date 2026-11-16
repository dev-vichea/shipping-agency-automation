"""Read text and word positions from one bounded local OCR pass."""

import os
import subprocess
from collections import defaultdict
from time import monotonic

import pymupdf


def tsv_words(payload: bytes, x_offset: int, y_offset: int, scale: float):
    """Tesseract writes literal TSV. Quotes in recognized text are ordinary characters."""
    lines = defaultdict(list)
    for line in payload.decode(errors="replace").split("\n"):
        columns = line.rstrip("\r").split("\t", 11)
        if len(columns) != 12 or columns[0] != "5" or not columns[11].strip():
            continue
        try:
            left, top, width, height = map(int, columns[6:10])
            confidence = float(columns[10])
        except ValueError:
            continue
        if min(left, top) < 0 or min(width, height) <= 0 or not 0 <= confidence <= 100:
            continue
        x, y = left + x_offset, top + y_offset
        rect = pymupdf.Rect(x / scale, y / scale, (x + width) / scale, (y + height) / scale)
        lines[tuple(columns[2:5])].append((rect, columns[11].strip(), confidence))
    return lines


def ocr_words(page, clip, *, scale, segmentation, deadline, threshold=0, language="eng"):
    if monotonic() >= deadline:
        raise subprocess.TimeoutExpired("tesseract", 0)
    if clip.is_empty:
        return {}
    scale = min(scale, (12_000_000 / clip.get_area()) ** 0.5)
    pix = page.get_pixmap(
        matrix=pymupdf.Matrix(scale, scale),
        clip=clip,
        colorspace=pymupdf.csGRAY,
        alpha=False,
    )
    remaining = deadline - monotonic()
    if remaining <= 0:
        raise subprocess.TimeoutExpired("tesseract", 0)
    result = subprocess.run(
        [
            "tesseract",
            "stdin",
            "stdout",
            "-l",
            language,
            "--psm",
            str(segmentation),
            "-c",
            f"thresholding_method={threshold}",
            "tsv",
        ],
        input=pix.tobytes("png"),
        capture_output=True,
        check=True,
        timeout=min(8.0, remaining),
        env={**os.environ, "OMP_THREAD_LIMIT": "1"},
    )
    return tsv_words(result.stdout, pix.x, pix.y, scale)
