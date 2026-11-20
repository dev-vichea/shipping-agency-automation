from io import BytesIO
from uuid import uuid4

import pymupdf
import pytest
from openpyxl import Workbook

from shipping_ai.documents import pdf_extract
from shipping_ai.documents.extract import extract
from shipping_ai.documents.ocr import tsv_words
from shipping_ai.review.compare import review_documents


def pdf_with(lines):
    with pymupdf.open() as doc:
        page = doc.new_page()
        for x, y, text in lines:
            page.insert_text((x, y), text)
        return doc.tobytes()


@pytest.mark.parametrize(
    ("title", "role"),
    [
        ("ARRIVAL NOTICE", "arrival_notice"),
        ("RELEASE ORDER", "release_order"),
        ("TAX INVOICE", "freight_invoice"),
        ("DEBIT NOTE", "debit_note"),
    ],
)
def test_ancillary_title_overrides_linked_bill_and_intake_hint(title, role):
    data = pdf_with(
        [
            (57, 60, title),
            (57, 83, "B/L No.: STONE1302"),
            (57, 105, "Shipper: Orchard Export"),
            (57, 128, "Consignee: Amber Trading"),
        ]
    )
    [result] = extract(data, "from-agent.pdf", uuid4(), "draft_bl")
    assert result.role == role
    assert result.fields["linked_bl"].value == "STONE1302"
    assert "bl_no" not in result.fields
    _, roles = review_documents([result])
    assert not roles


def test_tesseract_literal_quotes_and_invalid_coordinate_rows():
    payload = b"\n".join(
        [
            b"level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
            b'5\t1\t1\t1\t1\t1\t1\t2\t3\t4\t89\t"quote',
            b"5\t1\t2\t1\t1\t1\t10\t12\t14\t16\t93\t68",
            b"5\t1\t3\t1\t1\t1\tbad\t12\t14\t16\t93\tignore",
            b"5\t1\t3\t1\t1\t2\t10\t12\t14\t16\tnan\tignore",
        ]
    )
    words = tsv_words(payload, 4, 8, 2)
    assert [word[1] for line in words.values() for word in line] == ['"quote', "68"]
    assert tuple(words["2", "1", "1"][0][0]) == (7, 10, 14, 18)


def test_positions_keep_full_party_and_continuation_summary():
    with pymupdf.open() as doc:
        page = doc.new_page()
        for x, y, text in (
            (35, 45, "BILL OF LADING"),
            (35, 75, "B/L No.: PORT95267"),
            (35, 110, "Shipper"),
            (35, 127, "OAK SHIPPER INC."),
            (35, 150, "Consignee"),
            (35, 169, "NORTH LAKE IMPORTS"),
            (35, 184, "CO., LTD."),
            (35, 198, "47 Market Street"),
            (35, 222, "Port of Loading: Harbor Alpha"),
        ):
            page.insert_text((x, y), text, fontsize=10)
        page = doc.new_page()
        for x in (30, 140, 240, 380, 480):
            page.draw_line((x, 45), (x, 100))
        for y in (45, 70, 100):
            page.draw_line((30, y), (480, y))
        for x, y, text in (
            (35, 60, "No. of Packages"),
            (147, 60, "Unit"),
            (246, 60, "Gross Weight (KG)"),
            (385, 60, "Measurement"),
            (35, 87, "91"),
            (147, 87, "Cartons"),
            (246, 87, "654.25"),
            (385, 87, "7 CBM"),
        ):
            page.insert_text((x, y), text, fontsize=10)
        data = doc.tobytes()
    [result] = extract(data, "transport.pdf", uuid4(), "other")
    party = result.fields["consignee"]
    assert party.value == "NORTH LAKE IMPORTS CO., LTD."
    assert len(party.evidence[0].boxes) == 2
    assert party.evidence[0].raw == "NORTH LAKE IMPORTS\nCO., LTD."
    count = result.fields["packages"]
    assert count.value == "91" and count.unit == "CTN"
    assert count.evidence[0].page == 2 and "Cartons" in count.evidence[0].raw
    assert len(count.evidence[0].boxes) >= 2
    assert result.fields["gross_weight"].unit == "KG"


def test_ocr_uses_discovered_region_when_first_pass_misses_weight(monkeypatch):
    calls = []
    page_data = pdf_with([(45, 50, "paper")])
    with pymupdf.open(stream=page_data, filetype="pdf") as text_doc, pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_image(page.rect, pixmap=text_doc[0].get_pixmap())
        data = doc.tobytes()

    def words(page, clip, *, segmentation, **options):
        calls.append((segmentation, pymupdf.Rect(clip)))
        phrases = [
            ("BILL OF LADING", 45, 43),
            ("B/L No.: CARGO1846", 45, 68),
            ("SHIPPER: Canoe Export Ltd", 45, 93),
            ("CONSIGNEE: Finch Import Ltd", 45, 118),
            ("PORT OF LOADING: Harbor North", 45, 143),
            ("PORT OF DISCHARGE: Harbor South", 45, 168),
            ("GROSS WEIGHT", 195, 235),
            ("KG", 195, 250),
        ]
        if segmentation == 6 and clip.contains(pymupdf.Point(200, 250)):
            phrases = [("GROSS WEIGHT", 195, 235), ("314.50 KG", 195, 250)]
        return {
            (str(i), "1", "1"): [(pymupdf.Rect(x, y, x + len(text) * 5, y + 10), text, 91)]
            for i, (text, x, y) in enumerate(phrases)
            if clip.contains(pymupdf.Point(x + 1, y + 4))
        }

    monkeypatch.setattr(pdf_extract, "ocr_words", words)
    [bill] = extract(data, "sheet.pdf", uuid4(), "other")
    assert bill.fields["gross_weight"].value == "314.5"
    assert bill.fields["gross_weight"].status == "uncertain"
    assert bill.fields["gross_weight"].evidence[0].method == "ocr_retry"
    retry = next(
        clip
        for segmentation, clip in calls
        if segmentation == 6 and clip.contains(pymupdf.Point(195, 235))
    )
    assert retry.contains(pymupdf.Point(195, 235)) and retry.get_area() < calls[0][1].get_area()
    assert any(x["stage"] == "crop" and x["outcome"] == "candidate_found" for x in bill.recovery)


