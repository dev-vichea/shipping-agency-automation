"""Read text and word positions from one bounded local OCR pass."""

import csv
import os
import subprocess
from collections import defaultdict
from io import StringIO
from time import monotonic

import pymupdf


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
