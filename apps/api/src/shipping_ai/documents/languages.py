"""Shared label vocabulary. Match normalized labels without normalizing their source values."""

import re
import unicodedata
from collections.abc import Callable

from rapidfuzz.distance import Levenshtein

TITLES = {
    "invoice": ("商业发票", "商業發票", "វិក្កយបត្រពាណិជ្ជកម្ម", "វិក្កយបត្រ"),
    "packing_list": ("装箱单", "裝箱單", "បញ្ជីវេចខ្ចប់"),
    "bill_of_lading": ("提单", "提單", "ប័ណ្ណដឹកជញ្ជូន"),
}
LABELS = {
    "invoice_no": ("发票号码", "發票號碼", "发票号", "發票號", "លេខវិក្កយបត្រ"),
    "invoice_date": ("发票日期", "發票日期", "កាលបរិច្ឆេទវិក្កយបត្រ"),
    "contract_no": ("合同号码", "合同號碼", "លេខកិច្ចសន្យា"),
    "bl_no": ("提单号码", "提單號碼", "提单号", "提單號", "លេខប័ណ្ណដឹកជញ្ជូន"),
    "supplier": ("供应商", "供應商", "卖方", "賣方", "អ្នកផ្គត់ផ្គង់"),
    "shipper": ("发货人", "發貨人", "托运人", "託運人", "អ្នកផ្ញើ"),
    "consignee": ("收货人", "收貨人", "买方", "買方", "卖给", "賣給", "អ្នកទទួល"),
    "notify_party": ("通知方", "通知人", "អ្នកទទួលការជូនដំណឹង"),
    "origin": ("起运港", "起運港", "装货港", "裝貨港", "កំពង់ផែផ្ទុក"),
    "discharge": ("卸货港", "卸貨港", "កំពង់ផែដោះទំនិញ"),
    "destination": ("目的港", "目的地", "គោលដៅ"),
    "delivery": ("交货地点", "交貨地點", "ទីកន្លែងប្រគល់ទំនិញ"),
    "description": ("品名描述", "品名", "货物描述", "貨物描述", "ការពិពណ៌នាទំនិញ", "ឈ្មោះទំនិញ"),
    "english_description": ("英文品名", "英文描述", "ការពិពណ៌នាជាភាសាអង់គ្លេស"),
    "hs_code": ("税号", "稅號", "海关编码", "海關編碼", "លេខកូដទំនិញ"),
    "item_code": ("物料编码", "材料编号", "料号", "លេខកូដសម្ភារៈ"),
    "specification": ("规格", "型號", "型号", "លក្ខណៈបច្ចេកទេស"),
    "quantity": ("数量", "數量", "បរិមាណ"),
    "unit": ("单位", "單位", "ឯកតា"),
    "unit_price": ("单价", "單價", "单位价格", "單位價格", "តម្លៃឯកតា"),
    "amount": ("金额", "金額", "总价", "總價", "ចំនួនទឹកប្រាក់"),
    "packages": ("件数", "件數", "箱数", "箱數", "箱号", "箱號", "包号", "包號", "ចំនួនកញ្ចប់"),
    "gross_weight": ("毛重", "ទម្ងន់សរុប"),
    "net_weight": ("净重", "淨重", "ទម្ងន់សុទ្ធ"),
    "measurement": ("体积", "體積", "មាឌ"),
}
TOTAL = ("合计", "合計", "总计", "總計", "សរុប")
LANGUAGE_LETTERS = {
    "km": re.compile(r"[\u1780-\u17b3]"),
    "zh": re.compile(r"[\u3400-\u9fff\U00020000-\U000323af]"),
    "en": re.compile(r"[A-Za-z]{2,}"),
}
CODE = re.compile(r"(?<![A-Za-z0-9])[A-Za-z0-9]+(?:[-./_][A-Za-z0-9]+)*(?![A-Za-z0-9])")
DIGITS = re.compile(r"[-+−]?\d+(?:[.,]\d+)*")
SEPARATORS = re.compile(r"[\s\u200b\u200c\u200d\ufeff]+")


def token_signature(text):
    """Keep code/number spelling and multiplicity when checking a translation."""
    codes = [
        token
        for token in CODE.findall(text)
        if any(c.isalpha() for c in token)
        and (
            any(c.isdigit() for c in token)
            or (len(token) >= 2 and token.isupper())
            or any(c in token for c in "-/_")
        )
    ]
    return sorted(codes), sorted(DIGITS.findall(text))


