import html
import json
import logging
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from shipping_ai.core.config import settings
from shipping_ai.models import (
    ActivityEvent,
    Company,
    DocumentExtraction,
    IntakeCase,
    ReviewSnapshot,
    TelegramRecipient,
    User,
    WorkspaceMember,
)
from shipping_ai.review.schemas import Extraction
from shipping_ai.review.values import decimal, usable

log = logging.getLogger(__name__)

SHIPMENT_FIELDS = (
    ("Invoice", ("invoice_no",), ("invoice",)),
    ("Bill of lading", ("bl_no",), ("draft_bl",)),
    ("Shipper", ("shipper", "supplier"), ("draft_bl", "invoice")),
    ("Consignee", ("consignee",), ("invoice", "draft_bl")),
    ("Packages", ("packages", "package_count"), ("draft_bl", "packing_list", "invoice")),
    ("Gross weight", ("gross_weight",), ("draft_bl", "packing_list", "invoice")),
)


class TelegramError(Exception):
    def __init__(self, message: str = "", *, definitive: bool = False):
        super().__init__(message)
        self.message = message
        self.definitive = definitive

    def __str__(self):
        return self.message or "TelegramError"


def api(method, payload):
    secret = settings().telegram_bot_token
    if not secret or not secret.get_secret_value():
        raise TelegramError("Missing bot token", definitive=True)
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
                raise TelegramError(f"API result not ok: {result}", definitive=True)
            return result["result"]
    except HTTPError as exc:
        err_body = ""
        try:
            err_body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        log.warning("Telegram API error on %s (HTTP %d): %s", method, exc.code, err_body)
        raise TelegramError(
            f"HTTP {exc.code} on {method}: {err_body}",
            definitive=400 <= exc.code < 500,
        ) from None
    except (URLError, OSError, ValueError) as exc:
        log.warning("Telegram network/protocol error on %s: %s", method, exc)
        raise TelegramError(str(exc)) from exc


def is_public_url(url_str: str) -> bool:
    try:
        parsed = urlparse(url_str)
        host = (parsed.hostname or "").lower()
        if not host or host in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
            return False
        if "." not in host:
            return False
        return True
    except Exception:
        return False


def safe_send_message(
    chat_id: str | int,
    text: str,
    reply_markup: dict | None = None,
    parse_mode: str | None = "HTML",
    link_preview_options: dict | None = None,
) -> dict:
    payload: dict = {"chat_id": chat_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if reply_markup:
        payload["reply_markup"] = reply_markup
    if link_preview_options:
        payload["link_preview_options"] = link_preview_options

    try:
        return api("sendMessage", payload)
    except TelegramError as exc:
        log.warning("safe_send_message initial attempt failed: %s. Attempting fallback.", exc)
        if reply_markup:
            payload_no_markup = dict(payload)
            payload_no_markup.pop("reply_markup", None)
            try:
                return api("sendMessage", payload_no_markup)
            except TelegramError:
                pass

        plain_text = re.sub(r"<[^>]+>", "", text)
        return api("sendMessage", {"chat_id": chat_id, "text": plain_text})


def safe_edit_or_send(
    chat_id: str | int,
    text: str,
    message_id: int | None = None,
    reply_markup: dict | None = None,
    parse_mode: str | None = "HTML",
    link_preview_options: dict | None = None,
) -> dict:
    if message_id:
        payload: dict = {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
        }
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_markup:
            payload["reply_markup"] = reply_markup
        if link_preview_options:
            payload["link_preview_options"] = link_preview_options
        try:
            return api("editMessageText", payload)
        except TelegramError as exc:
            if "message is not modified" in str(exc).lower():
                return {"ok": True}
            log.info("editMessageText failed (%s), falling back to safe_send_message", exc)

    return safe_send_message(
        chat_id,
        text,
        reply_markup=reply_markup,
        parse_mode=parse_mode,
        link_preview_options=link_preview_options,
    )


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


def draft_url(case, review=None):
    url = f"{settings().origin}/open/{case.id}?workspace={case.workspace_id}"
    if review:
        url += f"&revision={case.analysis_revision}&review={review.id}"
    return url


def mini_app_buttons(case, review=None):
    if settings().web_origin.scheme != "https":
        return []
    if review:
        url = draft_url(case, review)
        return [
            {"text": "Approve", "web_app": {"url": f"{url}&decision=approve"}},
            {"text": "Reject", "web_app": {"url": f"{url}&decision=reject"}},
        ]
    return [{"text": "Review in Telegram", "web_app": {"url": draft_url(case)}}]


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
            f"{'Approve draft' if quick else 'Review draft'}: {draft_url(case, review if quick else None)}",
        ]
    )
    return "\n".join(lines), quick


