import hashlib
import html
import json
import logging
import re
from datetime import date, datetime, timedelta
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
    CompanyMember,
    DocumentExtraction,
    IntakeCase,
    ReviewSnapshot,
    StaffReview,
    TelegramDelivery,
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


def sanitize_button_url(url: str) -> str:
    if "://localhost" in url:
        return url.replace("://localhost", "://127.0.0.1")
    return url


def sanitize_reply_markup(reply_markup: dict | None) -> dict | None:
    if not reply_markup or not isinstance(reply_markup, dict):
        return reply_markup
    keyboard = reply_markup.get("inline_keyboard")
    if not keyboard or not isinstance(keyboard, list):
        return reply_markup

    cleaned_keyboard = []
    for row in keyboard:
        cleaned_row = []
        for btn in row:
            if isinstance(btn, dict):
                cleaned_btn = dict(btn)
                if "url" in cleaned_btn and isinstance(cleaned_btn["url"], str):
                    cleaned_btn["url"] = sanitize_button_url(cleaned_btn["url"])
                if "web_app" in cleaned_btn and isinstance(cleaned_btn["web_app"], dict):
                    wa = dict(cleaned_btn["web_app"])
                    if "url" in wa and isinstance(wa["url"], str):
                        wa["url"] = sanitize_button_url(wa["url"])
                    cleaned_btn["web_app"] = wa
                cleaned_row.append(cleaned_btn)
            else:
                cleaned_row.append(btn)
        cleaned_keyboard.append(cleaned_row)

    return {**reply_markup, "inline_keyboard": cleaned_keyboard}


def safe_send_message(
    chat_id: str | int,
    text: str,
    reply_markup: dict | None = None,
    parse_mode: str | None = "HTML",
    link_preview_options: dict | None = None,
) -> dict:
    reply_markup = sanitize_reply_markup(reply_markup)
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
    reply_markup = sanitize_reply_markup(reply_markup)
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


def safe_edit_message(
    chat_id: str | int,
    text: str,
    message_id: int,
    reply_markup: dict | None = None,
    parse_mode: str | None = "HTML",
    link_preview_options: dict | None = None,
) -> bool:
    reply_markup = sanitize_reply_markup(reply_markup)
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
        api("editMessageText", payload)
        return True
    except TelegramError as exc:
        if "message is not modified" in str(exc).lower():
            return True
        log.info("Telegram editMessageText skipped (%s)", exc)
        return False


