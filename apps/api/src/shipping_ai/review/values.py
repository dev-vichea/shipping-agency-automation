import re
import unicodedata
from datetime import date
from decimal import Decimal, InvalidOperation

from .schemas import Evidence, ExtractedField

NUMBER = re.compile(r"[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?")
CURRENCY = re.compile(r"(?<![A-Z])(?:USD|CNY|RMB|KHR|EUR|THB|JPY|GBP|HKD|VND|SGD|AUD)(?![A-Z])")
UNIT_ALIASES = {
    "pc": "PCS",
    "pcs": "PCS",
    "piece": "PCS",
    "pieces": "PCS",
    "件": "PCS",
    "ដុំ": "PCS",
    "គ្រឿង": "UNIT",
    "ប្រអប់": "CTN",
    "កញ្ចប់": "PKG",
    "គីឡូក្រាម": "KG",
    "ម៉ែត្រ": "M",
    "噸": "T",
    "臺": "UNIT",
    "set": "SET",
    "sets": "SET",
    "套": "SET",
    "台": "UNIT",
    "unit": "UNIT",
    "units": "UNIT",
    "kg": "KG",
    "kgs": "KG",
    "kilogram": "KG",
    "kilograms": "KG",
    "公斤": "KG",
    "千克": "KG",
    "g": "G",
    "lb": "LB",
    "lbs": "LB",
    "tonne": "T",
    "tonnes": "T",
    "吨": "T",
    "m": "M",
    "meter": "M",
    "meters": "M",
    "metre": "M",
    "米": "M",
    "yd": "YD",
    "yards": "YD",
    "yard": "YD",
    "码": "YD",
    "doz": "DOZ",
    "dozen": "DOZ",
    "dz": "DOZ",
    "gross": "GROSS",
    "roll": "ROLL",
    "rolls": "ROLL",
    "pair": "PAIR",
    "pairs": "PAIR",
    "prs": "PAIR",
    "carton": "CTN",
    "cartons": "CTN",
    "ctn": "CTN",
    "ctns": "CTN",
    "package": "PKG",
    "packages": "PKG",
    "pkgs": "PKG",
    "pkg": "PKG",
    "m3": "M3",
    "cbm": "M3",
}
FACTORS = {
    "PCS": ("count", Decimal(1)),
    "DOZ": ("count", Decimal(12)),
    "GROSS": ("count", Decimal(144)),
    "KG": ("mass", Decimal(1)),
    "G": ("mass", Decimal("0.001")),
    "T": ("mass", Decimal(1000)),
    "LB": ("mass", Decimal("0.45359237")),
    "M": ("length", Decimal(1)),
    "YD": ("length", Decimal("0.9144")),
}


def clean(value: object) -> str:
    if value is None:
        return ""
    return "".join(
        c for c in str(value) if c in "\n\t" or unicodedata.category(c) not in {"Cc", "Cs"}
    ).strip()


def folded(value: str | None) -> str:
    return " ".join(unicodedata.normalize("NFKC", value or "").casefold().split())


def identity(value: str | None) -> str:
    return "".join(c for c in folded(value) if c.isalnum())


def source_identity(value: str | None) -> str:
    # Khmer vowels and signs are significant. Preserve combining marks when
    # comparing printed text without changing legacy persisted lookup keys.
    return "".join(c for c in folded(value) if c.isalnum() or unicodedata.category(c).startswith("M"))


def decimal(value: object) -> Decimal | None:
    text = unicodedata.normalize("NFKC", clean(value))
    if len(text) > 35 or not NUMBER.fullmatch(text):
        return None
    try:
        result = Decimal(text.replace(",", ""))
        return result if result.is_finite() else None
    except InvalidOperation:
        return None


def year_first_date(value: str) -> str | None:
    text = unicodedata.normalize("NFKC", value)
    match = re.fullmatch(r"(\d{4})\s*(?:[-./]|年)\s*(\d{1,2})\s*(?:[-./]|月)\s*(\d{1,2})(?:日|\s+00:00:00)?", text)
    if not match:
        return None
    try:
        return date(*map(int, match.groups())).isoformat()
    except ValueError:
        return None


def currency(value: str) -> str | None:
    codes = {code if code != "RMB" else "CNY" for code in CURRENCY.findall(value.upper())}
    return next(iter(codes)) if len(codes) == 1 else None


def unit(value: str) -> str | None:
    text = folded(value).strip(" .")
    return (UNIT_ALIASES.get(text) or text.upper()) if text and len(text) <= 24 else None


def convert(amount: Decimal, source: str | None, target: str | None) -> Decimal | None:
    if not source or not target:
        return None
    if source == target:
        return amount
    left, right = FACTORS.get(source), FACTORS.get(target)
    if left and right and left[0] == right[0]:
        return amount * left[1] / right[1]
    return None


def field(value: str | None, *evidence: Evidence, unit=None, currency=None, uncertain=False):
    return ExtractedField(
        value=value,
        evidence=list(evidence),
        unit=unit,
        currency=currency,
        status="uncertain" if uncertain else "present" if value is not None else "missing",
    )


def usable(field: ExtractedField | None) -> str | None:
    return field.value if field and field.status == "present" else None


def display(value: ExtractedField | None) -> str | None:
    if not value or value.value is None:
        return None
    return " ".join(part for part in (value.value, value.currency, value.unit) if part)
