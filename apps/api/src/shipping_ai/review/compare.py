import re
from collections import Counter
from decimal import Decimal

from services.matching import candidate_score, normalize, translate

from .schemas import Extraction, Finding, Item
from .values import convert, decimal, display, identity, usable

WEIGHT_TOLERANCE = Decimal("0.05")  # kilograms
QUANTITY_TOLERANCE = Decimal("0.000001")
AMOUNT_TOLERANCE = Decimal("0.01")
PRICE_TOLERANCE = Decimal("0.0001")
NUMERIC = {"quantity", "packages", "gross_weight", "net_weight", "unit_price", "amount"}


def finding(group, name, outcome, message, left=None, right=None, *, key=None):
    return Finding(
        key=key or f"{group}.{name}",
        group=group,
        field=name,
        outcome=outcome,
        explanation=message,
        left=display(left),
        right=display(right),
        evidence=[e for value in (left, right) if value for e in value.evidence][:12],
    )


def compare(group, name, left, right, *, required=False, suffix=""):
    key = f"{group}.{name}{suffix}"

    def result(outcome, message):
        return finding(group, name, outcome, message, left, right, key=key)

    if not (usable(left) and usable(right)):
        if (
            required
            or (left and left.status == "uncertain")
            or (right and right.status == "uncertain")
        ):
            return result(
                "NEEDS_REVIEW", "A required or uncertain source value could not be compared."
            )
        if usable(left) or usable(right):
            return result("WARNING", "Only one document supplies this value.")
        return None

    if name == "unit":
        if left.value == right.value:
            return result("PASS", "Units agree.")
        if convert(Decimal(1), left.value, right.value) is not None:
            return result("PASS", "Units are convertible using the documented conversion table.")
        return result("MISMATCH", "Units differ and no supported conversion applies.")

    if name in NUMERIC:
        a, b = decimal(left.value), decimal(right.value)
        if a is None or b is None:
            return result("NEEDS_REVIEW", "A source number could not be validated.")
        if name in {"unit_price", "amount"}:
            if not left.currency or not right.currency:
                return result(
                    "NEEDS_REVIEW", "Currency is missing; the amounts cannot be compared."
                )
            if left.currency != right.currency:
                return result("MISMATCH", "Currencies differ. No exchange rate was assumed.")
            if name == "unit_price":
                # One right-hand unit expressed in left-hand units.
                factor = convert(Decimal(1), right.unit, left.unit)
                if factor is None:
                    return result("NEEDS_REVIEW", "Price units are missing or incompatible.")
                a *= factor
            tolerance = PRICE_TOLERANCE if name == "unit_price" else AMOUNT_TOLERANCE
        else:
            if name in {"gross_weight", "net_weight"}:
                a, b = convert(a, left.unit, "KG"), convert(b, right.unit, "KG")
                tolerance = WEIGHT_TOLERANCE
            else:
                a = convert(a, left.unit, right.unit)
                tolerance = Decimal(0) if name == "packages" else QUANTITY_TOLERANCE
            if a is None or b is None:
                return result("NEEDS_REVIEW", "Numeric units are missing or incompatible.")
        return (
            result("PASS", "Values agree within the comparison tolerance.")
            if abs(a - b) <= tolerance
            else result("MISMATCH", "Source values differ beyond the comparison tolerance.")
        )

    same = identity(left.value) == identity(right.value) and bool(identity(left.value))
    if same:
        return result("PASS", "Source values agree after normalization.")
    if name in {
        "description",
        "shipper",
        "supplier",
        "notify_party",
        "origin",
        "destination",
        "cargo_summary",
    }:
        return result(
            "NEEDS_REVIEW", "Wording differs. Confirm the meaning or the roles of the parties."
        )
    return result("MISMATCH", "Source values differ.")


def descriptions(item: Item) -> set[str]:
    original = usable(item.fields.get("description"))
    english = usable(item.fields.get("english_description"))
    translated, _ = translate(original, english or "", online=False)
    return {
        normalize(value) for value in (original, english, translated) if value and normalize(value)
    }