def enabled_bot() -> bool:
    token = settings().telegram_bot_token
    return bool(token and re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", token.get_secret_value()))


def field_value(documents, roles, keys):
    for role in roles:
        entries = [item for item in documents if getattr(item, "role", None) == role]
        if len(entries) != 1:
            continue
        for key in keys:
            field = entries[0].fields.get(key)
            if field and field.value:
                val = str(field.value)
                if key in ("packages", "package_count", "gross_weight", "net_weight", "measurement"):
                    val = format_item_num(val)
                return " ".join(part for part in (val, getattr(field, "currency", None), getattr(field, "unit", None)) if part)
    return "Pending"


def format_date_readable(val) -> str:
    if not val:
        return "Pending"
    val_str = str(val).strip()
    try:
        f = float(val_str)
        if 35000 <= f <= 55000:
            d = date(1899, 12, 30) + timedelta(days=int(f))
            return d.strftime("%d-%b-%Y")
    except (ValueError, TypeError):
        pass
    for fmt in ("%d-%b-%Y", "%d %b %Y", "%d %B %Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            d = datetime.strptime(val_str, fmt)
            return d.strftime("%d-%b-%Y")
        except ValueError:
            pass
    return val_str


def resolve_bl_no(documents, excerpts=None) -> str:
    for doc in documents:
        if getattr(doc, "role", None) == "draft_bl":
            f = doc.fields.get("bl_no") if hasattr(doc, "fields") else None
            if f and getattr(f, "value", None):
                return str(f.value).strip()
    if excerpts:
        for ex in excerpts:
            raw = ex if isinstance(ex, str) else getattr(ex, "raw", None) or (ex.get("raw") if isinstance(ex, dict) else "")
            m = re.search(r"\b(RCLY\d+(?:\+RCLY\d+)?|CPL[0-9O]\d+|OOLU\d+|SITP[A-Z0-9]+|SIH\d+)\b", raw or "", re.I)
            if m:
                val = m.group(1).upper()
                if val.startswith("CPLO"):
                    val = "CPL0" + val[4:]
                return val
    return "Pending"


def resolve_issue_date(documents, excerpts=None) -> str:
    for doc in documents:
        if getattr(doc, "role", None) == "draft_bl":
            f = doc.fields.get("issue_date") if hasattr(doc, "fields") else None
            if f and getattr(f, "value", None):
                return format_date_readable(f.value)
    for doc in documents:
        if getattr(doc, "role", None) == "invoice":
            f = doc.fields.get("invoice_date") if hasattr(doc, "fields") else None
            if f and getattr(f, "value", None):
                return format_date_readable(f.value)
    if excerpts:
        for ex in excerpts:
            raw = ex if isinstance(ex, str) else getattr(ex, "raw", None) or (ex.get("raw") if isinstance(ex, dict) else "")
            m = re.search(r"(?:Date\s+of\s+Invoice|Invoice\s*Date|Issue\s*Date|Date\s*:)[\s|:：]*([A-Za-z0-9\-/\.]+)", raw or "", re.I)
            if m:
                cand = m.group(1).strip()
                res = format_date_readable(cand)
                if res != "Pending":
                    return res
    return "Pending"


def resolve_port(documents, excerpts=None) -> str:
    raw_val = ""
    dest_val = ""
    for doc in documents:
        if getattr(doc, "role", None) == "draft_bl":
            if hasattr(doc, "fields"):
                p = doc.fields.get("port")
                if p and getattr(p, "value", None):
                    raw_val = str(p.value).strip()
                d = doc.fields.get("destination")
                if d and getattr(d, "value", None):
                    dest_val = str(d.value).strip()

    ex_texts = []
    if excerpts:
        for ex in excerpts:
            raw = ex if isinstance(ex, str) else getattr(ex, "raw", None) or (ex.get("raw") if isinstance(ex, dict) else "")
            if raw:
                ex_texts.append(raw)

    all_text = " ".join([raw_val, dest_val] + ex_texts)

    m_dis = re.search(r"(?:Place|Port)\s+of\s+Discharge\s*[:：]?\s*([^\n\r]+)", all_text, re.I)
    if m_dis:
        candidate = m_dis.group(1).strip()
        if "PREY VOR" in candidate.upper():
            return "Prey Vor border"
        if "BAVET" in candidate.upper():
            return "Bavet border"
        if "SIHANOUKVILLE" in candidate.upper():
            return "SIHANOUKVILLE"
        if "PHNOM PENH" in candidate.upper():
            return "Phnom Penh"
        if 2 < len(candidate) < 40 and not any(kw in candidate.lower() for kw in ["tariff", "clause", "carrier", "demurrage"]):
            return candidate

    for pat, name in [
        (r"PREY\s+VOR", "Prey Vor border"),
        (r"BAVET", "Bavet border"),
        (r"POIPET", "Poipet border"),
        (r"CHAM\s+YEAM", "Cham Yeam border"),
        (r"TRAPEANG\s+SRE", "Trapeang Sre border"),
        (r"SIHANOUKVILLE", "SIHANOUKVILLE"),
        (r"PHNOM\s+PENH", "Phnom Penh"),
    ]:
        if re.search(pat, all_text, re.I):
            return name

    if raw_val and raw_val not in ("", "None", "Pending"):
        return raw_val
    if dest_val and dest_val not in ("", "None", "Pending"):
        return dest_val
    return "Pending"


def resolve_container(documents, excerpts=None) -> str:
    raw_val = ""
    for doc in documents:
        if getattr(doc, "role", None) == "draft_bl":
            if hasattr(doc, "fields"):
                c = doc.fields.get("container")
                if c and getattr(c, "value", None):
                    raw_val = str(c.value).strip()

    c_num = ""
    c_type = ""
    ex_texts = []
    if excerpts:
        for ex in excerpts:
            raw = ex if isinstance(ex, str) else getattr(ex, "raw", None) or (ex.get("raw") if isinstance(ex, dict) else "")
            if raw:
                ex_texts.append(raw)

    all_text = " ".join([raw_val] + ex_texts)

    m_iso = re.search(r"\b([A-Z]{3}[UJZ]\s*\d{7}|[A-Z]{4}\s*\d{7})\b", all_text, re.I)
    if m_iso:
        c_num = re.sub(r"\s+", "", m_iso.group(1).upper())

    m_t = re.search(r"\b(\d+\s*[xX*]\s*(?:20|40|45)\s*(?:HC|HQ|GP|OT|FR|RF|RH))\b", all_text, re.I)
    if m_t:
        c_type = re.sub(r"\s+", "", m_t.group(1)).upper().replace("X", "x").replace("*", "x")

    if c_num and c_type:
        return f"{c_num} / {c_type}"
    if c_num:
        return c_num
    if c_type:
        return c_type
    if raw_val and raw_val not in ("", "None", "Pending"):
        return raw_val
    return "Pending"


def invoice_value(documents):
    invoices = [doc for doc in documents if doc.role == "invoice"]
    if len(invoices) != 1:
        return "Pending"
    invoice = invoices[0]
    reported = invoice.fields.get("amount")
    reported_value = decimal(usable(reported))
    if reported_value is not None and reported.currency:
        formatted = format_item_num(reported_value, decimals=2, force_decimals=True)
        return f"{formatted} {reported.currency}"
    fields = [line.fields.get("amount") for line in invoice.items]
    amounts = [decimal(usable(field)) for field in fields]
    currencies = {field.currency for field in fields if field}
    if (
        len(currencies) == 1
        and None not in currencies
        and amounts
        and all(value is not None for value in amounts)
    ):
        formatted = format_item_num(sum(amounts), decimals=2, force_decimals=True)
        return f"{formatted} {currencies.pop()}"
    return "Pending"


def draft_url(case, review=None) -> str:
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
    findings = snapshot.findings if snapshot else []
    issues = sum(finding.get("outcome") != "PASS" for finding in findings)
    v_diff = getattr(snapshot, "version_diff", None) or {}
    quick = bool(
        case.state == "ready_for_approval"
        and case.company_id
        and snapshot
        and snapshot.outcome == "PASS"
        and issues == 0
        and review
        and review.ready
        and not review.payload.get("corrections")
        and not review.payload.get("permit_pending")
        and not v_diff.get("requires_final_confirmation")
    )
    approval_map = {
        "approved": "✅ Approved",
        "rejected": "❌ Rejected",
        "ready_for_approval": "🟢 Ready for Approval",
        "awaiting_updated_document": "⏳ Awaiting Updated Document",
        "manual_matching": "🔍 Manual Matching Required",
    }
    approval_text = approval_map.get(case.state, "🟡 Review Required")

    status_icon = (
        "✅"
        if snapshot and snapshot.outcome == "PASS"
        else "⚠️"
        if snapshot and snapshot.outcome == "MISMATCH"
        else "ℹ️"
    )
    outcome_text = snapshot.outcome.replace("_", " ").title() if snapshot else "Pending"

    ref = (
        case.detected_reference
        or field_value(documents, ("invoice",), ("invoice_no",))
        or str(case.id)[:8]
    )

    revision_str = f" (Revision #{case.analysis_revision})" if case.analysis_revision > 1 else ""
    lines = [
        "🚢 Shipping Draft",
        "",
        f"📄 Reference: {ref}{revision_str}",
        f"🏢 Company: {company or 'Unassigned'}",
    ]

    if v_diff.get("has_revisions"):
        lines.append("")
        if v_diff.get("is_final_bl"):
            lines.append("• 🚢 Final B/L (Telex / Original) received")
        diffs = v_diff.get("diffs") or []
        change_bullets = []
        for d in diffs:
            for f, vals in (d.get("modified") or {}).items():
                old_val = str(vals.get("old", ""))
                new_val = str(vals.get("new", ""))
                flabel = clean_field_label(f)
                if len(new_val) > 40 or len(old_val) > 40:
                    change_bullets.append(f"• {flabel}: Updated")
                else:
                    change_bullets.append(
                        f"• {flabel}: {format_item_num(old_val)} → {format_item_num(new_val)}"
                    )
            for f, val in (d.get("added") or {}).items():
                val_str = str(val)
                flabel = clean_field_label(f)
                if len(val_str) > 40:
                    change_bullets.append(f"• {flabel}: Added")
                else:
                    change_bullets.append(
                        f"• {flabel}: {format_item_num(val_str)} (added)"
                    )
        if change_bullets:
            lines.append("📝 Key Updates:")
            lines.extend(change_bullets[:5])
        elif v_diff.get("summary") and isinstance(v_diff.get("summary"), str):
            lines.append(f"• Revision updates: {v_diff['summary'][:120]}")

    lines.extend([
        "",
        "📦 Shipment Summary:",
    ])

    excerpts = []
    for doc in documents:
        excerpts.extend(getattr(doc, "source_excerpt", []))

    for label, keys, roles in SHIPMENT_FIELDS:
        value = " ".join(field_value(documents, roles, keys).split())[:240]
        if value == "Pending" and label == "Bill of lading":
            fallback_bl = resolve_bl_no(documents, excerpts)
            if fallback_bl and fallback_bl != "Pending":
                value = fallback_bl
        lines.append(f"• {label}: {value}")

    port_val = resolve_port(documents, excerpts)
    if port_val and port_val != "Pending":
        lines.append(f"• Port / Border: {port_val}")

    lines.append(f"• Invoice value: {invoice_value(documents)}")

    lines.extend([
        "",
        f"🔍 Verification: {status_icon} {outcome_text} ({issues} findings)",
        f"🚦 Status: {approval_text}",
        "",
        f"🔗 {'Approve draft' if quick else 'Review draft'}: {draft_url(case, review if quick else None)}",
    ])

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
    if is_public and origin.scheme == "https":
        if review and case.state in ("needs_review", "ready_for_approval"):
            action_row.extend([
                {"text": "✅ Quick Approve", "web_app": {"url": f"{url}&decision=approve"}},
                {"text": "❌ Quick Reject", "web_app": {"url": f"{url}&decision=reject"}},
            ])
        elif case.state == "approved":
            action_row.append({"text": "📋 View Import in Telegram", "web_app": {"url": url}})
        else:
            action_row.append({"text": "🔍 Review in Telegram", "web_app": {"url": url}})
    else:
        action_label = "📋 View Import Record ↗" if case.state == "approved" else "🔗 Open Detail ↗"
        action_row.append({"text": action_label, "url": url})

    action_row.append({"text": "🔄 Refresh", "callback_data": f"status:{ref}"})
    rows.append(action_row)
    return rows


def format_card(case, company, snapshot, extracted, review) -> tuple[str, bool, list[list[dict]]]:
    source = review.payload["documents"] if review and review.ready else extracted
    documents = [Extraction.model_validate(item) for item in source]
    findings = snapshot.findings
    issues = sum(finding.get("outcome") != "PASS" for finding in findings)
    v_diff = getattr(snapshot, "version_diff", None) or {}
    quick = bool(
        case.state == "ready_for_approval"
        and case.company_id
        and snapshot.outcome == "PASS"
        and issues == 0
        and review
        and review.ready
        and not review.payload.get("corrections")
        and not review.payload.get("permit_pending")
        and not v_diff.get("requires_final_confirmation")
    )

    ref = (
        case.detected_reference
        or field_value(documents, ("invoice",), ("invoice_no",))
        or str(case.id)[:8]
    )
    company_name = company or "Unassigned"
    inv_val = invoice_value(documents)

    excerpts = []
    for doc in documents:
        excerpts.extend(getattr(doc, "source_excerpt", []))

    bl_val = resolve_bl_no(documents, excerpts)
    issue_date_val = resolve_issue_date(documents, excerpts)
    port_val = resolve_port(documents, excerpts)
    container_val = resolve_container(documents, excerpts)
    origin_val = field_value(documents, ("draft_bl", "invoice", "packing_list"), ("origin",))
    dest_val = field_value(documents, ("draft_bl", "packing_list", "invoice"), ("destination",))
    legs_val = field_value(documents, ("draft_bl",), ("route_legs",))
    mode_val = field_value(documents, ("draft_bl",), ("shipping_mode",))

    p_up = (port_val or "").strip().upper()
    d_up = (dest_val or "").strip().upper()
    is_3leg = legs_val == "3_legs" or (
        p_up
        and d_up
        and p_up != d_up
        and not ("SIHANOUK" in p_up and "SIHANOUK" in d_up)
        and d_up not in ("", "PENDING")
    )

    route_type_desc = (
        "3-Leg (Cross-Border Truck)"
        if (is_3leg and "TRUCK" in mode_val.upper())
        else ("3-Leg (Multimodal)" if is_3leg else "2-Leg (Direct Sea)")
    )

    transport_lines = [
        "📑 <b>B/L & Transport Details:</b>",
        f"• <b>B/L No:</b> <code>{html.escape(bl_val)}</code>",
        f"• <b>Issue Date:</b> {html.escape(issue_date_val)}",
        f"• <b>Route:</b> {route_type_desc}",
    ]
    if origin_val and origin_val != "Pending":
        transport_lines.append(f"• <b>Origin:</b> {html.escape(origin_val[:80])}")
    if is_3leg:
        transport_lines.append(f"• <b>Port / Border:</b> {html.escape(port_val)}")
        if dest_val and dest_val != "Pending":
            transport_lines.append(f"• <b>Destination:</b> {html.escape(dest_val[:80])}")
    else:
        transport_lines.append(f"• <b>Port / Discharge:</b> {html.escape(port_val)}")
    transport_lines.append(f"• <b>Container:</b> {html.escape(container_val)}")

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
        "awaiting_updated_document": "⏳ Awaiting Updated Document",
        "manual_matching": "🔍 Manual Matching Required",
    }
    approval_text = approval_map.get(case.state, "🟡 Review Required")

    url = draft_url(case, review if quick else None)

    revision_lines: list[str] = []
    if v_diff.get("has_revisions"):
        revision_lines.append("")
        revision_lines.append("🔄 <b>Document Revision Updates:</b>")
        if v_diff.get("is_final_bl"):
            revision_lines.append("• 🚢 <b>Final B/L (Telex / Original) received</b>")
        desc = v_diff.get("summary") if isinstance(v_diff.get("summary"), str) else (v_diff.get("summary", {}).get("description") if isinstance(v_diff.get("summary"), dict) else v_diff.get("details", {}).get("description"))
        if desc:
            revision_lines.append(f"• {html.escape(desc)}")

    lines = [
        f"🚢 <b>Shipping draft:</b> <code>{html.escape(ref)}</code>",
        f"🏢 <b>Company:</b> {html.escape(company_name)}",
        *revision_lines,
        "",
        "📦 <b>Cargo & Value:</b>",
        f"• <b>Invoice Value:</b> <code>{html.escape(inv_val)}</code>",
        f"• <b>Packages:</b> {html.escape(pkg_val)}",
        f"• <b>Gross Weight:</b> {html.escape(gw_val)}",
        "",
        *transport_lines,
        "",
        "📋 <b>Parties:</b>",
        f"• <b>Shipper:</b> {html.escape(shipper_val[:120])}",
        f"• <b>Consignee:</b> {html.escape(consignee_val[:120])}",
        "",
        f"🔍 <b>Verification:</b> {status_icon} <b>{outcome_text}</b> ({issues} findings)",
        f"🚦 <b>Approval Status:</b> {approval_text}",
        "",
        f"🔗 <a href='{url}'>{'Open Accepted Import in Harborway ↗' if case.state == 'approved' else 'Open Rejected Intake in Harborway ↗' if case.state == 'rejected' else 'Open Draft in Harborway ↗'}</a>",
    ]
    buttons = card_buttons(case, review if quick else None)
    return "\n".join(lines), quick, buttons


def format_item_num(val, decimals: int = 2, force_decimals: bool = False) -> str:
    if val is None or val == "":
        return "Pending"
    val_str = str(val).replace(",", "").strip()
    if not val_str:
        return "Pending"
    try:
        f = float(val_str)
        if not force_decimals and f.is_integer():
            return f"{int(f):,}"
        formatted = f"{f:,.{decimals}f}"
        return formatted
    except (ValueError, TypeError):
        return val_str


def format_invoice_card(case, company_name: str | None, payload: dict) -> tuple[str, list[list[dict]]]:
    ref = case.detected_reference or str(case.id)[:8]
    fields = payload.get("fields", {})
    excerpts = payload.get("source_excerpt", [])
    inv_no = fields.get("invoice_no", {}).get("value") or ref
    inv_date = resolve_issue_date([], excerpts) if not fields.get("invoice_date", {}).get("value") else format_date_readable(fields.get("invoice_date", {}).get("value"))
    raw_total_amt = fields.get("amount", {}).get("value")
    total_amt = format_item_num(raw_total_amt) if raw_total_amt is not None else "Pending"
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
        f"• <b>Invoice Date:</b> {html.escape(str(inv_date))}",
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
            raw_qty = i_fields.get("quantity", {}).get("value")
            unit = i_fields.get("quantity", {}).get("unit") or i_fields.get("unit", {}).get("value") or ""
            raw_price = i_fields.get("unit_price", {}).get("value")
            raw_amt = i_fields.get("amount", {}).get("value")

            qty_str = f"{format_item_num(raw_qty)} {unit}".strip() if raw_qty is not None else "Pending"
            price_str = f"{format_item_num(raw_price, force_decimals=True)} {currency}" if raw_price is not None else "Pending"
            amt_str = f"{format_item_num(raw_amt)} {currency}" if raw_amt is not None else "Pending"

            lines.append(f"{idx}. <b>{html.escape(str(desc))}</b>")
            lines.append(f"   • QTY: <code>{html.escape(qty_str)}</code>")
            lines.append(f"   • PRICE: <code>{html.escape(price_str)}</code>")
            lines.append(f"   • AMOUNT: <code>{html.escape(amt_str)}</code>")
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
    raw_gw = fields.get("gross_weight", {}).get("value") or fields.get("weight", {}).get("value")
    gw = format_item_num(raw_gw) if raw_gw is not None else "Pending"
    gw_unit = fields.get("gross_weight", {}).get("unit") or "KG"
    raw_nw = fields.get("net_weight", {}).get("value")
    nw = format_item_num(raw_nw) if raw_nw is not None else None
    nw_unit = fields.get("net_weight", {}).get("unit") or "KG"
    raw_pkgs = fields.get("packages", {}).get("value") or fields.get("package_count", {}).get("value")
    pkgs = format_item_num(raw_pkgs, decimals=0) if raw_pkgs is not None else "Pending"
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
            raw_qty = i_fields.get("quantity", {}).get("value")
            unit = i_fields.get("quantity", {}).get("unit") or i_fields.get("unit", {}).get("value") or ""
            raw_nw = i_fields.get("net_weight", {}).get("value") or i_fields.get("nw", {}).get("value")
            raw_gw = i_fields.get("gross_weight", {}).get("value") or i_fields.get("gw", {}).get("value")
            raw_pkgs = i_fields.get("packages", {}).get("value")

            qty_str = f"{format_item_num(raw_qty)} {unit}".strip() if raw_qty is not None else "Pending"
            nw_str = f"{format_item_num(raw_nw)} {nw_unit}".strip() if raw_nw is not None else None
            gw_str = f"{format_item_num(raw_gw)} {gw_unit}".strip() if raw_gw is not None else None

            lines.append(f"{idx}. <b>{html.escape(str(desc))}</b>")
            lines.append(f"   • QTY: <code>{html.escape(qty_str)}</code>")
            if nw_str:
                lines.append(f"   • NW: <code>{html.escape(nw_str)}</code>")
            if gw_str:
                lines.append(f"   • GW: <code>{html.escape(gw_str)}</code>")
            if raw_pkgs and not nw_str and not gw_str:
                lines.append(f"   • PKGS: <code>{html.escape(str(raw_pkgs))}</code>")
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


def format_bl_card(case, company_name: str | None, payload: dict, all_docs: dict | None = None) -> tuple[str, list[list[dict]]]:
    ref = case.detected_reference or str(case.id)[:8]
    fields = payload.get("fields", {})
    excerpts = payload.get("source_excerpt", [])

    doc_dummy = Extraction(
        document_id=case.id,
        role="draft_bl",
        status="extracted",
        method="extract",
        fields=fields,
        source_excerpt=excerpts,
    )
    bl_no = resolve_bl_no([doc_dummy], excerpts)
    issue_date = resolve_issue_date([doc_dummy], excerpts)
    if issue_date == "Pending" and all_docs:
        inv_doc = all_docs.get("invoice", {})
        inv_f = inv_doc.get("fields", {}).get("invoice_date", {}).get("value")
        if inv_f:
            issue_date = format_date_readable(inv_f)
        else:
            issue_date = resolve_issue_date([], inv_doc.get("source_excerpt", []))

    port_val = resolve_port([doc_dummy], excerpts)
    container_val = resolve_container([doc_dummy], excerpts)

    destination = fields.get("destination", {}).get("value") or "Pending"
    origin = fields.get("origin", {}).get("value") or "Pending"
    vessel = fields.get("vessel", {}).get("value")
    voyage = fields.get("voyage", {}).get("value")
    carrier = fields.get("carrier", {}).get("value")
    seal = fields.get("seal", {}).get("value")
    raw_pkgs = fields.get("packages", {}).get("value") or fields.get("package_count", {}).get("value")
    pkgs = format_item_num(raw_pkgs, decimals=0) if raw_pkgs is not None else "Pending"
    cargo = fields.get("cargo_summary", {}).get("value") or "Pending"
    shipper = fields.get("shipper", {}).get("value") or fields.get("supplier", {}).get("value") or "Pending"
    consignee = fields.get("consignee", {}).get("value") or company_name or "Pending"
    url = draft_url(case)

    p_up = (port_val or "").strip().upper()
    d_up = (destination or "").strip().upper()
    legs = fields.get("route_legs", {}).get("value")
    mode_str = str(fields.get("shipping_mode", {}).get("value") or "").upper()
    is_3leg = legs == "3_legs" or (
        p_up
        and d_up
        and p_up != d_up
        and not ("SIHANOUK" in p_up and "SIHANOUK" in d_up)
        and d_up not in ("", "PENDING")
    )
    route_type_desc = (
        "3-Leg (Cross-Border Truck)"
        if (is_3leg and "TRUCK" in mode_str)
        else ("3-Leg (Multimodal)" if is_3leg else "2-Leg (Direct Sea)")
    )

    info_lines = [
        "📑 <b>B/L Information:</b>",
        f"• <b>B/L Number:</b> <code>{html.escape(str(bl_no))}</code>",
        f"• <b>Issue Date:</b> {html.escape(str(issue_date))}",
        f"• <b>Route:</b> {route_type_desc}",
    ]
    if origin and origin != "Pending":
        info_lines.append(f"• <b>Origin:</b> {html.escape(str(origin)[:80])}")
    if is_3leg:
        info_lines.append(f"• <b>Port / Border:</b> {html.escape(str(port_val))}")
        if destination and destination != "Pending":
            info_lines.append(f"• <b>Destination:</b> {html.escape(str(destination)[:80])}")
    else:
        info_lines.append(f"• <b>Port / Discharge:</b> {html.escape(str(port_val))}")

    info_lines.append(f"• <b>Container:</b> {html.escape(str(container_val))}")
    if seal:
        info_lines.append(f"• <b>Seal No:</b> {html.escape(str(seal))}")
    info_lines.extend([
        f"• <b>Packages:</b> {html.escape(str(pkgs))}",
        f"• <b>Cargo:</b> {html.escape(str(cargo)[:120])}",
    ])

    lines = [
        "🚢 <b>Bill of Lading Details</b>",
        f"🚢 <b>Reference:</b> <code>{html.escape(ref)}</code>",
        f"🏢 <b>Company:</b> {html.escape(company_name or 'Unassigned')}",
        "",
        *info_lines,
    ]
    if vessel or voyage:
        vv = " / ".join(p for p in (vessel, voyage) if p)
        lines.append(f"• <b>Vessel / Voyage:</b> {html.escape(vv)}")
    if carrier:
        lines.append(f"• <b>Carrier:</b> {html.escape(str(carrier)[:80])}")
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


FIELD_DISPLAY_NAMES = {
    "amount": "Invoice Amount",
    "invoice_no": "Invoice No",
    "invoice_date": "Invoice Date",
    "gross_weight": "Gross Weight",
    "net_weight": "Net Weight",
    "packages": "Packages",
    "measurement": "Measurement",
    "origin": "Origin",
    "destination": "Destination",
    "port": "Port",
    "loading_port": "Loading Port",
    "discharge_port": "Discharge Port",
    "vessel": "Vessel",
    "voyage": "Voyage",
    "carrier": "Carrier",
    "container": "Container No",
    "seal": "Seal No",
    "shipper": "Shipper",
    "supplier": "Supplier",
    "consignee": "Consignee",
    "bill_of_lading": "B/L No",
    "bl_no": "B/L No",
}


def clean_field_label(f: str) -> str:
    return FIELD_DISPLAY_NAMES.get(f.lower(), f.replace("_", " ").title())


def format_status_notification(
    case: IntakeCase,
    company_name: str | None,
    snapshot: ReviewSnapshot | None,
    payloads: list[dict],
    review: StaffReview | None,
    event_type: str,
    actor_name: str | None = None,
    details: dict | None = None,
) -> tuple[str, list[list[dict]]]:
    source = review.payload["documents"] if review and review.ready else payloads
    documents = [Extraction.model_validate(item) for item in source]
    ref = (
        case.detected_reference
        or field_value(documents, ("invoice",), ("invoice_no",))
        or str(case.id)[:8]
    )
    inv_val = invoice_value(documents)
    excerpts = []
    for doc in documents:
        excerpts.extend(getattr(doc, "source_excerpt", []))
    bl_val = resolve_bl_no(documents, excerpts)
    port_val = resolve_port(documents, excerpts)
    container_val = resolve_container(documents, excerpts)
    url = draft_url(case)

    approval_map = {
        "approved": "✅ Approved",
        "rejected": "❌ Rejected",
        "ready_for_approval": "🟢 Ready for Approval",
        "awaiting_updated_document": "⏳ Awaiting Updated Document",
        "manual_matching": "🔍 Manual Matching Required",
    }
    approval_text = approval_map.get(case.state, "🟡 Review Required")

    status_icon = (
        "✅"
        if snapshot and snapshot.outcome == "PASS"
        else "⚠️"
        if snapshot and snapshot.outcome == "MISMATCH"
        else "ℹ️"
    )
    outcome_text = snapshot.outcome.replace("_", " ").title() if snapshot else "Pending"
    issues = sum(
        finding.get("outcome") != "PASS" for finding in (snapshot.findings if snapshot else [])
    )

    if event_type == "approved":
        lines = [
            "✅ <b>Shipment Approved &amp; Import Created</b>",
            "",
            f"🚢 <b>Reference:</b> <code>{html.escape(ref)}</code>",
            f"🏢 <b>Company:</b> {html.escape(company_name or 'Unassigned')}",
            f"👤 <b>Approved by:</b> {html.escape(actor_name or 'Staff')}",
            f"💰 <b>Invoice Value:</b> <code>{html.escape(inv_val)}</code>",
            f"📄 <b>B/L No:</b> <code>{html.escape(bl_val)}</code>",
        ]
        if port_val and port_val != "Pending":
            lines.append(f"📍 <b>Discharge Port:</b> {html.escape(port_val)}")
        if container_val and container_val != "Pending":
            lines.append(f"📦 <b>Container:</b> {html.escape(container_val)}")

        inv_doc = next((d for d in documents if d.role == "invoice"), None)
        if inv_doc and inv_doc.items:
            lines.append("")
            lines.append(f"📦 <b>Approved Line Items ({len(inv_doc.items)}):</b>")
            for idx, item in enumerate(inv_doc.items[:5], 1):
                desc = item.fields.get("description")
                desc_val = desc.value if desc and desc.value else f"Item #{idx}"
                qty_fld = item.fields.get("quantity")
                qty_val = format_item_num(qty_fld.value) if qty_fld and qty_fld.value else ""
                unit_val = qty_fld.unit if qty_fld and qty_fld.unit else "KG"
                price_fld = item.fields.get("unit_price")
                price_val = format_item_num(price_fld.value) if price_fld and price_fld.value else ""
                cur_val = price_fld.currency if price_fld and price_fld.currency else "USD"
                lines.append(f"{idx}. <b>{html.escape(desc_val)}</b>")
                lines.append(f"   • Qty: {qty_val} {unit_val} | Price: {price_val} {cur_val}")
            if len(inv_doc.items) > 5:
                lines.append(f"<i>...and {len(inv_doc.items) - 5} more items in Harborway</i>")

        lines.extend([
            "",
            "🚦 <b>Status:</b> ✅ Accepted — CDC import record created",
            "",
            f"🔗 <a href='{url}'>Open Accepted Record in Harborway ↗</a>",
        ])
        buttons = card_buttons(case, review)
        return "\n".join(lines), buttons

    elif event_type == "rejected":
        notes = (details or {}).get("notes") or "Rejected by staff."
        lines = [
            "❌ <b>Shipment Rejected</b>",
            "",
            f"🚢 <b>Reference:</b> <code>{html.escape(ref)}</code>",
            f"🏢 <b>Company:</b> {html.escape(company_name or 'Unassigned')}",
            f"👤 <b>Rejected by:</b> {html.escape(actor_name or 'Staff')}",
            f"📝 <b>Reason:</b> {html.escape(notes)}",
            "",
            "🚦 <b>Status:</b> ❌ Rejected",
            "",
            f"🔗 <a href='{url}'>View Intake in Harborway ↗</a>",
        ]
        buttons = card_buttons(case, review)
        return "\n".join(lines), buttons

    elif event_type == "revision_received":
        v_diff = (
            (details or {}).get("version_diff")
            or (getattr(snapshot, "version_diff", None) if snapshot else {})
            or {}
        )
        lines = [
            "🔄 <b>Document Revision Received</b>",
            "",
            f"🚢 <b>Reference:</b> <code>{html.escape(ref)}</code> <i>(Revision #{case.analysis_revision})</i>",
            f"🏢 <b>Company:</b> {html.escape(company_name or 'Unassigned')}",
        ]
        if v_diff.get("is_final_bl"):
            lines.append("• 🚢 <b>Final B/L (Telex / Original) received</b>")

        # Format clean, human-readable change bullets instead of dumping raw text
        diffs = v_diff.get("diffs") or []
        change_bullets = []
        for d in diffs:
            for f, vals in (d.get("modified") or {}).items():
                old_val = str(vals.get("old", ""))
                new_val = str(vals.get("new", ""))
                flabel = clean_field_label(f)
                if len(new_val) > 40 or len(old_val) > 40:
                    change_bullets.append(f"• <b>{html.escape(flabel)}:</b> <i>Updated</i>")
                else:
                    old_formatted = format_item_num(old_val)
                    new_formatted = format_item_num(new_val)
                    change_bullets.append(
                        f"• <b>{html.escape(flabel)}:</b> {html.escape(old_formatted)} → <code>{html.escape(new_formatted)}</code>"
                    )
            for f, val in (d.get("added") or {}).items():
                val_str = str(val)
                flabel = clean_field_label(f)
                if len(val_str) > 40:
                    change_bullets.append(f"• <b>{html.escape(flabel)}:</b> <i>Added</i>")
                else:
                    change_bullets.append(
                        f"• <b>{html.escape(flabel)}:</b> <code>{html.escape(format_item_num(val_str))}</code> <i>(added)</i>"
                    )

        if change_bullets:
            lines.append("")
            lines.append("📝 <b>Key Updates:</b>")
            lines.extend(change_bullets[:5])
        elif v_diff.get("summary") and isinstance(v_diff.get("summary"), str):
            short_summary = v_diff["summary"][:120]
            lines.append(f"• <b>Update:</b> {html.escape(short_summary)}")

        lines.extend([
            "",
            f"💰 <b>Invoice Value:</b> <code>{html.escape(inv_val)}</code>",
            f"🔍 <b>Verification:</b> {status_icon} <b>{outcome_text}</b> ({issues} findings)",
            f"🚦 <b>Status:</b> {approval_text}",
            "",
            f"🔗 <a href='{url}'>Review Updated Draft in Harborway ↗</a>",
        ])
        buttons = card_buttons(case, review)
        return "\n".join(lines), buttons

    elif event_type in ("new_intake", "ready_for_review"):
        if snapshot:
            card_text, _, buttons = format_card(
                case, company_name, snapshot, payloads, review
            )
            return "🚢 <b>New Shipment Detected</b>\n\n" + card_text, buttons

        lines = [
            "🚢 <b>New Shipment Detected</b>",
            "",
            f"📄 <b>Reference:</b> <code>{html.escape(ref)}</code>",
            f"🏢 <b>Company:</b> {html.escape(company_name or 'Unassigned')}",
            "",
            f"💰 <b>Invoice Value:</b> <code>{html.escape(inv_val)}</code>",
            f"📄 <b>B/L No:</b> <code>{html.escape(bl_val)}</code>",
            "",
            f"🚦 <b>Status:</b> {approval_text}",
            "",
            f"🔗 <a href='{url}'>Open Draft in Harborway ↗</a>",
        ]
        buttons = card_buttons(case, review)
        return "\n".join(lines), buttons

    elif event_type == "manual_matching":
        reason = (
            (details or {}).get("reason")
            or case.review_reason
            or "Matching identifiers were conflicting or uncertain."
        )
        lines = [
            "🔍 <b>Manual Matching Required</b>",
            "",
            f"📄 <b>Reference:</b> <code>{html.escape(ref)}</code>",
            f"🏢 <b>Company:</b> {html.escape(company_name or 'Unassigned')}",
            "",
            f"⚠️ <b>Reason:</b> {html.escape(reason)}",
            "🚦 <b>Status:</b> 🔍 Manual Matching Required",
            "",
            f"🔗 <a href='{url}'>Open Intake in Harborway ↗</a>",
        ]
        buttons = card_buttons(case, review)
        return "\n".join(lines), buttons

    else:
        lines = [
            "🔔 <b>Shipment Status Update</b>",
            "",
            f"🚢 <b>Reference:</b> <code>{html.escape(ref)}</code>",
            f"🏢 <b>Company:</b> {html.escape(company_name or 'Unassigned')}",
            f"💰 <b>Invoice Value:</b> <code>{html.escape(inv_val)}</code>",
            f"📄 <b>B/L No:</b> <code>{html.escape(bl_val)}</code>",
            f"🔍 <b>Verification:</b> {status_icon} <b>{outcome_text}</b> ({issues} findings)",
            f"🚦 <b>Status:</b> {approval_text}",
            "",
            f"🔗 <a href='{url}'>Open Draft in Harborway ↗</a>",
        ]
        buttons = card_buttons(case, review)
        return "\n".join(lines), buttons


def update_previous_deliveries(
    db,
    case: IntakeCase,
    snapshot: ReviewSnapshot,
    payloads: list[dict],
    review: StaffReview | None,
) -> int:
    deliveries = db.scalars(
        select(TelegramDelivery).where(
            TelegramDelivery.case_id == case.id,
            TelegramDelivery.provider_message_id.is_not(None),
            TelegramDelivery.state == "sent",
        )
    ).all()
    if not deliveries:
        return 0
    company = db.get(Company, case.company_id) if case.company_id else None
    card_text, _, buttons = format_card(
        case, company.name if company else None, snapshot, payloads, review
    )
    edited = 0
    seen: set[tuple[str, str]] = set()
    for delivery in deliveries:
        if not delivery.provider_message_id:
            continue
        key = (delivery.chat_id, delivery.provider_message_id)
        if key in seen:
            continue
        seen.add(key)
        try:
            ok = safe_edit_message(
                chat_id=delivery.chat_id,
                text=card_text,
                message_id=int(delivery.provider_message_id),
                reply_markup={"inline_keyboard": buttons} if buttons else None,
                parse_mode="HTML",
                link_preview_options={"is_disabled": True},
            )
            if ok:
                edited += 1
        except Exception as exc:
            log.warning("Could not update previous delivery %s: %s", delivery.id, exc)
    return edited


def notify_case_status(
    db,
    case: IntakeCase,
    event_type: str,
    actor_id: UUID | None = None,
    details: dict | None = None,
) -> int:
    if not enabled_bot():
        return 0

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

    actor_name = None
    if actor_id:
        actor = db.get(User, actor_id)
        if actor:
            actor_name = actor.email

    # 1. Update existing Telegram messages for this case to reflect current state
    if snapshot:
        update_previous_deliveries(db, case, snapshot, payloads, review)

    # 2. Find eligible recipients in this workspace
    query = (
        select(TelegramRecipient)
        .join(User, TelegramRecipient.user_id == User.id)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(
            TelegramRecipient.workspace_id == case.workspace_id,
            WorkspaceMember.workspace_id == case.workspace_id,
            User.active.is_(True),
        )
    )
    if case.company_id:
        operators = select(CompanyMember.user_id).where(CompanyMember.company_id == case.company_id)
        query = query.where((WorkspaceMember.role == "admin") | User.id.in_(operators))
    else:
        query = query.where(WorkspaceMember.role == "admin")

    recipients = db.scalars(query).all()
    if not recipients:
        return 0

    # 3. Format notification text & buttons
    text, buttons = format_status_notification(
        case=case,
        company_name=company.name if company else None,
        snapshot=snapshot,
        payloads=payloads,
        review=review,
        event_type=event_type,
        actor_name=actor_name,
        details=details,
    )
    payload_hash = hashlib.sha256(text.encode()).hexdigest()

    count = 0
    for recipient in recipients:
        existing = db.scalar(
            select(TelegramDelivery).filter_by(
                case_id=case.id,
                chat_id=recipient.chat_id,
                revision=case.analysis_revision,
                payload_hash=payload_hash,
            )
        )
        if existing and existing.state == "sent":
            continue

        try:
            sent = safe_send_message(
                chat_id=recipient.chat_id,
                text=text,
                reply_markup={"inline_keyboard": buttons} if buttons else None,
                parse_mode="HTML",
                link_preview_options={"is_disabled": True},
            )
            msg_id = sent.get("message_id") if isinstance(sent, dict) else None

            db.execute(
                insert(TelegramDelivery)
                .values(
                    case_id=case.id,
                    actor_id=actor_id or recipient.user_id,
                    chat_id=recipient.chat_id,
                    revision=case.analysis_revision,
                    payload_hash=payload_hash,
                    state="sent",
                    provider_message_id=str(msg_id) if msg_id else None,
                )
                .on_conflict_do_update(
                    constraint="uq_telegram_delivery",
                    set_={"state": "sent", "provider_message_id": str(msg_id) if msg_id else None},
                )
            )
            count += 1
        except Exception as exc:
            log.warning("Failed to send status notification to %s: %s", recipient.chat_id, exc)

    if count > 0:
        db.add(
            ActivityEvent(
                actor_type="staff" if actor_id else "worker",
                actor_id=actor_id,
                intake_case_id=case.id,
                event_type=f"telegram_status_{event_type}",
            )
        )
    return count


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
            card_text, buttons = format_bl_card(case, company_name, bl_payload, docs_by_role)
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
