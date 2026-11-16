"""Opt-in regression tests against the unchanged, private investigation corpus."""

import json
import os
import re
from collections import defaultdict
from hashlib import sha256
from pathlib import Path
from uuid import NAMESPACE_OID, uuid5
from zipfile import ZipFile

import pytest

from shipping_ai.documents.extract import extract
from shipping_ai.review.values import decimal, identity

ROOT = os.environ.get("SHIPPING_REFERENCE_ROOT")
AUDIT = os.environ.get("SHIPPING_REFERENCE_AUDIT")


@pytest.fixture(scope="module")
def reference():
    if not ROOT or not AUDIT:
        pytest.skip(
            "Set SHIPPING_REFERENCE_ROOT and SHIPPING_REFERENCE_AUDIT to run the private replay."
        )
    manifest = json.loads((Path(AUDIT) / "document-manifest.json").read_text())
    files = {item["id"]: item for item in manifest}
    expected = defaultdict(list)
    for raw in (Path(AUDIT) / "field-evaluation.jsonl").read_text().splitlines():
        row = json.loads(raw)
        if row["stage"] == "workflow":
            expected[row["document_id"]].append(row)
    extracted = {}
    for key, entry in files.items():
        suffix = entry["suffix"]
        if entry.get("duplicate_of") or suffix not in {".pdf", ".xls", ".xlsx"}:
            continue
        if container := entry.get("container"):
            with ZipFile(Path(ROOT) / files[container]["source"]) as archive:
                data = archive.read(entry["member"])
            name = Path(entry["member"]).name
        else:
            path = Path(ROOT) / entry["source"]
            name, data = path.name, path.read_bytes()
        if sha256(data).hexdigest() != entry["sha256"]:
            pytest.fail(f"{key} digest differs from the audited original", pytrace=False)
        extracted[key] = extract(data, name, uuid5(NAMESPACE_OID, entry["sha256"]), "other")
    return files, expected, extracted


def require(condition, document_id, field):
    if not condition:
        pytest.fail(f"{document_id} failed the reference check for {field}", pytrace=False)


def comparable(expected, field):
    if expected is None:
        return field is None or field.value is None
    if field is None or field.value is None:
        return False
    if expected.endswith((" KG", " PKG")):
        value, unit = expected.rsplit(" ", 1)
        return decimal(value) == decimal(field.value) and unit == field.unit
    return identity(expected) == identity(field.value)


def test_ancillary_documents_are_typed_and_native_bill_fields_do_not_regress(reference):
    files, expected, extracted = reference
    subtype_roles = {
        "arrival_notice": "arrival_notice",
        "release_order": "release_order",
        "debit_note": "debit_note",
        "carrier_tax_invoice": "freight_invoice",
        "service_tax_invoice": "freight_invoice",
    }
    aliases = {"reference": "bl_no", "issuer": "shipper", "receiver": "consignee"}
    core = {
        "reference",
        "issuer",
        "receiver",
        "packages",
        "gross_weight",
        "origin",
        "discharge",
        "delivery",
    }
    for key, entry in files.items():
        if entry["suffix"] != ".pdf" or key not in extracted:
            continue
        doc = extracted[key][0]
        role = subtype_roles.get(entry["subtype"], "draft_bl")
        require(doc.role == role, key, "document role")
        if entry["ocr_calls"] or role != "draft_bl":
            continue
        for item in expected[key]:
            if item["field"] in core:
                name = aliases.get(item["field"], item["field"])
                require(comparable(item["expected"], doc.fields.get(name)), key, name)


def test_workbook_panels_and_secondary_sheets_keep_their_rows_and_citations(reference):
    _, expected, extracted = reference
    for key, documents in extracted.items():
        sheet_docs = [section for primary in documents for section in [primary, *primary.sections]]
        for item in expected[key]:
            if item["field"] != "item_rows" or item["role"] not in {"invoice", "packing_list"}:
                continue
            choices = [
                doc
                for doc in sheet_docs
                if doc.role == item["role"]
                and doc.sheet
                and (
                    item["expected_source"] == doc.sheet
                    or item["expected_source"].startswith(doc.sheet + " ")
                )
            ]
            selected = max(choices, key=lambda doc: len(doc.sheet), default=None)
            require(selected and len(selected.items) == int(item["expected"]), key, "item count")
            if item["role"] == "invoice":
                require(bool(selected.fields["invoice_no"].value), key, "invoice number")


def test_previously_missing_ocr_totals_and_multiline_party_have_complete_evidence(reference):
    files, expected, extracted = reference
    for key, entry in files.items():
        if entry["suffix"] != ".pdf" or entry.get("role") != "bill" or key not in extracted:
            continue
        doc = extracted[key][0]
        for item in expected[key]:
            if (
                item["field"] not in {"receiver", "packages", "gross_weight"}
                or not item["expected"]
            ):
                continue
            name = "consignee" if item["field"] == "receiver" else item["field"]
            value = doc.fields.get(name)
            require(comparable(item["expected"], value), key, name)
            require(
                all(ev.page and ev.bbox for ev in value.evidence) and value.evidence,
                key,
                f"{name} bbox",
            )
            raw = " ".join(ev.raw or "" for ev in value.evidence)
            if name == "consignee":
                require(identity(value.value) in identity(raw), key, "full consignee citation")
            if name == "packages":
                require(bool(re.search(r"packag|pkg", raw, re.I)), key, "package unit citation")