def bot_username() -> str | None:
    try:
        me = api("getMe", {})
        return me.get("username")
    except TelegramError:
        return None


def card_buttons(case, review=None) -> list[list[dict]]:
    url = draft_url(case, review)
    origin = settings().web_origin
    is_public = is_public_url(str(origin))
    ref = case.detected_reference or str(case.id)[:8]

    rows: list[list[dict]] = [
        [
            {"text": "📄 Invoice", "callback_data": f"doc:inv:{ref}"},
            {"text": "📦 Packing List", "callback_data": f"doc:pl:{ref}"},
            {"text": "🚢 B/L", "callback_data": f"doc:bl:{ref}"},
        ]
    ]

    action_row: list[dict] = []
    if is_public:
        if origin.scheme == "https":
            if review:
                action_row.extend([
                    {"text": "✅ Quick Approve", "web_app": {"url": f"{url}&decision=approve"}},
                    {"text": "❌ Quick Reject", "web_app": {"url": f"{url}&decision=reject"}},
                ])
            else:
                action_row.append({"text": "🔍 Review in Telegram", "web_app": {"url": url}})
        else:
            action_row.append({"text": "🔍 Open in Harborway ↗", "url": url})

    action_row.append({"text": "🔄 Refresh", "callback_data": f"status:{ref}"})
    rows.append(action_row)
    return rows


def format_card(case, company, snapshot, extracted, review) -> tuple[str, bool, list[list[dict]]]:
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

    ref = (
        case.detected_reference
        or field_value(documents, ("invoice",), ("invoice_no",))
        or str(case.id)[:8]
    )
    company_name = company or "Unassigned"
    inv_val = invoice_value(documents)
    bl_val = field_value(documents, ("draft_bl",), ("bl_no",))
    pkg_val = field_value(documents, ("draft_bl", "packing_list", "invoice"), ("packages",))
    gw_val = field_value(documents, ("draft_bl", "packing_list", "invoice"), ("gross_weight",))
    shipper_val = field_value(documents, ("draft_bl", "invoice"), ("shipper", "supplier"))
    consignee_val = field_value(documents, ("invoice", "draft_bl"), ("consignee",))

    status_icon = "✅" if snapshot.outcome == "PASS" else "⚠️" if snapshot.outcome == "MISMATCH" else "ℹ️"
    outcome_text = snapshot.outcome.replace("_", " ").title()

    approval_map = {
        "approved": "✅ Approved",
        "rejected": "❌ Rejected",
        "ready_for_approval": "🟢 Ready for Approval",
    }
    approval_text = approval_map.get(case.state, "🟡 Review Required")

    url = draft_url(case, review if quick else None)

    lines = [
        f"🚢 <b>Shipping draft:</b> <code>{html.escape(ref)}</code>",
        f"🏢 <b>Company:</b> {html.escape(company_name)}",
        "",
        "📦 <b>Cargo & Value:</b>",
        f"• <b>Invoice Value:</b> <code>{html.escape(inv_val)}</code>",
        f"• <b>Packages:</b> {html.escape(pkg_val)}",
        f"• <b>Gross Weight:</b> {html.escape(gw_val)}",
        f"• <b>Bill of Lading:</b> <code>{html.escape(bl_val)}</code>",
        "",
        "📋 <b>Parties:</b>",
        f"• <b>Shipper:</b> {html.escape(shipper_val[:120])}",
        f"• <b>Consignee:</b> {html.escape(consignee_val[:120])}",
        "",
        f"🔍 <b>Verification:</b> {status_icon} <b>{outcome_text}</b> ({issues} findings)",
        f"🚦 <b>Approval Status:</b> {approval_text}",
        "",
        f"🔗 <a href='{url}'>Open Draft in Harborway ↗</a>",
    ]
    buttons = card_buttons(case, review if quick else None)
    return "\n".join(lines), quick, buttons