def item_pairs(invoice: list[Item], packing: list[Item]):
    # Shared descriptions or HS codes can propose a pairing. Repeated descriptions
    # and group/split packing lines remain unresolved; row order is not identity.
    left_labels = [descriptions(item) for item in invoice]
    right_labels = [descriptions(item) for item in packing]
    scores = {}
    for i, left in enumerate(invoice):
        for j, right in enumerate(packing):
            a, b = usable(left.fields.get("hs_code")), usable(right.fields.get("hs_code"))
            shared = bool(left_labels[i] & right_labels[j])
            fuzzy = max(
                (candidate_score(x, y) for x in left_labels[i] for y in right_labels[j]), default=0
            )
            if shared or (a and a == b and fuzzy >= 45) or fuzzy >= 78:
                scores[i, j] = (200 if shared else 0) + (10 if a and a == b else 0) + fuzzy

    by_left = {i: [] for i in range(len(invoice))}
    by_right = {j: [] for j in range(len(packing))}
    for (i, j), score in scores.items():
        by_left[i].append((score, j))
        by_right[j].append((score, i))

    def best(options):
        ranked = sorted(options, reverse=True)
        if ranked and (len(ranked) == 1 or ranked[0][0] - ranked[1][0] >= 8):
            return ranked[0][1]
        return None

    matched = [
        (i, j)
        for i, options in by_left.items()
        if (j := best(options)) is not None and best(by_right[j]) == i
    ]
    if not matched and len(invoice) == len(packing) == 1:
        return [(0, 0)]
    return matched


def invoice_packing(invoice: Extraction, packing: Extraction) -> list[Finding]:
    result = []
    group = "invoice_packing"
    for name in (
        "invoice_no",
        "consignee",
        "supplier",
        "packages",
        "gross_weight",
        "net_weight",
        "amount",
    ):
        # A contract number and an invoice number are separate identifiers.
        check = compare(group, name, invoice.fields.get(name), packing.fields.get(name))
        if check:
            result.append(check)
    pairs = item_pairs(invoice.items, packing.items)
    for i, j in pairs:
        left, right = invoice.items[i], packing.items[j]
        suffix = f".{left.row}.{right.row}"
        a, b = left.fields, right.fields
        left_source = usable(a.get("description")) or ""
        right_source = usable(b.get("description")) or ""
        conflicting_source = (
            re.search(r"[\u3400-\u9fff]", left_source)
            and re.search(r"[\u3400-\u9fff]", right_source)
            and identity(left_source) != identity(right_source)
        )
        if descriptions(left) & descriptions(right) and not conflicting_source:
            result.append(
                finding(
                    group,
                    "description",
                    "PASS",
                    "Descriptions agree using source text or the local glossary.",
                    a.get("description"),
                    b.get("description"),
                    key=f"{group}.description{suffix}",
                )
            )
        else:
            result.append(
                compare(
                    group,
                    "description",
                    a.get("description"),
                    b.get("description"),
                    required=True,
                    suffix=suffix,
                )
            )
        for name in (
            "quantity",
            "unit",
            "unit_price",
            "amount",
            "gross_weight",
            "net_weight",
            "hs_code",
        ):
            # Price/value and weights are optional on either layout. Check only if
            # both report the number; absent cells remain visible in extraction.
            if name in {"unit_price", "amount", "gross_weight", "net_weight"} and not (
                (a.get(name) and a[name].value is not None)
                and (b.get(name) and b[name].value is not None)
            ):
                continue
            check = compare(
                group,
                name,
                a.get(name),
                b.get(name),
                required=name in {"quantity", "unit"},
                suffix=suffix,
            )
            if check:
                result.append(check)

    for role, rows, paired in (
        ("invoice", invoice.items, {i for i, _ in pairs}),
        ("packing", packing.items, {j for _, j in pairs}),
    ):
        for i, item in enumerate(rows):
            if i not in paired:
                result.append(
                    finding(
                        group,
                        "description",
                        "NEEDS_REVIEW",
                        "No unique corresponding item was found. Check for split, grouped or missing lines.",
                        item.fields.get("description"),
                        key=f"{group}.unpaired.{role}.{item.row}",
                    )
                )
    return result


