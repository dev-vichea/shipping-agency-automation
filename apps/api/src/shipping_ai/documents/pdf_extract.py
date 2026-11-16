"""Classify positioned documents, then recover bounded, source-backed field candidates."""

import re
import subprocess
from collections import defaultdict
from decimal import Decimal
from time import monotonic

import pymupdf

from shipping_ai.review.schemas import ExtractedField, Extraction, FieldCandidate
from shipping_ai.review.values import UNIT_ALIASES, decimal, field, folded

from .bill_scan import read_fields as read_scan_fields
from .bill_scan import scan_lines
from .languages import column_map, languages
from .ocr import ocr_words
from .pdf_fields import (
    BILLS,
    CONTAINER,
    UNITS,
    Observations,
    anchors,
    collect_fields,
    collect_tables,
    geometry,
    normalized_unit,
    numeric_anchor,
    title_role,
    value_lines,
)
from .pdf_items import collect_items, positioned_headers, raw
from .pdf_layout import Layout, hybrid_tokens, native_tokens, ocr_tokens

MAX_PAGES = 12
MAX_OCR_PAGES = 3
MAX_RECOVERY_CROPS = 5
OCR_SECONDS = 28
MULTILINGUAL_OCR = "eng+khm+chi_sim+chi_tra"
PRIMARY_FIELDS = (
    "bl_no",
    "shipper",
    "consignee",
    "origin",
    "discharge",
    "packages",
    "gross_weight",
)
RETRY_FIELDS = (*PRIMARY_FIELDS, "cargo_summary", "measurement", "voyage", "seal")
LEGACY_FALLBACK = {
    "bl_no",
    "shipper",
    "consignee",
    "booking_no",
    "vessel",
    "voyage",
    "issue_date",
    "packages",
    "gross_weight",
    "net_weight",
    "container",
    "seal",
    "cargo_summary",
}
MODE = re.compile(
    r"\b(?:by (sea|truck|air|road)|ocean vessel|truck way\s*bill|air way\s*bill)\b", re.I
)


class PDFLimit(ValueError):
    pass


def ocr_language(words):
    hints = set(languages(" ".join(word.text for word in words)))
    models = []
    if "km" in hints:
        models.append("khm")
    if "zh" in hints:
        models.extend(("chi_sim", "chi_tra"))
    return "+".join((*models, "eng"))


def run_ocr(page, clip, deadline, attempts, *, key=None, threshold=0, language="eng", segmentation=None):
    crop = key is not None
    event = {"page": page.number + 1, "field": key, "stage": "crop" if crop else "page", "language": language}
    try:
        if monotonic() >= deadline:
            event["outcome"] = "budget_exhausted"
            return []
        groups = ocr_words(
            page,
            clip,
            scale=(400 if crop else 250) / 72,
            segmentation=segmentation or (6 if crop else 11),
            deadline=deadline,
            threshold=threshold,
            language=language,
        )
        tokens = [
            word
            for word in ocr_tokens(groups, "ocr_retry" if crop else "ocr")
            if clip.contains(pymupdf.Point(word.x, word.y))
        ]
        event["outcome"] = "read" if tokens else "empty"
        return tokens
    except subprocess.TimeoutExpired:
        event["outcome"] = "timed_out"
    except (OSError, subprocess.CalledProcessError):
        event["outcome"] = "unavailable"
    finally:
        attempts.append(event)
    return []


def sparse(layout):
    return sum(len(word.text) for word in layout.words) < 50


def image_layer(page):
    return any(
        ((pymupdf.Rect(image["bbox"]) * page.rotation_matrix) & page.rect).get_area()
        >= 0.65 * page.rect.get_area()
        for image in page.get_image_info()
    )


def form_anchors(layout):
    return {anchor.key for anchor in anchors(layout)}


def needs_ocr(layout, kind):
    if sparse(layout) and not layout.words:
        return image_layer(layout.page) or bool(layout.page.get_drawings())
    if not image_layer(layout.page):
        return False
    if sparse(layout) or not kind:
        return True
    keys = form_anchors(layout)
    if kind in BILLS:
        return not {"bl_no", "shipper", "consignee"} <= keys
    if kind in {"invoice", "packing_list"}:
        return not {"supplier", "consignee"} <= keys or not positioned_headers(layout)
    return False


def needs_multilingual_retry(layout, kind):
    if not kind:
        return True
    if kind in {"invoice", "packing_list"}:
        keys = form_anchors(layout)
        return not {"supplier", "consignee"} <= keys or not positioned_headers(layout)
    return False