def format_invoice_card(case, company_name: str | None, payload: dict) -> tuple[str, list[list[dict]]]:
    ref = case.detected_reference or str(case.id)[:8]
    fields = payload.get("fields", {})
    inv_no = fields.get("invoice_no", {}).get("value") or ref
    total_amt = fields.get("amount", {}).get("value") or "Pending"
    currency = fields.get("amount", {}).get("currency") or "USD"
    supplier = fields.get("supplier", {}).get("value") or fields.get("shipper", {}).get("value") or "Pending"
    consignee = fields.get("consignee", {}).get("value") or company_name or "Pending"
    url = draft_url(case)

    lines = [
        "📄 <b>Commercial Invoice Details</b>",
        f"🚢 <b>Reference:</b> <code>{html.escape(ref)}</code>",
        f"🏢 <b>Company:</b> {html.escape(company_name or 'Unassigned')}",
        "",
        "💰 <b>Financial Summary:</b>",
        f"• <b>Invoice No:</b> <code>{html.escape(str(inv_no))}</code>",
        f"• <b>Total Amount:</b> <code>{html.escape(str(total_amt))} {currency}</code>",
        f"• <b>Supplier:</b> {html.escape(str(supplier)[:100])}",
        f"• <b>Consignee:</b> {html.escape(str(consignee)[:100])}",
        "",
    ]

    items = payload.get("items", [])
    if items:
        lines.append(f"📦 <b>Line Items ({len(items)}):</b>")
        for idx, item in enumerate(items[:5], 1):
            i_fields = item.get("fields", {})
            desc = i_fields.get("description", {}).get("value") or f"Item #{idx}"
            qty = i_fields.get("quantity", {}).get("value")
            unit = i_fields.get("quantity", {}).get("unit") or i_fields.get("unit", {}).get("value") or ""
            price = i_fields.get("unit_price", {}).get("value")
            amt = i_fields.get("amount", {}).get("value")

            parts = []
            if qty is not None:
                parts.append(f"Qty: {qty} {unit}".strip())
            if price is not None:
                parts.append(f"Price: {price} {currency}")
            if amt is not None:
                parts.append(f"Amt: <code>{amt} {currency}</code>")
            sub_info = " | ".join(parts) if parts else "Details pending"

            lines.append(f"{idx}. <b>{html.escape(str(desc))}</b>")
            lines.append(f"   • {sub_info}")
        if len(items) > 5:
            lines.append(f"<i>...and {len(items) - 5} more items (view full list in Harborway)</i>")
    else:
        lines.append("<i>No item lines extracted.</i>")

    lines.extend([
        "",
        f"🔗 <a href='{url}'>Open Draft in Harborway ↗</a>",
    ])

    buttons = [
        [{"text": "🔙 Back to Summary", "callback_data": f"status:{ref}"}],
        [
            {"text": "📦 Packing List", "callback_data": f"doc:pl:{ref}"},
            {"text": "🚢 B/L", "callback_data": f"doc:bl:{ref}"},
        ],
    ]
    return "\n".join(lines), buttons


