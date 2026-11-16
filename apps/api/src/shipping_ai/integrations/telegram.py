import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from shipping_ai.core.config import settings
from shipping_ai.review.schemas import Extraction
from shipping_ai.review.values import decimal, usable

SHIPMENT_FIELDS = (
    ("Invoice", ("invoice_no",), ("invoice",)),
    ("Bill of lading", ("bl_no",), ("draft_bl",)),
    ("Shipper", ("shipper", "supplier"), ("draft_bl", "invoice")),
    ("Consignee", ("consignee",), ("invoice", "draft_bl")),
    ("Packages", ("packages", "package_count"), ("draft_bl", "packing_list", "invoice")),
    ("Gross weight", ("gross_weight",), ("draft_bl", "packing_list", "invoice")),
)


class TelegramError(Exception):
    def __init__(self, definitive=False):
        self.definitive = definitive


def api(method, payload):
    secret = settings().telegram_bot_token
    if not secret or not secret.get_secret_value():
        raise TelegramError(definitive=True)
    token = secret.get_secret_value()
    # urllib does not emit request URLs through httpx's request logger.
    request = Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=6) as response:
            result = json.loads(response.read(32_768))
            if result.get("ok") is not True or "result" not in result:
                raise TelegramError(definitive=True)
            return result["result"]
    except HTTPError as exc:
        raise TelegramError(definitive=400 <= exc.code < 500) from None
    except (URLError, OSError, ValueError) as exc:
        raise TelegramError() from exc


def field_value(documents, roles, keys):
    for role in roles:
        entries = [item for item in documents if item.role == role]
        if len(entries) != 1:
            continue
        for key in keys:
            field = entries[0].fields.get(key)
            if field and field.status == "present" and field.value:
                return " ".join(part for part in (field.value, field.currency, field.unit) if part)
    return "Pending"


def invoice_value(documents):
    invoices = [doc for doc in documents if doc.role == "invoice"]
    if len(invoices) != 1:
        return "Pending"
    invoice = invoices[0]
    reported = invoice.fields.get("amount")
    reported_value = decimal(usable(reported))
    if reported_value is not None and reported.currency:
        return f"{reported_value:f} {reported.currency}"
    fields = [line.fields.get("amount") for line in invoice.items]
    amounts = [decimal(usable(field)) for field in fields]
    currencies = {field.currency for field in fields if field}
    if (
        len(currencies) == 1
        and None not in currencies
        and amounts
        and all(value is not None for value in amounts)
    ):
        return f"{sum(amounts):f} {currencies.pop()}"
    return "Pending"


def format_summary(case, company, snapshot, extracted, review):
    source = review.payload["documents"] if review and review.ready else extracted
    documents = [Extraction.model_validate(item) for item in source]
    findings = snapshot.findings
    issues = sum(finding.get("outcome") != "PASS" for finding in findings)
    quick = bool(
        case.state == "ready_for_approval"
        and case.company_id
        and snapshot.outcome == "PASS"
        and issues == 0
        and review
        and review.ready
        and not review.payload.get("corrections")
        and not review.payload.get("permit_pending")
    )
    approval = {
        "approved": "Approved",
        "rejected": "Rejected",
        "ready_for_approval": "Ready for approval",
    }.get(case.state, "Review required")
    lines = ["Shipping draft", f"Company: {company or 'Unassigned'}"]
    for label, keys, roles in SHIPMENT_FIELDS:
        value = " ".join(field_value(documents, roles, keys).split())[:240]
        lines.append(f"{label}: {value}")
    lines.extend(
        [
            f"Invoice value: {invoice_value(documents)}",
            f"Verification: {snapshot.outcome.replace('_', ' ').title()} ({issues} findings)",
            f"Approval: {approval}",
            f"{'Approve draft' if quick else 'Review draft'}: {settings().origin}/open/{case.id}?workspace={case.workspace_id}"
            + (f"&revision={case.analysis_revision}&review={review.id}" if quick else ""),
        ]
    )
    return "\n".join(lines), quick