def recover(layout, labels, kind, doc, obs, deadline, attempts, remaining):
    if kind not in BILLS or not remaining:
        return remaining
    status = obs.fields()
    selections = {}
    for anchor in labels:
        key = anchor.key
        current = status.get(key)
        if key not in RETRY_FIELDS or (
            current
            and current.value
            and all(e.confidence is None or e.confidence >= 64 for e in current.evidence)
        ):
            continue
        if current and len(current.alternatives) > 1:
            continue
        selections.setdefault(key, anchor)
    for key in RETRY_FIELDS:
        if key not in selections or not remaining or monotonic() >= deadline:
            continue
        anchor = selections[key]
        area = geometry(anchor, labels, layout)
        label_box = anchor.line.box
        clip = (area | label_box) + (-3, -2, 3, 2)
        clip &= layout.page.rect
        if clip.is_empty or clip.get_area() > layout.page.rect.get_area() * 0.22:
            continue
        remaining -= 1
        tokens = run_ocr(layout.page, clip, deadline, attempts, key=key, language=ocr_language(layout.words))
        if not tokens:
            continue
        revised = Layout(
            layout.page,
            hybrid_tokens(
                [
                    word
                    for word in layout.words
                    if word.method == "pdf_text" and clip.contains(pymupdf.Point(word.x, word.y))
                ],
                tokens,
            ),
        )
        recovered = Observations()
        collect_fields(revised, doc, recovered, kind, rank=90)
        if key in UNITS and key not in recovered.values:
            numeric_anchor(
                recovered, revised, labels, anchor, value_lines(anchor, labels, revised), doc, 90
            )
        obs.values[key].extend(recovered.values.get(key, []))
        attempts[-1]["outcome"] = "candidate_found" if recovered.values.get(key) else "no_candidate"
    return remaining


def recover_item_cells(layout, doc, items, deadline, attempts, remaining):
    """Retry missing table cells using the detected header columns and item row boxes."""
    headers = positioned_headers(layout)
    columns = column_map([folded(raw(cell)) for cell in headers], ocr=True)
    if not columns or not remaining:
        return remaining
    starts = [min(line.box.x0 for line in cell) for cell in headers]
    page = layout.page
    height = layout.height
    language = ocr_language(layout.words)
    for item in items:
        source = item.fields["description"].evidence[0]
        _, y, _, span = source.bbox
        for key in ("quantity", "unit"):
            if not remaining or monotonic() >= deadline:
                return remaining
            if key not in columns or item.fields[key].value:
                continue
            index = columns[key]
            left = starts[index] - height * .45
            right = (
                starts[index + 1] - height * .45 if index + 1 < len(starts)
                else min(page.rect.width, starts[index] + height * 9)
            )
            top = y * page.rect.height - height * .22
            bottom = (y + span) * page.rect.height + height * .65
            clip = pymupdf.Rect(left, top, right, bottom) & page.rect
            if clip.is_empty:
                continue
            remaining -= 1
            tokens = run_ocr(
                page, clip, deadline, attempts, key=key, language=language,
                threshold=2, segmentation=7,
            )
            retry = Layout(page, tokens)
            text = raw(retry.lines)
            if key == "quantity":
                number = decimal(text)
                value = format(number, "f") if number is not None and number >= 0 else None
            else:
                value = UNIT_ALIASES.get(folded(text)) or UNIT_ALIASES.get(folded(text).replace(" ", ""))
            if not value:
                attempts[-1]["outcome"] = "no_candidate"
                continue
            evidence = retry.evidence(doc, retry.lines)
            price, amount = (item.fields[name] for name in ("unit_price", "amount"))
            if (
                key == "quantity" and price.value and amount.value and price.currency
                and price.currency == amount.currency
                and abs(number * decimal(price.value) - decimal(amount.value)) > Decimal("0.01")
            ):
                item.fields[key] = ExtractedField(
                    status="uncertain", evidence=evidence,
                    alternatives=[FieldCandidate(value=value, evidence=evidence)],
                    review_reason="ocr_quantity_conflicts_with_printed_amount",
                )
                attempts[-1]["outcome"] = "candidate_conflict"
            else:
                item.fields[key] = field(value, *evidence, uncertain=True)
                item.fields[key].review_reason = "verify_ocr_value"
                attempts[-1]["outcome"] = "candidate_found"
        using = item.fields["unit"]
        for key in ("quantity", "unit_price"):
            value = item.fields[key]
            if value.value and not value.unit and using.value:
                value.unit = using.value
                value.evidence.extend(using.evidence)
    return remaining