def format_packing_list_card(case, company_name: str | None, payload: dict) -> tuple[str, list[list[dict]]]:
    ref = case.detected_reference or str(case.id)[:8]
    fields = payload.get("fields", {})
    gw = fields.get("gross_weight", {}).get("value") or fields.get("weight", {}).get("value") or "Pending"
    gw_unit = fields.get("gross_weight", {}).get("unit") or "KG"
    nw = fields.get("net_weight", {}).get("value")
    nw_unit = fields.get("net_weight", {}).get("unit") or "KG"
    pkgs = fields.get("packages", {}).get("value") or fields.get("package_count", {}).get("value") or "Pending"
    origin = fields.get("origin", {}).get("value") or fields.get("loading_port", {}).get("value") or "Pending"
    supplier = fields.get("supplier", {}).get("value") or fields.get("shipper", {}).get("value") or "Pending"
    url = draft_url(case)

    lines = [
        "📦 <b>Packing List Details</b>",
        f"🚢 <b>Reference:</b> <code>{html.escape(ref)}</code>",
        f"🏢 <b>Company:</b> {html.escape(company_name or 'Unassigned')}",
        "",
        "📊 <b>Packaging & Weight:</b>",
        f"• <b>Gross Weight:</b> <code>{html.escape(str(gw))} {gw_unit}</code>",
    ]
    if nw:
        lines.append(f"• <b>Net Weight:</b> {html.escape(str(nw))} {nw_unit}")
    lines.extend([
        f"• <b>Packages:</b> {html.escape(str(pkgs))}",
        f"• <b>Origin:</b> {html.escape(str(origin)[:80])}",
        f"• <b>Supplier:</b> {html.escape(str(supplier)[:80])}",
        "",
    ])

    items = payload.get("items", [])
    if items:
        lines.append(f"📋 <b>Package Breakdown ({len(items)} items):</b>")
        for idx, item in enumerate(items[:5], 1):
            i_fields = item.get("fields", {})
            desc = i_fields.get("description", {}).get("value") or f"Item #{idx}"
            item_gw = i_fields.get("gross_weight", {}).get("value")
            item_qty = i_fields.get("quantity", {}).get("value")
            item_unit = i_fields.get("quantity", {}).get("unit") or i_fields.get("unit", {}).get("value") or ""
            item_pkgs = i_fields.get("packages", {}).get("value")

            parts = []
            if item_pkgs:
                parts.append(f"Pkgs: {item_pkgs}")
            if item_gw:
                parts.append(f"GW: {item_gw} {gw_unit}")
            if item_qty:
                parts.append(f"Qty: {item_qty} {item_unit}".strip())
            sub_info = " | ".join(parts) if parts else "Details pending"

            lines.append(f"{idx}. <b>{html.escape(str(desc))}</b>")
            lines.append(f"   • {sub_info}")
        if len(items) > 5:
            lines.append(f"<i>...and {len(items) - 5} more items (view full breakdown in Harborway)</i>")
    else:
        lines.append("<i>No package item breakdown extracted.</i>")

    lines.extend([
        "",
        f"🔗 <a href='{url}'>Open Draft in Harborway ↗</a>",
    ])

    buttons = [
        [{"text": "🔙 Back to Summary", "callback_data": f"status:{ref}"}],
        [
            {"text": "📄 Invoice", "callback_data": f"doc:inv:{ref}"},
            {"text": "🚢 B/L", "callback_data": f"doc:bl:{ref}"},
        ],
    ]
    return "\n".join(lines), buttons


def format_bl_card(case, company_name: str | None, payload: dict) -> tuple[str, list[list[dict]]]:
    ref = case.detected_reference or str(case.id)[:8]
    fields = payload.get("fields", {})
    bl_no = fields.get("bl_no", {}).get("value") or "Pending"
    destination = fields.get("destination", {}).get("value") or "Pending"
    origin = fields.get("origin", {}).get("value") or "Pending"
    vessel = fields.get("vessel", {}).get("value")
    voyage = fields.get("voyage", {}).get("value")
    carrier = fields.get("carrier", {}).get("value")
    container = fields.get("container", {}).get("value")
    seal = fields.get("seal", {}).get("value")
    pkgs = fields.get("packages", {}).get("value") or fields.get("package_count", {}).get("value") or "Pending"
    cargo = fields.get("cargo_summary", {}).get("value") or "Pending"
    shipper = fields.get("shipper", {}).get("value") or fields.get("supplier", {}).get("value") or "Pending"
    consignee = fields.get("consignee", {}).get("value") or company_name or "Pending"
    url = draft_url(case)

    lines = [
        "🚢 <b>Bill of Lading Details</b>",
        f"🚢 <b>Reference:</b> <code>{html.escape(ref)}</code>",
        f"🏢 <b>Company:</b> {html.escape(company_name or 'Unassigned')}",
        "",
        "📑 <b>B/L Information:</b>",
        f"• <b>B/L Number:</b> <code>{html.escape(str(bl_no))}</code>",
        f"• <b>Destination:</b> {html.escape(str(destination))}",
        f"• <b>Origin:</b> {html.escape(str(origin))}",
        f"• <b>Packages:</b> {html.escape(str(pkgs))}",
        f"• <b>Cargo:</b> {html.escape(str(cargo)[:120])}",
    ]
    if vessel or voyage:
        vv = " / ".join(p for p in (vessel, voyage) if p)
        lines.append(f"• <b>Vessel/Voyage:</b> {html.escape(vv)}")
    if carrier:
        lines.append(f"• <b>Carrier:</b> {html.escape(carrier)}")
    if container or seal:
        cs = " / ".join(p for p in (container, seal) if p)
        lines.append(f"• <b>Container/Seal:</b> <code>{html.escape(cs)}</code>")

    lines.extend([
        "",
        "📋 <b>Parties:</b>",
        f"• <b>Shipper:</b> {html.escape(str(shipper)[:100])}",
        f"• <b>Consignee:</b> {html.escape(str(consignee)[:100])}",
        "",
        f"🔗 <a href='{url}'>Open Draft in Harborway ↗</a>",
    ])

    buttons = [
        [{"text": "🔙 Back to Summary", "callback_data": f"status:{ref}"}],
        [
            {"text": "📄 Invoice", "callback_data": f"doc:inv:{ref}"},
            {"text": "📦 Packing List", "callback_data": f"doc:pl:{ref}"},
        ],
    ]
    return "\n".join(lines), buttons