def test_different_printed_totals_remain_alternatives():
    with pymupdf.open() as doc:
        for count in (17, 19):
            page = doc.new_page()
            page.insert_text(
                (45, 50), "BILL OF LADING\nB/L No.: CRATE452\nPackages: " + str(count) + " PKG"
            )
        data = doc.tobytes()
    [bill] = extract(data, "counts.pdf", uuid4(), "other")
    result = bill.fields["packages"]
    assert result.value is None and result.review_reason == "conflicting_source_values"
    assert {(a.value, a.evidence[0].page) for a in result.alternatives} == {("17", 1), ("19", 2)}


def test_workbook_retains_separate_panels_and_distinct_secondary_sheet():
    book = Workbook()
    ws = book.active
    ws.title = "Packet"
    ws.append(["Granite Export Ltd", None, None, None, None, "Granite Export Ltd"])
    ws.append(["INVOICE", None, None, None, None, "PACKING LIST"])
    ws.append(
        ["NO:", "STOCK192", "DATE:", "2026-10-09", None, "NO:", "STOCK192", "DATE:", "2026-10-09"]
    )
    ws.append(
        [
            "Description",
            "Quantity",
            "Unit",
            "Unit Price USD",
            "Amount USD",
            "Description",
            "Packages",
            "G.W. KG",
            "N.W. KG",
        ]
    )
    ws.append(["Canvas", 5, "PCS", 12, 60, "Canvas", 2, 8, 7])
    ws.append(["TOTAL 合计", None, None, None, 60, "合计TOTAL", 2, 8, 7])
    secondary = book.create_sheet("Invoice (2)")
    secondary.append(["Commercial invoice"])
    secondary.append(["Invoice number:", "STOCK193"])
    secondary.append(["Description", "Quantity", "Unit", "Unit Price USD", "Amount USD"])
    secondary.append(["Canvas", 9, "PCS", 12, 108])
    output = BytesIO()
    book.save(output)
    invoice, packing = extract(output.getvalue(), "packet.xlsx", uuid4(), "other")
    assert [i.row for i in invoice.items] == [5]
    assert [i.row for i in packing.items] == [5]
    assert invoice.fields["invoice_no"].evidence[0].cell == "B3"
    assert packing.fields["invoice_no"].evidence[0].cell == "G3"
    assert packing.fields["gross_weight"].value == "8"
    assert packing.fields["gross_weight"].evidence[0].cell == "H6"
    assert invoice.sections[0].fields["invoice_no"].value == "STOCK193"
    assert invoice.error == "multiple_workbook_sections"
    _, active = review_documents([invoice, packing])
    assert "invoice" not in active


def test_packing_list_case_no_range_package_detection():
    book = Workbook()
    ws = book.active
    ws.title = "packing"
    ws.append(["WEALDONE LIMITED"])
    ws.append(["PACKING LIST"])
    ws.append(["Invoice Number", "RE2612049", None, "Date of Invoice", "2026-11-19"])
    ws.append(["箱号", None, None, "货品名称", None, "数量", None, "重量(Weight)", None, None, None, "体积"])
    ws.append(["Case No.", None, None, "Descriptions", None, "Quantity (PCS)", None, "G.W.(kgs)", "N.W.(kgs)", None, None, "Measurement(M3)"])
    ws.append([1, "~", 417, "KNITTED FABRIC", None, 9453, "kg", 9870, 9453, None, None, 62.6])
    ws.append([1, "~", 13, "DRAWSTRING", None, 327, "kg", 340, 327, None, None, 1.6])
    ws.append([1, "~", 2, "MAIN LABEL", None, 3535, "Doz", 46, 43, None, None, 0.2])
    ws.append(["TTL:", None, 432, "TOTAL:", None, None, None, 10256, 9823, None, None, 64.4])
    ws.append([None, None, "PACKAGES", None, None, None, None, "KGS", "KGS", None, None, "CBM"])
    output = BytesIO()
    book.save(output)

    [packing] = extract(output.getvalue(), "RE2612049-SHIPPING.xlsx", uuid4(), "packing_list")
    assert len(packing.items) == 3
    assert packing.items[0].fields["packages"].value == "417"
    assert packing.items[0].fields["packages"].unit in {"PKG", "CTN"}
    assert packing.items[1].fields["packages"].value == "13"
    assert packing.items[2].fields["packages"].value == "2"
    assert packing.fields["packages"].value == "432"
    assert packing.fields["gross_weight"].value == "10256"
    assert packing.fields["net_weight"].value == "9823"
    assert packing.fields["measurement"].value == "64.4"