def legacy_candidates(data, name, doc, layouts, obs, legacy):
    old = legacy(data, name, doc, "draft_bl")
    for key in LEGACY_FALLBACK & old.fields.keys():
        value = old.fields[key]
        if obs.values[key] or not value.value:
            continue
        if key == "container" and not CONTAINER.fullmatch(value.value):
            continue
        if key in {"shipper", "consignee"} and value.status != "present":
            continue
        # It is only a fallback for values that can be placed back on the page.
        for layout in layouts:
            lines = []
            if key in UNITS:
                for citation in value.evidence:
                    if citation.page != layout.page.number + 1 or not citation.raw:
                        continue
                    raw = citation.raw
                    match = re.search(
                        rf"(?<![\d.])([\d,.]+)\s*({UNITS[key][0]})(?![\w])",
                        raw,
                        re.I,
                    )
                    if match and normalized_unit(key, match[2]) == value.unit:
                        lines = layout.locate(match.group(0))
                        if lines:
                            break
            else:
                lines = layout.locate(value.value)
            if lines:
                obs.add(key, value.value, layout.evidence(doc, lines), 65, unit=value.unit)
                break


def scan_candidates(layout, doc, observations):
    """Retain bounded candidates from OCR's own line clusters when visual grouping fails."""
    groups = defaultdict(list)
    for token in layout.words:
        if token.group is not None:
            groups[token.group].append((token.box, token.text, token.confidence))
    fields = read_scan_fields(scan_lines(layout.page, doc, groups))
    for source_key in (
        "bl_no",
        "packages",
        "gross_weight",
        "net_weight",
        "origin",
        "destination",
        "shipper",
        "consignee",
        "issue_date",
        "cargo_summary",
    ):
        candidate = fields.get(source_key)
        key = "discharge" if source_key == "destination" else source_key
        current = observations.fields().get(key)
        if not candidate or not candidate.value or (current and current.value):
            continue
        lines = []
        for evidence in candidate.evidence:
            if not evidence.bbox:
                continue
            x, y, w, h = evidence.bbox
            width, height = layout.page.rect.width, layout.page.rect.height
            rect = pymupdf.Rect(
                x * width - 0.4, y * height - 0.4, (x + w) * width + 0.4, (y + h) * height + 0.4
            )
            lines.extend(layout.region(rect))
        if not lines:
            continue
        if key in UNITS and not any(re.search(UNITS[key][0], line.text, re.I) for line in lines):
            box = lines[0].box
            units = [
                line
                for line in layout.lines
                if normalized_unit(key, line.text) == candidate.unit
                and abs(line.box.x0 - box.x0) <= max(layout.height, box.width * 0.5)
                and abs(line.box.y0 - box.y0) <= layout.height * 3
            ]
            if not units:
                continue
            lines.append(min(units, key=lambda line: abs(line.box.y0 - box.y0)))
        rank = 88 if current and current.review_reason == "conflicting_source_values" else 85
        observations.add(
            key, candidate.value, layout.evidence(doc, lines), rank, unit=candidate.unit
        )