def setup_bot_menus(chat_id: str | int | None = None) -> bool:
    try:
        api(
            "setMyCommands",
            {
                "commands": [
                    {"command": "status", "description": "Check shipment status by invoice or B/L"},
                    {"command": "pending", "description": "List shipments awaiting review/approval"},
                    {"command": "whoami", "description": "Show connected staff account"},
                    {"command": "help", "description": "Show bot commands & usage"},
                ]
            },
        )
        if settings().web_origin.scheme == "https" and is_public_url(str(settings().origin)):
            menu = {
                "type": "web_app",
                "text": "📦 Harborway",
                "web_app": {"url": str(settings().origin)},
            }
        else:
            menu = {"type": "commands"}
        payload = {"menu_button": menu}
        if chat_id:
            payload["chat_id"] = int(chat_id)
        api("setChatMenuButton", payload)
        return True
    except TelegramError:
        return False


def handle_document_command(
    db, chat_id: str, doc_type: str, query_ref: str, message_id: int | None = None
) -> bool:
    recipient = db.scalar(select(TelegramRecipient).where(TelegramRecipient.chat_id == chat_id))
    if not recipient:
        safe_send_message(
            chat_id=chat_id,
            text="Link your Harborway account before checking document details.",
        )
        return True

    case = db.scalar(
        select(IntakeCase)
        .where(
            IntakeCase.workspace_id == recipient.workspace_id,
            IntakeCase.detected_reference.ilike(f"%{query_ref}%"),
        )
        .order_by(IntakeCase.created_at.desc())
        .limit(1)
    )
    if not case:
        safe_edit_or_send(
            chat_id=chat_id,
            text=f"❌ No shipment found matching <code>{html.escape(query_ref)}</code>.",
            message_id=message_id,
            parse_mode="HTML",
        )
        return True

    snapshot = db.scalar(
        select(ReviewSnapshot).where(
            ReviewSnapshot.intake_case_id == case.id,
            ReviewSnapshot.revision == case.analysis_revision,
        )
    )
    extractions = (
        db.scalars(
            select(DocumentExtraction).where(DocumentExtraction.snapshot_id == snapshot.id)
        ).all()
        if snapshot
        else []
    )
    company = db.get(Company, case.company_id) if case.company_id else None
    company_name = company.name if company else None

    docs_by_role = {
        ext.payload.get("role"): ext.payload
        for ext in extractions
        if ext.payload.get("role")
    }

    if doc_type == "inv":
        inv_payload = docs_by_role.get("invoice")
        if not inv_payload:
            card_text = f"📄 <b>Commercial Invoice</b>\n\nNo invoice document extracted for <code>{html.escape(query_ref)}</code>."
            buttons = [[{"text": "🔙 Back to Summary", "callback_data": f"status:{query_ref}"}]]
        else:
            card_text, buttons = format_invoice_card(case, company_name, inv_payload)
    elif doc_type == "pl":
        pl_payload = docs_by_role.get("packing_list")
        if not pl_payload:
            card_text = f"📦 <b>Packing List</b>\n\nNo packing list document extracted for <code>{html.escape(query_ref)}</code>."
            buttons = [[{"text": "🔙 Back to Summary", "callback_data": f"status:{query_ref}"}]]
        else:
            card_text, buttons = format_packing_list_card(case, company_name, pl_payload)
    elif doc_type == "bl":
        bl_payload = docs_by_role.get("draft_bl")
        if not bl_payload:
            card_text = f"🚢 <b>Bill of Lading</b>\n\nNo B/L document extracted for <code>{html.escape(query_ref)}</code>."
            buttons = [[{"text": "🔙 Back to Summary", "callback_data": f"status:{query_ref}"}]]
        else:
            card_text, buttons = format_bl_card(case, company_name, bl_payload)
    else:
        return False

    safe_edit_or_send(
        chat_id=chat_id,
        text=card_text,
        message_id=message_id,
        parse_mode="HTML",
        link_preview_options={"is_disabled": True},
        reply_markup={"inline_keyboard": buttons} if buttons else None,
    )
    return True