def languages(text):
    if not text:
        return []
    # Codes and measurement suffixes carry no useful language signal.
    words = CODE.sub(
        lambda m: (
            ""
            if any(c.isdigit() for c in m[0])
            or m[0].lower() in {"usd", "cny", "khr", "kg", "cbm", "pcs", "ctn", "pkg"}
            else m[0]
        ),
        text,
    )
    detected = [code for code, pattern in LANGUAGE_LETTERS.items() if pattern.search(words)]
    other = any(
        c.isalpha()
        and not any(part in unicodedata.name(c, "") for part in ("LATIN", "CJK", "KHMER"))
        for c in words
    )
    return sorted([*detected, *([] if not other else ["und"])])


def spellings(*values):
    return "|".join(map(re.escape, sorted(set(values), key=lambda s: (-len(s), s))))


def localized(pattern, *values):
    return f"(?:{spellings(*values)}|{pattern})" if values else pattern


def column_label(key, text, *, ocr=False):
    # Khmer OCR can insert intra-word spaces. Only remove those for matching headings.
    compact = SEPARATORS.sub("", text)
    if any(label in compact for label in LABELS[key]):
        return True
    if ocr and key == "description":
        observed = re.match(r"[\u1780-\u17ff]+", compact)
        if observed and len(observed[0]) >= 12:
            return any(
                label.startswith(observed[0][:4])
                and Levenshtein.distance(observed[0], label, score_cutoff=2) <= 2
                for label in LABELS[key]
            )
    return False


def column_map(headers: list[str], *, ocr=False) -> dict[str, int]:
    tests: dict[str, Callable[[str], bool]] = {
        "description": lambda h: (
            bool(re.search(r"description|commodity|commodities|品名|货品名称|货名", h))
            and not re.search(r"english|英文", h)
        ),
        "english_description": lambda h: bool(re.search(r"english|英文", h)),
        "hs_code": lambda h: bool(re.search(r"h\.?s\.?[ -]*code|税号", h)),
        "item_code": lambda h: bool(re.search(r"(?:item|material|product)\s*(?:code|no\.?|number)|物料编码|材料编号", h)),
        "specification": lambda h: bool(re.search(r"specification|^spec\b|规格|型號|型号", h)),
        "quantity": lambda h: bool(re.search(r"quantity|^qty\b|数量", h)),
        "unit": lambda h: (
            bool(re.search(r"^unit(?:\b|$)|单位|^uom\b", h))
            and not re.search(r"price|value|单价|价格", h)
        ),
        "unit_price": lambda h: bool(re.search(r"unit\s*price|^price\b|单价|u\.price", h)),
        "amount": lambda h: (
            bool(re.search(r"subtotal|amount|total\s*(?:price|value)|总价|总值|金额", h))
            and not re.search(r"unit\s*price|balance", h)
        ),
        "packages": lambda h: bool(
            re.search(
                r"(?:(?:total\s+|no\.?\s*(?:and kind\s*)?of\s+)?(?:packages?|cartons?|pkgs?|ctns?|cases?|boxes?)|case\s*no\.?|ctn\s*no\.?|pkg\s*no\.?|box\s*no\.?|包数|件数|箱数|箱号|箱號|包号|包號)\b",
                h,
                re.I,
            )
            and not re.search(r"price|rate|marks?|唛头", h, re.I)
        ),
        "gross_weight": lambda h: bool(re.search(r"gross\s*weight|\bg\.?w\b|毛重", h)),
        "net_weight": lambda h: bool(re.search(r"net\s*weight|\bn\.?w\b|净重", h)),
        "measurement": lambda h: bool(re.search(r"measurement|volume|means\s*m3|体积", h)),
    }
    return {
        key: col
        for key, matches in tests.items()
        if (
            col := next(
                (
                    i
                    for i, header in enumerate(headers)
                    if (matches(header) or column_label(key, header, ocr=ocr))
                    and (key != "description" or not column_label("english_description", header))
                    and (
                        key != "unit"
                        or not (tests["unit_price"](header) or column_label("unit_price", header))
                    )
                ),
                None,
            )
        )
        is not None
    }


def reference_text(value):
    return (
        2 <= len(value) <= 80
        and value[0].isalnum()
        and any(c.isdecimal() for c in value)
        and all(
            c.isalnum() or unicodedata.category(c).startswith("M") or c in "+/.-_" for c in value
        )
    )


ROW_FIELDS = (
    "description",
    "english_description",
    "hs_code",
    "item_code",
    "specification",
    "quantity",
    "unit",
    "unit_price",
    "amount",
    "packages",
    "gross_weight",
    "net_weight",
    "measurement",
)


def title_variants(value):
    title = value.strip(" |:：*.")
    return [title, *re.split(r"\s*[/|（(）)\n]\s*", title)]