def extract_positioned_pdf(data, name, doc, classification, legacy):
    with pymupdf.open(stream=data, filetype="pdf") as pdf:
        if pdf.needs_pass:
            raise PDFLimit("encrypted_pdf")
        if not 1 <= pdf.page_count <= MAX_PAGES or any(
            min(page.rect.width, page.rect.height) <= 0
            or max(page.rect.width, page.rect.height) > 1800
            for page in pdf
        ):
            raise PDFLimit("pdf_limit")

        native = [Layout(page, native_tokens(page)) for page in pdf]
        kind = next((kind for layout in native if (kind := title_role(layout))), None)
        deadline = monotonic() + OCR_SECONDS
        attempts = []
        layouts = []
        ocr_pages = 0
        for layout in native:
            if needs_ocr(layout, title_role(layout)) and ocr_pages < MAX_OCR_PAGES:
                ocr_pages += 1
                page = layout.page
                language = ocr_language(layout.words)
                scanned = run_ocr(page, page.rect, deadline, attempts, language=language)
                combined = Layout(page, hybrid_tokens(layout.words, scanned))
                first_kind = title_role(combined)
                if needs_multilingual_retry(combined, first_kind) and monotonic() < deadline:
                    alternate = run_ocr(
                        page, page.rect, deadline, attempts, threshold=2, language=MULTILINGUAL_OCR
                    )
                    if alternate:
                        second = Layout(page, hybrid_tokens(layout.words, alternate))
                        second_kind = title_role(second)
                        if (
                            (second_kind and not first_kind)
                            or ((not first_kind or second_kind == first_kind)
                                and len(form_anchors(second)) + bool(positioned_headers(second))
                                > len(form_anchors(combined)) + bool(positioned_headers(combined)))
                            or not combined.words
                        ):
                            combined = second
                layout = combined
            layouts.append(layout)
        kind = next((kind for layout in layouts if (kind := title_role(layout))), kind)
        if not kind and classification == "draft_bl" and any(layout.words for layout in layouts):
            # A staff/inbound hint is useful once there is evidence of a bill form.
            available = {anchor.key for layout in layouts for anchor in anchors(layout)}
            if {"bl_no", "shipper", "consignee"} <= available:
                kind = "bill_of_lading"
        if not kind:
            unreadable = not any(layout.words for layout in layouts)
            return Extraction(
                document_id=doc,
                role="draft_bl" if unreadable else "other",
                status="failed" if unreadable else "unsupported_layout",
                error="unreadable_pdf" if unreadable else "unrecognized_pdf",
                method="tesseract" if attempts else "pdf_layout",
                source_excerpt=[
                    e
                    for layout in layouts
                    for line in layout.lines[:25]
                    for e in layout.evidence(doc, [line])
                ][:60],
                recovery=attempts,
            )

        obs = Observations()
        items = []
        remaining = MAX_RECOVERY_CROPS
        rescanned = []
        for layout in layouts:
            labels = collect_fields(layout, doc, obs, kind)
            if kind in {"invoice", "packing_list"} and len(items) < 200:
                page_items = collect_items(layout, doc, start=len(items))[:200 - len(items)]
                if any(token.method != "pdf_text" for token in layout.words):
                    remaining = recover_item_cells(layout, doc, page_items, deadline, attempts, remaining)
                items.extend(page_items)
            if kind in BILLS and layout.horizontal and layout.vertical:
                collect_tables(layout, doc, obs)
            if ocr_pages and any(token.method != "pdf_text" for token in layout.words):
                page = layout.page
                # A raster page can carry a title but still lose entire label/value rows.
                if (
                    sparse(native[page.number])
                    and kind in BILLS
                    and any(
                        not obs.values.get(key)
                        for key in ("bl_no", "origin", "discharge", "gross_weight")
                    )
                    and monotonic() < deadline
                ):
                    alternate = run_ocr(page, page.rect, deadline, attempts, threshold=2, language=ocr_language(layout.words))
                    if alternate:
                        revised = Layout(page, hybrid_tokens(native[page.number].words, alternate))
                        rescanned.append(revised)
                        second = Observations()
                        second_labels = collect_fields(revised, doc, second, kind, rank=86)
                        for key, values in second.values.items():
                            obs.values[key].extend(values)
                        # A recovered label also gives a usable crop bound.
                        labels.extend(
                            anchor
                            for anchor in second_labels
                            if not any(a.key == anchor.key for a in labels)
                        )
                remaining = recover(layout, labels, kind, doc, obs, deadline, attempts, remaining)
        if kind in BILLS and ocr_pages:
            for layout in [*layouts, *rescanned]:
                if sparse(native[layout.page.number]):
                    scan_candidates(layout, doc, obs)
        if kind in BILLS and not ocr_pages:
            legacy_candidates(data, name, doc, layouts, obs, legacy)
        fields = obs.fields()
        if kind in BILLS:
            for key in (*PRIMARY_FIELDS, "delivery", "destination_port", "etd", "eta"):
                fields.setdefault(key, field(None))
            # Backwards-compatible view. New validation uses the explicitly labelled slots.
            fields["port"] = fields["discharge"]
            fields["destination"] = next(
                (
                    fields[k]
                    for k in ("delivery", "destination_port", "discharge")
                    if fields[k].value
                ),
                field(None),
            )
            for layout in layouts:
                mode = next(
                    ((line, match) for line in layout.lines if (match := MODE.search(line.text))),
                    None,
                )
                if mode:
                    line, match = mode
                    raw = match.group(0).casefold()
                    value = (
                        "BY TRUCK"
                        if "truck" in raw or "road" in raw
                        else "BY AIR"
                        if "air" in raw
                        else "BY SEA"
                    )
                    fields["shipping_mode"] = field(value, *layout.evidence(doc, [line]))
                    break
        # Preserve the usual uncertainty status for OCR-only bills.
        complete = kind in BILLS and all(
            fields[key].status == "present" for key in ("bl_no", "shipper", "consignee")
        )
        if kind in {"invoice", "packing_list"}:
            for key in ("invoice_no", "supplier", "consignee", "invoice_date"):
                fields.setdefault(key, field(None))
            if fields.get("destination_port"):
                fields["destination"] = fields["destination_port"]
            complete = bool(items) and (kind == "packing_list" or fields["invoice_no"].status == "present")
            complete &= all(item.fields["description"].status == item.fields["quantity"].status == "present" for item in items)
        role = "draft_bl" if kind in BILLS else kind
        return Extraction(
            document_id=doc,
            role=role,
            document_kind=kind,
            fields=fields,
            items=items,
            method="tesseract" if ocr_pages else "pdf_layout",
            status="extracted"
            if complete or role not in {"draft_bl", "invoice", "packing_list"}
            else "partial",
            source_excerpt=[
                e
                for layout in layouts
                for line in layout.lines[:35]
                for e in layout.evidence(doc, [line])
            ][:60],
            recovery=attempts,
        )
