"""Multi-identifier shipment matching and document revision classification.

Matches incoming documents to existing shipments using B/L numbers, booking numbers,
container numbers, invoice references, email threads, parties, ports, and cargo specs.
Never relies on a single identifier alone. If matching is uncertain, routes the intake
to manual matching.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from shipping_ai.documents.extract import extract
from shipping_ai.models import (
    Document,
    DocumentExtraction,
    ImportRecord,
    IncomingMessage,
    IntakeCase,
    ReviewSnapshot,
)
from shipping_ai.review.values import clean, folded, usable

ISO_CONTAINER = re.compile(r"\b([A-Z]{3}[UJZ]\s*\d{7})\b", re.I)
ANY_CONTAINER = re.compile(r"\b([A-Z]{4}\s*\d{6,7}[ -]?\d?)\b", re.I)
INVOICE_REF_PATTERNS = [
    re.compile(r"\b([A-Z0-9]{2,8}(?:[-_/][A-Z0-9]{1,12})+)\b", re.I),
    re.compile(r"\b([A-Z]{2,4}\d{4,10})\b", re.I),
]
FINAL_BL_MARKERS = re.compile(
    r"\b(?:telex release|express release|original|surrender(?:ed)?|sea waybill|shipped on board)\b",
    re.I,
)
FINAL_FILENAME_MARKERS = re.compile(
    r"\b(?:telex|original|surrender|final|seawaybill|sea-waybill|waybill)\b",
    re.I,
)
DRAFT_MARKERS = re.compile(
    r"\b(?:draft|copy|proforma|confirmation only|sample)\b",
    re.I,
)


@dataclass
class ExtractedIdentifiers:
    doc_type: str = "other"
    is_final_bl: bool = False
    is_draft_bl: bool = False
    has_invoice_doc: bool = False
    has_transport_doc: bool = False
    invoice_refs: set[str] = field(default_factory=set)
    bl_numbers: set[str] = field(default_factory=set)
    booking_numbers: set[str] = field(default_factory=set)
    container_numbers: set[str] = field(default_factory=set)
    seal_numbers: set[str] = field(default_factory=set)
    shipper: str | None = None
    consignee: str | None = None
    vessel: str | None = None
    voyage: str | None = None
    origin: str | None = None
    port: str | None = None
    destination: str | None = None
    packages: int | None = None
    gross_weight: Decimal | None = None
    raw_text: str = ""


@dataclass
class MatchDecision:
    status: Literal["matched", "new_shipment", "uncertain"]
    case_id: UUID | None = None
    confidence: float = 0.0
    matched_criteria: list[str] = field(default_factory=list)
    candidate_cases: list[dict[str, Any]] = field(default_factory=list)
    reason: str = ""


@dataclass
class DocumentRelationship:
    kind: Literal["duplicate", "updated_revision", "final_version", "new_document"]
    parent_version_id: UUID | None = None
    version_number: int = 1
    existing_document_id: UUID | None = None
    classification: str = "other"
    reason: str = ""


def normalize_ref(val: str | None) -> str:
    if not val:
        return ""
    return re.sub(r"[\s\-_/.]+", "", str(val)).upper()


def extract_file_identifiers(data: bytes, filename: str) -> ExtractedIdentifiers:
    """Extract identifiers from document bytes and layout."""
    import uuid

    result = ExtractedIdentifiers()
    lowered_name = filename.lower()
    if FINAL_FILENAME_MARKERS.search(lowered_name):
        result.is_final_bl = True
    elif DRAFT_MARKERS.search(lowered_name):
        result.is_draft_bl = True

    try:
        # Use existing extract adapter
        extractions = extract(data, filename, uuid.uuid4(), "other")
    except Exception:
        extractions = []

    for ext in extractions:
        if ext.role in ("draft_bl", "final_bl"):
            result.doc_type = "final_bl" if result.is_final_bl else "draft_bl"
            result.has_transport_doc = True
        elif ext.role == "invoice":
            result.doc_type = "invoice"
            result.has_invoice_doc = True
        elif ext.role == "packing_list":
            if not result.doc_type or result.doc_type == "other":
                result.doc_type = "packing_list"

        for key, field_val in ext.fields.items():
            val = usable(field_val)
            if not val:
                continue
            if key == "bl_no":
                norm = normalize_ref(val)
                if norm and len(norm) >= 4:
                    result.bl_numbers.add(norm)
            elif key == "booking_no":
                norm = normalize_ref(val)
                if norm and len(norm) >= 4:
                    result.booking_numbers.add(norm)
            elif key in ("invoice_no", "contract_no"):
                norm = normalize_ref(val)
                if norm and len(norm) >= 3:
                    result.invoice_refs.add(norm)
            elif key == "container":
                norm = normalize_ref(val)
                if norm:
                    result.container_numbers.add(norm)
            elif key == "seal":
                norm = normalize_ref(val)
                if norm:
                    result.seal_numbers.add(norm)
            elif key in ("shipper", "supplier") and not result.shipper:
                result.shipper = val
            elif key == "consignee" and not result.consignee:
                result.consignee = val
            elif key == "vessel" and not result.vessel:
                result.vessel = val
            elif key == "voyage" and not result.voyage:
                result.voyage = val
            elif key == "origin" and not result.origin:
                result.origin = val
            elif key in ("port", "discharge") and not result.port:
                result.port = val
            elif key == "destination" and not result.destination:
                result.destination = val
            elif key == "packages" and result.packages is None:
                try:
                    result.packages = int(val)
                except (ValueError, TypeError):
                    pass
            elif key == "gross_weight" and result.gross_weight is None:
                try:
                    result.gross_weight = Decimal(str(val))
                except Exception:
                    pass

        # Check raw text or excerpts for additional indicators
        for ev in ext.source_excerpt:
            if ev.raw:
                if FINAL_BL_MARKERS.search(ev.raw):
                    result.is_final_bl = True
                for m in ISO_CONTAINER.finditer(ev.raw):
                    result.container_numbers.add(normalize_ref(m.group(1)))
                for pat in INVOICE_REF_PATTERNS:
                    for m in pat.finditer(ev.raw):
                        norm = normalize_ref(m.group(1))
                        if len(norm) >= 4:
                            result.invoice_refs.add(norm)

    if result.is_final_bl and result.doc_type == "draft_bl":
        result.doc_type = "final_bl"

    result.invoice_refs -= result.bl_numbers
    result.invoice_refs -= result.container_numbers
    result.invoice_refs -= result.booking_numbers

    return result


def extract_context_identifiers(
    subject: str | None, body: str | None, thread_id: str | None
) -> ExtractedIdentifiers:
    """Extract references from email/channel message context."""
    res = ExtractedIdentifiers()
    text = f"{subject or ''} {body or ''}".strip()
    if not text:
        return res

    for pat in INVOICE_REF_PATTERNS:
        for m in pat.finditer(text):
            norm = normalize_ref(m.group(1))
            if len(norm) >= 4:
                res.invoice_refs.add(norm)

    for m in ISO_CONTAINER.finditer(text):
        res.container_numbers.add(normalize_ref(m.group(1)))

    for m in ANY_CONTAINER.finditer(text):
        norm = normalize_ref(m.group(1))
        if len(norm) >= 10:
            res.container_numbers.add(norm)

    res.invoice_refs -= res.bl_numbers
    res.invoice_refs -= res.container_numbers
    res.invoice_refs -= res.booking_numbers

    return res


def match_shipment(
    db: Session,
    workspace_id: UUID,
    identifiers: ExtractedIdentifiers,
    message_thread_id: str | None = None,
    company_id: UUID | None = None,
) -> MatchDecision:
    """Match incoming identifiers to an existing active shipment case."""
    # Filter cases eligible for matching:
    # If incoming document is a final B/L (e.g. Telex release), it can match an approved shipment to confirm final details.
    # Otherwise, it only matches in-flight active cases:
    eligible_states = {"queued", "needs_review", "ready_for_approval", "awaiting_updated_document", "manual_matching"}
    if identifiers.is_final_bl:
        eligible_states.add("approved")

    query = select(IntakeCase).where(
        IntakeCase.workspace_id == workspace_id,
        IntakeCase.state.in_(eligible_states),
    )
    if company_id:
        query = query.where(or_(IntakeCase.company_id == company_id, IntakeCase.company_id.is_(None)))

    cases = (
        db.execute(
            query.order_by(IntakeCase.created_at.desc()).limit(50)
        )
        .scalars()
        .all()
    )

    if not cases:
        return MatchDecision(status="new_shipment", reason="No existing active cases")

    scored_candidates: list[tuple[int, list[str], IntakeCase]] = []

    for case in cases:
        score = 0
        reasons: list[str] = []

        # 1. Check detected_reference & ImportRecord
        case_invoice_refs: set[str] = set()
        if case.detected_reference:
            case_invoice_refs.add(normalize_ref(case.detected_reference))

        record = db.scalar(select(ImportRecord).where(ImportRecord.intake_case_id == case.id))
        if record and record.invoice_no:
            case_invoice_refs.add(normalize_ref(record.invoice_no))

        # Check overlapping invoice refs
        common_inv = identifiers.invoice_refs & case_invoice_refs
        if common_inv:
            score += 40
            reasons.append(f"Matching invoice reference: {', '.join(common_inv)}")

        # 2. Check latest ReviewSnapshot extractions
        latest_snapshot = db.scalar(
            select(ReviewSnapshot)
            .where(ReviewSnapshot.intake_case_id == case.id)
            .order_by(ReviewSnapshot.revision.desc())
            .limit(1)
        )

        case_bl_numbers: set[str] = set()
        case_containers: set[str] = set()
        case_parties: set[str] = set()
        case_ports: set[str] = set()
        case_vessels: set[str] = set()
        case_gw: Decimal | None = None
        case_pkgs: int | None = None

        if latest_snapshot:
            extractions = db.scalars(
                select(DocumentExtraction).where(
                    DocumentExtraction.snapshot_id == latest_snapshot.id
                )
            ).all()
            for ext in extractions:
                payload = ext.payload or {}
                fields_dict = payload.get("fields", {})
                for k, fld in fields_dict.items():
                    val = fld.get("value")
                    if not val:
                        continue
                    if k in ("bl_no", "booking_no"):
                        case_bl_numbers.add(normalize_ref(val))
                    elif k in ("invoice_no", "contract_no"):
                        case_invoice_refs.add(normalize_ref(val))
                    elif k == "container":
                        case_containers.add(normalize_ref(val))
                    elif k in ("shipper", "consignee", "supplier"):
                        case_parties.add(folded(val))
                    elif k in ("port", "discharge", "destination"):
                        case_ports.add(folded(val))
                    elif k in ("vessel", "voyage"):
                        case_vessels.add(folded(val))
                    elif k == "gross_weight" and case_gw is None:
                        try:
                            case_gw = Decimal(str(val))
                        except Exception:
                            pass
                    elif k == "packages" and case_pkgs is None:
                        try:
                            case_pkgs = int(val)
                        except (ValueError, TypeError):
                            pass

        # Check overlapping B/L numbers
        common_bl = (identifiers.bl_numbers | identifiers.booking_numbers) & case_bl_numbers
        if common_bl:
            score += 45
            reasons.append(f"Matching B/L number: {', '.join(common_bl)}")

        # Check overlapping containers
        common_containers = identifiers.container_numbers & case_containers
        if common_containers:
            score += 35
            reasons.append(f"Matching container: {', '.join(common_containers)}")

        # 3. Check message thread or folder group
        msg_matches = False
        if message_thread_id:
            msg_matches = bool(
                db.scalar(
                    select(IncomingMessage.id)
                    .where(
                        IncomingMessage.intake_case_id == case.id,
                        IncomingMessage.thread_id == message_thread_id,
                    )
                    .limit(1)
                )
            )
            if msg_matches:
                score += 25
                reasons.append(f"Matching message thread/group: {message_thread_id}")

        # 4. Check company / party match
        if company_id and case.company_id and case.company_id == company_id:
            score += 15
            reasons.append("Matching workspace company")
        elif identifiers.consignee:
            norm_c = folded(identifiers.consignee)
            if any(norm_c in p or p in norm_c for p in case_parties):
                score += 15
                reasons.append(f"Matching consignee party: {identifiers.consignee}")

        if identifiers.shipper:
            norm_s = folded(identifiers.shipper)
            if any(norm_s in p or p in norm_s for p in case_parties):
                score += 15
                reasons.append(f"Matching shipper party: {identifiers.shipper}")

        # 5. Check vessel & port
        if identifiers.vessel and any(
            folded(identifiers.vessel) in v or v in folded(identifiers.vessel)
            for v in case_vessels
        ):
            score += 15
            reasons.append(f"Matching vessel: {identifiers.vessel}")

        if identifiers.port and any(
            folded(identifiers.port) in p or p in folded(identifiers.port)
            for p in case_ports
        ):
            score += 10
            reasons.append(f"Matching port: {identifiers.port}")

        # 6. Check cargo weight and package counts
        if (
            identifiers.gross_weight is not None
            and case_gw is not None
            and abs(identifiers.gross_weight - case_gw) <= Decimal("5.0")
        ):
            score += 10
            reasons.append(f"Matching gross weight ({case_gw} kg)")

        if (
            identifiers.packages is not None
            and case_pkgs is not None
            and identifiers.packages == case_pkgs
        ):
            score += 10
            reasons.append(f"Matching packages count ({case_pkgs})")

        # Check explicit conflict on primary identifiers:
        # An invoice conflict only applies if the incoming document is itself an invoice:
        if identifiers.doc_type == "invoice" and identifiers.invoice_refs and case_invoice_refs:
            if not (identifiers.invoice_refs & case_invoice_refs):
                continue

        # Check if incoming arrival is a full shipment package (both an actual invoice document and transport document present)
        # arriving outside any existing email thread and not a final B/L update:
        is_full_shipment_package = identifiers.has_invoice_doc and identifiers.has_transport_doc

        if is_full_shipment_package and not identifiers.is_final_bl and not msg_matches:
            # A full set of commercial invoice and transport document arriving outside an email thread
            # represents a new commercial shipment intake rather than an update to an existing shipment.
            continue

        if identifiers.bl_numbers and case_bl_numbers and not (identifiers.bl_numbers & case_bl_numbers):
            # If they share an invoice number or if incoming is a final B/L update (e.g. Master Telex B/L replacing Draft House B/L),
            # this is a valid update. Only disqualify if neither invoice nor container matches and it's not a final B/L update:
            if not common_inv and not identifiers.is_final_bl:
                if case_containers and not (identifiers.container_numbers & case_containers):
                    continue

        has_primary = bool(common_inv or common_bl or common_containers or (message_thread_id and msg_matches))
        if not has_primary:
            # Parties or cargo specs alone without any B/L, container, invoice, or thread anchor cannot match an existing shipment
            continue

        if score > 0:
            scored_candidates.append((score, reasons, case))

    if not scored_candidates:
        return MatchDecision(status="new_shipment", reason="No identifiers matched any existing case")

    # Sort by score descending
    scored_candidates.sort(key=lambda x: -x[0])
    best_score, best_reasons, best_case = scored_candidates[0]

    # Evaluate multiple criteria requirement (Req 2: "Do not rely on a single identifier")
    has_strong_multi_criteria = (
        len(best_reasons) >= 2 and best_score >= 50
    ) or (best_score >= 70)

    # Check for ambiguous competing matches
    if len(scored_candidates) > 1:
        second_score, second_reasons, second_case = scored_candidates[1]
        # If both score high and score difference is small (< 35 points), matching is uncertain!
        if second_score >= 30 and (best_score - second_score) < 35:
            candidates_info = [
                {
                    "case_id": str(c.id),
                    "score": s,
                    "reasons": r,
                    "reference": c.detected_reference,
                }
                for s, r, c in scored_candidates[:5]
            ]
            return MatchDecision(
                status="uncertain",
                confidence=best_score / 100.0,
                candidate_cases=candidates_info,
                reason="Ambiguous shipment match: multiple cases matched with close scores. Manual matching required.",
            )

    if has_strong_multi_criteria:
        return MatchDecision(
            status="matched",
            case_id=best_case.id,
            confidence=min(1.0, best_score / 100.0),
            matched_criteria=best_reasons,
            reason=f"Matched shipment with score {best_score}: {'; '.join(best_reasons)}",
        )

    # If score is modest (< 50) or relies on a single weak identifier
    if best_score >= 25:
        candidates_info = [
            {
                "case_id": str(c.id),
                "score": s,
                "reasons": r,
                "reference": c.detected_reference,
            }
            for s, r, c in scored_candidates[:3]
        ]
        return MatchDecision(
            status="uncertain",
            confidence=best_score / 100.0,
            candidate_cases=candidates_info,
            reason="Uncertain shipment match: identifiers insufficient for automatic linkage. Manual matching required.",
        )

    return MatchDecision(status="new_shipment", reason="No strong match found")


def detect_document_relationship(
    db: Session,
    case_id: UUID,
    file_sha256: str,
    filename: str,
    identifiers: ExtractedIdentifiers,
) -> DocumentRelationship:
    """Determine whether an incoming file is a duplicate, updated revision, final version, or new doc."""
    # 1. Duplicate check (exact same sha256 already recorded in this case)
    existing_duplicate = db.scalar(
        select(Document)
        .where(
            Document.intake_case_id == case_id,
            Document.sha256 == file_sha256,
        )
        .order_by(Document.received_at.desc())
        .limit(1)
    )
    if existing_duplicate:
        return DocumentRelationship(
            kind="duplicate",
            existing_document_id=existing_duplicate.id,
            version_number=existing_duplicate.version_number,
            classification=existing_duplicate.classification,
            reason="Identical file contents already archived in this shipment",
        )

    # 2. Get active non-superseded documents in this case
    all_docs = (
        db.execute(
            select(Document)
            .where(Document.intake_case_id == case_id)
            .order_by(Document.received_at.desc())
        )
        .scalars()
        .all()
    )

    superseded = {d.parent_version_id for d in all_docs if d.parent_version_id}
    active_docs = [d for d in all_docs if d.id not in superseded]

    # Map role to target active document
    incoming_role = identifiers.doc_type  # 'draft_bl', 'final_bl', 'invoice', 'packing_list', 'other'
    is_final = identifiers.is_final_bl or incoming_role == "final_bl"

    # Search for an active document to revise/supersede
    matching_parent: Document | None = None

    if incoming_role in ("draft_bl", "final_bl"):
        # Match against active transport document
        for doc in active_docs:
            is_transport = (
                doc.classification in ("draft_bl", "final_bl")
                or any(t in doc.original_filename.lower() for t in ("bl", "bill", "telex", "hbl", "bol", "lading", "提单"))
                or doc.original_filename.lower().endswith(".pdf")
            )
            if is_transport:
                matching_parent = doc
                break
    elif incoming_role in ("invoice", "packing_list"):
        # Match against active document of same classification
        for doc in active_docs:
            if doc.classification == incoming_role or any(t in doc.original_filename.lower() for t in (incoming_role, "invoice", "inv", "packing", "资料")):
                matching_parent = doc
                break

    # Fallback match by original filename similarity (e.g. "invoice.xlsx" vs "invoice_v2.xlsx")
    if not matching_parent:
        base_incoming = re.sub(r"[\s\-_()0-9]+", "", filename.lower().split(".")[0])
        for doc in active_docs:
            base_doc = re.sub(r"[\s\-_()0-9]+", "", doc.original_filename.lower().split(".")[0])
            if base_incoming and base_incoming == base_doc:
                matching_parent = doc
                break

    if matching_parent:
        next_version = matching_parent.version_number + 1
        if is_final:
            return DocumentRelationship(
                kind="final_version",
                parent_version_id=matching_parent.id,
                version_number=next_version,
                classification="final_bl",
                reason=f"Final B/L superseding previous draft v{matching_parent.version_number} ({matching_parent.original_filename})",
            )
        return DocumentRelationship(
            kind="updated_revision",
            parent_version_id=matching_parent.id,
            version_number=next_version,
            classification=matching_parent.classification,
            reason=f"Updated revision v{next_version} superseding v{matching_parent.version_number} ({matching_parent.original_filename})",
        )

    # If no existing document of this role was present, it's a new document
    target_class = "final_bl" if is_final else (incoming_role if incoming_role in ("invoice", "packing_list", "draft_bl") else "other")
    return DocumentRelationship(
        kind="new_document",
        parent_version_id=None,
        version_number=1,
        classification=target_class,
        reason=f"New {target_class} document attached to shipment",
    )
