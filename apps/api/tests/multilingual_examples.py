"""Ground truth for fictional invoices. No private examples are used."""

from html import escape
from io import BytesIO
from pathlib import Path

import pymupdf
from openpyxl import Workbook

FIXTURES = Path(__file__).parent / "fixtures" / "multilingual"
TEXT = {
    "en": (
        "Commercial Invoice",
        "Invoice No.",
        "Supplier",
        "Consignee",
        "Port of loading",
        "Destination",
        "Description",
        "Quantity",
        "Unit",
        "Unit Price (USD)",
        "Amount (USD)",
        "Grand Total",
        "Aster Tools Limited",
        "Fable Import Inc.",
        "Harbor Point",
        "Cedar Bay",
        "Ceramic bearings BX-24",
        "PCS",
    ),
    "zh": (
        "商業發票",
        "發票號碼",
        "供應商",
        "收貨人",
        "裝貨港",
        "目的港",
        "品名描述",
        "數量",
        "單位",
        "單價 (USD)",
        "金額 (USD)",
        "合計",
        "星露工具有限公司",
        "白帆進口有限公司",
        "北灣港",
        "石橋港",
        "陶瓷轴承 BX-24",
        "件",
    ),
    "km": (
        "វិក្កយបត្រពាណិជ្ជកម្ម",
        "លេខវិក្កយបត្រ",
        "អ្នកផ្គត់ផ្គង់",
        "អ្នកទទួល",
        "កំពង់ផែផ្ទុក",
        "គោលដៅ",
        "ការពិពណ៌នាទំនិញ",
        "បរិមាណ",
        "ឯកតា",
        "តម្លៃឯកតា (USD)",
        "ចំនួនទឹកប្រាក់ (USD)",
        "សរុប",
        "ក្រុមហ៊ុន ពន្លឺ",
        "ក្រុមហ៊ុន ចន្ទ្រា",
        "កំពង់ផែផ្កាយ",
        "កំពង់ផែទន្លេ",
        "ស្រោមដៃកប្បាស BX-24",
        "ដុំ",
    ),
    "mixed": (
        "商业发票",
        "Invoice No.",
        "供應商",
        "អ្នកទទួល",
        "Port of loading",
        "目的港",
        "品名描述",
        "Quantity",
        "ឯកតា",
        "單價 (USD)",
        "Amount (USD)",
        "TOTAL 合計",
        "晨峰机械有限公司",
        "ក្រុមហ៊ុន បុប្ផា",
        "North Quay",
        "木桥港",
        "Blue 手套 ស្រោមដៃ BX-24",
        "ដុំ",
    ),
}
LANGUAGES = {
    "en": ["en"],
    "km": ["km"],
    "zh": ["zh"],
    "mixed": ["en", "km", "zh"],
}


def expected(language):
    v = TEXT[language]
    return {
        "role": "invoice",
        "invoice_no": "FABLE-482",
        "supplier": v[12],
        "consignee": v[13],
        "origin": v[14],
        "destination": v[15],
        "description": v[16],
        "quantity": "6",
        "unit": "PCS",
        "unit_price": "12.5",
        "amount": "75",
        "currency": "USD",
        "item_count": 1,
    }


def rows(language):
    v = TEXT[language]
    digit = "៦" if language == "km" else 6
    return [
        [v[0]],
        [v[1], "FABLE-482"],
        [v[2], v[12]],
        [v[3], v[13]],
        [v[4], v[14]],
        [v[5], v[15]],
        [*v[6:11]],
        [v[16], digit, v[17], 12.5, 75],
        [v[11], digit, "", "", 75],
    ]


def xlsx(language):
    book = Workbook()
    sheet = book.active
    sheet.title = "Shipment"
    for record in rows(language):
        sheet.append(record)
    sheet.merge_cells("A1:E1")
    out = BytesIO()
    book.save(out)
    return out.getvalue()


def label(page, x, y, value, *, shaped):
    text = str(value)
    if "Blue 手套 ស្រោមដៃ" in text and not shaped:
        page.insert_text((x, y), "Blue", fontsize=14)
        page.insert_text((x + 36, y), "手套", fontsize=14, fontname="china-s")
        label(page, x + 75, y, " ស្រោមដៃ BX-24", shaped=False)
        return
    khmer = any("\u1780" <= c <= "\u17ff" for c in text)
    if khmer and shaped and "手套" in text:
        page.insert_text((x, y), "Blue", fontsize=14)
        page.insert_text((x + 36, y), "手套", fontsize=14, fontname="china-s")
        label(page, x + 75, y, "ស្រោមដៃ BX-24", shaped=True)
        return
    if khmer and shaped:
        page.insert_htmlbox(
            (x - 1, y - 18, x + 350, y + 9),
            escape(text),
            css=(
                "@font-face{font-family:Khmer;src:url(NotoSansKhmer.ttf)}"
                "body{font-family:Khmer;font-size:14px;margin:0}"
            ),
            archive=pymupdf.Archive(str(FIXTURES)),
            scale_low=1,
        )
    elif khmer:
        # The searchable PDF fixture uses an explicit Unicode text layer.
        page.insert_text(
            (x, y),
            text,
            fontsize=14,
            fontname="fixturekhmer",
            fontfile=str(FIXTURES / "NotoSansKhmer.ttf"),
        )
    elif any("\u3400" <= c <= "\u9fff" for c in text):
        page.insert_text((x, y), text, fontsize=14, fontname="china-s")
    else:
        page.insert_text((x, y), text, fontsize=14)


def pdf(language, *, scan=False):
    with pymupdf.open() as doc:
        page = doc.new_page(width=800, height=525)
        record = rows(language)
        for y, values in enumerate(record[:6], start=1):
            for x, item in zip((40, 300), values, strict=False):
                label(page, x, 34 * y, item, shaped=scan)
        for y, values in zip((282, 322, 362), record[6:], strict=True):
            for x, item in zip((40, 365, 435, 510, 652), values, strict=True):
                label(page, x, y, item, shaped=scan)
        if not scan:
            for y in (257, 299, 339, 381):
                page.draw_line((34, y), (770, y))
            for x in (34, 347, 425, 497, 642, 770):
                page.draw_line((x, 257), (x, 381))
            return doc.tobytes(deflate=True)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(2.2, 2.2), alpha=False)
        with pymupdf.open() as image:
            raster = image.new_page(width=page.rect.width, height=page.rect.height)
            raster.insert_image(raster.rect, pixmap=pix)
            return image.tobytes(deflate=True)


def document(language, suffix):
    if suffix == "pdf":
        return pdf(language)
    if suffix == "scan":
        return pdf(language, scan=True)
    if suffix == "xlsx":
        return xlsx(language)
    return (FIXTURES / f"{language}.xls").read_bytes()


def observed(doc):
    fields = {**doc.fields, **(doc.items[0].fields if doc.items else {})}
    values = {key: fields[key].value if key in fields else None for key in expected("en")}
    values.update(
        role=doc.role,
        item_count=len(doc.items),
        currency=fields["amount"].currency if "amount" in fields else None,
    )
    return values, fields
