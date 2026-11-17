"""Document version management, comparison diffing, and safe review draft reconciliation."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from shipping_ai.models import Document, DocumentExtraction, ReviewSnapshot
from shipping_ai.review.schemas import Extraction
from shipping_ai.review.values import clean, usable


def compute_fields_diff(
    previous_fields: dict[str, Any], current_fields: dict[str, Any]
) -> dict[str, Any]:
    """Compare fields between previous document version and current document version."""
    added: list[dict[str, Any]] = []
    modified: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    unchanged: list[dict[str, Any]] = []

    all_keys = set(previous_fields.keys()) | set(current_fields.keys())

    for key in sorted(all_keys):
        prev_f = previous_fields.get(key)
        curr_f = current_fields.get(key)

        prev_val = prev_f.get("value") if isinstance(prev_f, dict) else usable(prev_f)
        curr_val = curr_f.get("value") if isinstance(curr_f, dict) else usable(curr_f)

        prev_clean = clean(str(prev_val)) if prev_val is not None else ""
        curr_clean = clean(str(curr_val)) if curr_val is not None else ""

        if not prev_clean and curr_clean:
            added.append({
                "field": key,
                "value": curr_clean,
                "unit": curr_f.get("unit") if isinstance(curr_f, dict) else None,
                "currency": curr_f.get("currency") if isinstance(curr_f, dict) else None,
            })
        elif prev_clean and not curr_clean:
            missing.append({
                "field": key,
                "previous_value": prev_clean,
            })
        elif prev_clean and curr_clean:
            if prev_clean.lower() == curr_clean.lower():
                unchanged.append({
                    "field": key,
                    "value": curr_clean,
                })
            else:
                modified.append({
                    "field": key,
                    "previous_value": prev_clean,
                    "current_value": curr_clean,
                })

    return {
        "added": added,
        "modified": modified,
        "missing": missing,
        "unchanged": unchanged,
    }


def compute_snapshot_version_diff(
    db: Session, case_id: UUID, current_extractions: list[Extraction]
) -> dict[str, Any]:
    """Compute complete revision diff for all active documents in this snapshot against prior versions."""
    diff_docs: list[dict[str, Any]] = []
    has_final_bl = False
    all_added: list[str] = []
    all_modified: list[str] = []

    for ext in current_extractions:
        doc = db.get(Document, ext.document_id)
        if not doc or not doc.parent_version_id:
            continue

        parent_doc = db.get(Document, doc.parent_version_id)
        if not parent_doc:
            continue

        # Look up parent extraction in previous snapshot
        parent_ext_row = db.scalar(
            select(DocumentExtraction)
            .where(DocumentExtraction.document_id == parent_doc.id)
            .order_by(DocumentExtraction.created_at.desc())
            .limit(1)
        )
        parent_payload = parent_ext_row.payload if parent_ext_row else {}
        parent_fields = parent_payload.get("fields", {})

        current_fields = {
            k: {"value": v.value, "unit": v.unit, "currency": v.currency}
            for k, v in ext.fields.items()
        }

        diff = compute_fields_diff(parent_fields, current_fields)
        is_final = (
            doc.classification == "final_bl"
            or ext.role == "final_bl"
            or ext.document_kind in ("final_bl", "telex_release", "original_bl")
        )
        if is_final:
            has_final_bl = True

        for item in diff["added"]:
            all_added.append(f"{item['field']}: {item['value']}")
        for item in diff["modified"]:
            all_modified.append(
                f"{item['field']}: {item['previous_value']} → {item['current_value']}"
            )

        diff_docs.append({
            "document_id": str(doc.id),
            "parent_document_id": str(parent_doc.id),
            "parent_version_id": str(parent_doc.id),
            "filename": doc.original_filename,
            "original_filename": doc.original_filename,
            "parent_filename": parent_doc.original_filename,
            "version_number": doc.version_number,
            "parent_version_number": parent_doc.version_number,
            "role": ext.role,
            "classification": doc.classification,
            "is_final_bl": is_final,
            "added": {item["field"]: item["value"] for item in diff["added"]},
            "modified": {item["field"]: {"old": item["previous_value"], "new": item["current_value"]} for item in diff["modified"]},
            "missing": {item["field"]: item["previous_value"] for item in diff["missing"]},
            "unchanged": {item["field"]: item["value"] for item in diff["unchanged"]},
            "added_list": diff["added"],
            "modified_list": diff["modified"],
            "missing_list": diff["missing"],
            "diff": diff,
        })

    # Format concise summary for Telegram & UI
    summary_parts: list[str] = []
    if all_added:
        summary_parts.append(f"Added: {', '.join(all_added[:4])}")
    if all_modified:
        summary_parts.append(f"Modified: {', '.join(all_modified[:4])}")

    change_summary = "; ".join(summary_parts) if summary_parts else "No field differences detected"

    return {
        "has_revisions": len(diff_docs) > 0,
        "is_final_bl": has_final_bl,
        "requires_final_confirmation": has_final_bl,
        "diffs": diff_docs,
        "documents": diff_docs,
        "summary": change_summary,
        "details": {
            "added_count": len(all_added),
            "modified_count": len(all_modified),
            "description": change_summary,
        },
    }


def reconcile_review_draft(
    previous_review_payload: dict[str, Any] | None,
    current_extractions: list[Extraction],
    version_diff: dict[str, Any],
) -> dict[str, Any]:
    """Reconcile previous staff review with newly extracted document fields.

    Safely preserves staff-approved or staff-corrected values.
    Fills newly available fields where reliable.
    Flags discrepancies as conflicts.
    """
    staff_corrections = (
        previous_review_payload.get("corrections", []) if previous_review_payload else []
    )
    staff_corrected_map: dict[str, Any] = {}
    for c in staff_corrections:
        key = f"{c.get('role')}.{c.get('name')}"
        staff_corrected_map[key] = c

    prefilled_fields: list[dict[str, Any]] = []
    preserved_staff_fields: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []

    # Check each added or modified field from latest version
    for doc_diff in version_diff.get("documents", []):
        role = doc_diff.get("role", "")
        diff = doc_diff.get("diff", {})

        for item in diff.get("added", []):
            field_name = item["field"]
            key = f"{role}.{field_name}"
            if key in staff_corrected_map:
                # Staff previously edited this field: PRESERVE STAFF VALUE! Never overwrite!
                staff_val = staff_corrected_map[key].get("value")
                preserved_staff_fields.append({
                    "field": field_name,
                    "staff_value": staff_val,
                    "incoming_value": item["value"],
                })
            else:
                # Newly reliable information: pre-fill!
                prefilled_fields.append({
                    "role": role,
                    "field": field_name,
                    "value": item["value"],
                    "unit": item.get("unit"),
                    "currency": item.get("currency"),
                })

        for item in diff.get("modified", []):
            field_name = item["field"]
            key = f"{role}.{field_name}"
            if key in staff_corrected_map:
                # Conflict: staff had set a value, and incoming revision changed it!
                staff_val = staff_corrected_map[key].get("value")
                if staff_val != item["current_value"]:
                    conflicts.append({
                        "field": field_name,
                        "staff_value": staff_val,
                        "incoming_value": item["current_value"],
                        "previous_value": item["previous_value"],
                        "note": f"Incoming revision changed {field_name} to '{item['current_value']}', but staff had set '{staff_val}'. Staff value preserved.",
                    })
                preserved_staff_fields.append({
                    "field": field_name,
                    "staff_value": staff_val,
                    "incoming_value": item["current_value"],
                })

    return {
        "prefilled_fields": prefilled_fields,
        "preserved_staff_fields": preserved_staff_fields,
        "conflicts": conflicts,
    }