def handle_status_command(db, chat_id: str, query_ref: str | None, message_id: int | None = None) -> bool:
    if not query_ref:
        safe_send_message(
            chat_id=chat_id,
            text=(
                "ℹ️ <b>Usage:</b> <code>/status &lt;invoice_no&gt;</code>\n"
                "Example: <code>/status AJ26XJL012</code>\n\n"
                "💡 <i>Tip: Type</i> <code>/pending</code> <i>to see all shipments awaiting review.</i>"
            ),
            parse_mode="HTML",
        )
        return True

    recipient = db.scalar(select(TelegramRecipient).where(TelegramRecipient.chat_id == chat_id))
    if not recipient:
        safe_send_message(
            chat_id=chat_id,
            text="Link your Harborway account before checking shipment status.",
        )
        return True

    case = db.scalar(
        select(IntakeCase)
        .where(
            IntakeCase.workspace_id == recipient.workspace_id,
            IntakeCase.detected_reference.ilike(f"%{query_ref}%"),
        )
        .order_by(IntakeCase.created_at.desc())
        .limit(1)
    )
    if not case:
        safe_edit_or_send(
            chat_id=chat_id,
            text=(
                f"❌ No shipment found matching <code>{html.escape(query_ref)}</code>.\n\n"
                "Type <code>/pending</code> to see active shipments."
            ),
            message_id=message_id,
            parse_mode="HTML",
        )
        return True

    snapshot = db.scalar(
        select(ReviewSnapshot).where(
            ReviewSnapshot.intake_case_id == case.id,
            ReviewSnapshot.revision == case.analysis_revision,
        )
    )
    payloads = (
        db.scalars(
            select(DocumentExtraction.payload).where(
                DocumentExtraction.snapshot_id == snapshot.id
            )
        ).all()
        if snapshot
        else []
    )
    company = db.get(Company, case.company_id) if case.company_id else None
    from shipping_ai.approvals.review import latest_review

    review = latest_review(db, case)

    if snapshot:
        card_text, _, button_rows = format_card(
            case, company.name if company else None, snapshot, payloads, review
        )
        safe_edit_or_send(
            chat_id=chat_id,
            text=card_text,
            message_id=message_id,
            parse_mode="HTML",
            link_preview_options={"is_disabled": True},
            reply_markup={"inline_keyboard": button_rows} if button_rows else None,
        )
    else:
        safe_edit_or_send(
            chat_id=chat_id,
            text=(
                f"🚢 <b>Shipment:</b> <code>{html.escape(case.detected_reference or str(case.id)[:8])}</code>\n"
                f"Status: <b>{case.state}</b>\nAnalysis is currently pending."
            ),
            message_id=message_id,
            parse_mode="HTML",
        )
    return True


def handle_pending_command(db, chat_id: str) -> bool:
    recipient = db.scalar(select(TelegramRecipient).where(TelegramRecipient.chat_id == chat_id))
    if not recipient:
        safe_send_message(
            chat_id=chat_id,
            text="Link your Harborway account first to see pending shipments.",
        )
        return True

    cases = db.scalars(
        select(IntakeCase)
        .where(
            IntakeCase.workspace_id == recipient.workspace_id,
            IntakeCase.state.in_(["needs_review", "ready_for_approval"]),
        )
        .order_by(IntakeCase.created_at.desc())
        .limit(5)
    ).all()

    if not cases:
        safe_send_message(
            chat_id=chat_id,
            text="🎉 <b>All caught up!</b>\n\nNo shipments currently require review in this workspace.",
            parse_mode="HTML",
            reply_markup={"inline_keyboard": [[{"text": "🔄 Refresh", "callback_data": "pending"}]]},
        )
        return True

    pending_lines = ["📋 <b>Shipments Awaiting Review:</b>\n"]
    for c in cases:
        ref = c.detected_reference or str(c.id)[:8]
        badge = "🟢 Ready for Approval" if c.state == "ready_for_approval" else "🟡 Needs Review"
        pending_lines.append(f"• <code>{html.escape(ref)}</code> — {badge}")
    pending_lines.append("\nType <code>/status &lt;ref&gt;</code> to view full details.")

    inbox_url = f"{settings().origin}/inbox"
    buttons: list[list[dict]] = []
    if is_public_url(inbox_url):
        if settings().web_origin.scheme == "https":
            buttons.append([{"text": "📥 Open Inbox in Telegram", "web_app": {"url": inbox_url}}])
        else:
            buttons.append([{"text": "📥 Open Inbox ↗", "url": inbox_url}])
    else:
        pending_lines.append(f"\n🔗 <a href='{inbox_url}'>Open Inbox in Harborway ↗</a>")

    buttons.append([{"text": "🔄 Refresh List", "callback_data": "pending"}])

    safe_send_message(
        chat_id=chat_id,
        text="\n".join(pending_lines),
        parse_mode="HTML",
        link_preview_options={"is_disabled": True},
        reply_markup={"inline_keyboard": buttons} if buttons else None,
    )
    return True