def transport(invoice: Extraction | None, packing: Extraction | None, bill: Extraction):
    result = []
    for doc in (invoice, packing):
        if doc is None:
            continue
        for name in (
            "shipper",
            "consignee",
            "notify_party",
            "packages",
            "gross_weight",
            "net_weight",
            "container",
            "seal",
            "booking_no",
            "bl_no",
            "origin",
            "destination",
            "vessel",
            "voyage",
            "shipping_mode",
        ):
            left = doc.fields.get(name)
            if name == "shipper" and not usable(left):
                left = doc.fields.get("supplier")
            right = bill.fields.get(name)
            # Only overlapping fields. An OCR candidate is surfaced as uncertain.
            if not (left and left.value is not None and right and right.value is not None):
                continue
            check = compare("transport", name, left, right, suffix=f".{doc.role}")
            if check:
                result.append(check)
    if not result:
        result.append(
            finding(
                "transport",
                "summary",
                "NEEDS_REVIEW",
                "No overlapping transport values were available for comparison.",
            )
        )
    return result


def review_documents(extractions: list[Extraction]) -> tuple[list[Finding], dict[str, Extraction]]:
    result = []
    active = {}
    for item in extractions:
        if item.status != "extracted":
            result.append(
                finding(
                    "extraction",
                    item.role,
                    "WARNING" if item.role == "other" else "NEEDS_REVIEW",
                    "This document could not be fully extracted. Inspect the source and missing fields.",
                    key=f"extraction.{item.role}.{item.document_id}",
                ).model_copy(
                    update={"evidence": [item.source_excerpt[0]] if item.source_excerpt else []}
                )
            )
    counts = Counter(item.role for item in extractions)
    for role in ("invoice", "packing_list", "draft_bl"):
        if counts[role] == 1:
            active[role] = next(item for item in extractions if item.role == role)
        elif counts[role] > 1:
            result.append(
                finding(
                    "extraction",
                    role,
                    "NEEDS_REVIEW",
                    "Multiple current documents have this role. Link a revision or confirm which applies.",
                )
            )
        else:
            result.append(
                finding(
                    "extraction",
                    role,
                    "WARNING" if role == "draft_bl" else "NEEDS_REVIEW",
                    "No document with this role is available.",
                )
            )
    invoice, packing, bill = (active.get(role) for role in ("invoice", "packing_list", "draft_bl"))
    if invoice and not usable(invoice.fields.get("invoice_no")):
        result.append(
            finding(
                "extraction",
                "invoice_no",
                "NEEDS_REVIEW",
                "The invoice number is missing or uncertain.",
                invoice.fields.get("invoice_no"),
            )
        )
    if invoice:
        for item in invoice.items:
            values = item.fields
            for key in ("unit_price", "amount"):
                value = values[key]
                if value.value is not None and value.currency is None:
                    result.append(
                        finding(
                            "extraction",
                            key,
                            "NEEDS_REVIEW",
                            "Currency is missing from the invoice source.",
                            value,
                            key=f"extraction.currency.{key}.{item.row}",
                        )
                    )
                elif (
                    key == "amount"
                    and value.value is None
                    and values["unit_price"].value is not None
                ):
                    result.append(
                        finding(
                            "extraction",
                            key,
                            "NEEDS_REVIEW",
                            "The invoice amount is missing from the source.",
                            value,
                            key=f"extraction.amount.{item.row}",
                        )
                    )
    if invoice and packing:
        result.extend(invoice_packing(invoice, packing))
    if bill:
        result.extend(transport(invoice, packing, bill))
    return result, active


def overall(findings: list[Finding]):
    for outcome in ("MISMATCH", "NEEDS_REVIEW", "WARNING"):
        if any(item.outcome == outcome for item in findings):
            return outcome
    return "PASS" if findings else "NEEDS_REVIEW"