def process_update(db, redis_client, update: dict) -> bool:
    # 1. Handle interactive callback buttons (Refresh, Invoice, Packing List, B/L)
    callback_query = update.get("callback_query")
    if callback_query:
        query_id = callback_query.get("id")
        cb_message = callback_query.get("message") or {}
        chat = cb_message.get("chat") or {}
        chat_id = str(chat.get("id") or callback_query.get("from", {}).get("id") or "")
        message_id = cb_message.get("message_id")
        data = (callback_query.get("data") or "").strip()

        try:
            api("answerCallbackQuery", {"callback_query_id": query_id})
        except TelegramError:
            pass

        if not chat_id:
            return False

        if data.startswith("doc:"):
            parts = data.split(":", 2)
            if len(parts) == 3:
                doc_type = parts[1]
                ref = parts[2]
                return handle_document_command(db, chat_id, doc_type, ref, message_id)
        elif data.startswith("status:"):
            ref = data.removeprefix("status:").strip()
            return handle_status_command(db, chat_id, ref, message_id=message_id)
        elif data == "pending":
            return handle_pending_command(db, chat_id)
        return True

    # 2. Handle text messages & commands
    message = update.get("message") or update.get("edited_message")
    if not message:
        return False
    chat = message.get("chat", {})
    chat_id = str(chat.get("id", ""))
    chat_type = chat.get("type", "")
    text = (message.get("text") or "").strip()

    if chat_type != "private" or not chat_id:
        return False

    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        if len(parts) > 1:
            arg = parts[1].strip()
            token = (
                arg.removeprefix("harborway_").removeprefix("pair_")
                if arg.startswith(("harborway_", "pair_"))
                else arg
            )
            saved = redis_client.getdel(f"shipping:telegram_pair:{token}")
            if saved:
                try:
                    workspace_id_str, user_id_str = json.loads(saved)
                    workspace_id = UUID(workspace_id_str)
                    user_id = UUID(user_id_str)
                except (ValueError, TypeError, KeyError):
                    safe_send_message(
                        chat_id=chat_id,
                        text="This pairing link is corrupted. Generate a new link in Harborway.",
                    )
                    return True

                user = db.scalar(
                    select(User)
                    .join(WorkspaceMember)
                    .where(
                        WorkspaceMember.workspace_id == workspace_id,
                        User.id == user_id,
                        User.active.is_(True),
                    )
                )
                if not user:
                    safe_send_message(
                        chat_id=chat_id,
                        text="The staff account for this link is inactive or no longer in this workspace.",
                    )
                    return True

                name = " ".join(part for part in [chat.get("first_name"), chat.get("last_name")] if part)
                db.execute(
                    insert(TelegramRecipient)
                    .values(
                        workspace_id=workspace_id,
                        user_id=user.id,
                        chat_id=chat_id,
                        display_name=(name or "Private chat")[:254],
                    )
                    .on_conflict_do_update(
                        constraint="uq_telegram_workspace_chat",
                        set_={"user_id": user.id, "display_name": (name or "Private chat")[:254]},
                    )
                )
                db.add(ActivityEvent(actor_type="staff", actor_id=user.id, event_type="telegram_linked"))
                db.commit()

                setup_bot_menus(chat_id)

                safe_send_message(
                    chat_id=chat_id,
                    text=(
                        "✅ <b>Account Linked Successfully!</b>\n\n"
                        f"👤 <b>Connected as:</b> <code>{html.escape(user.email)}</code>\n"
                        f"🏢 <b>Display:</b> {html.escape(name or 'Private chat')}\n\n"
                        "You will now receive shipment review alerts and approval links here.\n\n"
                        "💡 <i>Tip: Tap the menu button below or type</i> <code>/status</code> <i>to check active shipments.</i>"
                    ),
                    parse_mode="HTML",
                )
                return True
            else:
                safe_send_message(
                    chat_id=chat_id,
                    text="⚠️ This connection link has expired or was already used. Generate a new link in Harborway Settings.",
                )
                return True
        else:
            setup_bot_menus(chat_id)
            recipient = db.scalar(select(TelegramRecipient).where(TelegramRecipient.chat_id == chat_id))
            if recipient:
                user = db.get(User, recipient.user_id)
                email = user.email if user else "Staff"
                safe_send_message(
                    chat_id=chat_id,
                    text=(
                        "👋 <b>Welcome back to Harborway!</b>\n\n"
                        f"👤 <b>Connected as:</b> <code>{html.escape(email)}</code>\n\n"
                        "<b>Commands:</b>\n"
                        "• <code>/status &lt;invoice_no&gt;</code> — Check shipment draft\n"
                        "• <code>/pending</code> — List shipments needing review\n"
                        "• <code>/whoami</code> — Show account details\n"
                        "• <code>/help</code> — Show command reference"
                    ),
                    parse_mode="HTML",
                )
            else:
                safe_send_message(
                    chat_id=chat_id,
                    text=(
                        f"👋 <b>Welcome to Harborway Shipping Bot!</b>\n\n"
                        f"Your Chat ID: <code>{chat_id}</code>\n\n"
                        "To connect this chat, open <b>Harborway → Settings → Integrations</b> and click <b>Generate link</b>."
                    ),
                    parse_mode="HTML",
                )
            return True

    if text in ("/whoami", "/account"):
        recipient = db.scalar(select(TelegramRecipient).where(TelegramRecipient.chat_id == chat_id))
        if recipient:
            user = db.get(User, recipient.user_id)
            email = user.email if user else "Staff"
            safe_send_message(
                chat_id=chat_id,
                text=(
                    "👤 <b>Harborway Account:</b>\n"
                    f"• <b>Email:</b> <code>{html.escape(email)}</code>\n"
                    f"• <b>Name:</b> {html.escape(recipient.display_name)}\n"
                    f"• <b>Chat ID:</b> <code>{chat_id}</code>\n"
                    "• <b>Status:</b> 🟢 Active & Linked"
                ),
                parse_mode="HTML",
            )
        else:
            safe_send_message(
                chat_id=chat_id,
                text=(
                    f"❌ <b>Not connected.</b>\nYour Chat ID: <code>{chat_id}</code>\n"
                    "Generate a connection link in Harborway Settings → Integrations."
                ),
                parse_mode="HTML",
            )
        return True

    if text.startswith("/help"):
        lines = [
            "📖 <b>Harborway Operations Bot</b>\n",
            "• <code>/status &lt;invoice_no&gt;</code> — Check shipment draft status (e.g. <code>/status AJ26XJL012</code>)",
            "• <code>/pending</code> — List shipments currently awaiting review or approval",
            "• <code>/whoami</code> — Show your linked staff account & Chat ID",
            "• <code>/help</code> — Show this command guide",
        ]
        safe_send_message(
            chat_id=chat_id,
            text="\n".join(lines),
            parse_mode="HTML",
        )
        return True

    if text.startswith("/pending"):
        return handle_pending_command(db, chat_id)

    if text.startswith("/status"):
        parts = text.split(maxsplit=1)
        query_ref = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
        return handle_status_command(db, chat_id, query_ref)

    return False


def sync_updates(db, redis_client) -> int:
    offset_key = "shipping:telegram_update_offset"
    offset_val = redis_client.get(offset_key)
    offset = int(offset_val) if offset_val and offset_val.decode().isdigit() else 0

    try:
        updates = api(
            "getUpdates",
            {
                "offset": offset,
                "limit": 50,
                "timeout": 0,
                "allowed_updates": ["message", "edited_message", "callback_query"],
            },
        )
    except TelegramError as exc:
        log.warning("Telegram getUpdates failed: %s", exc)
        return 0

    if not updates or not isinstance(updates, list):
        return 0

    max_update_id = offset
    count = 0
    for update in updates:
        update_id = update.get("update_id", 0)
        if update_id >= max_update_id:
            max_update_id = update_id + 1
        try:
            if process_update(db, redis_client, update):
                count += 1
        except Exception as exc:
            log.exception("Error processing Telegram update %s: %s", update_id, exc)
        finally:
            if max_update_id > offset:
                redis_client.set(offset_key, max_update_id)

    return count
