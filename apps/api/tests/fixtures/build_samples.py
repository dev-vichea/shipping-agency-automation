"""Generate fictional values in supplier layouts seen in the legacy regression suite."""

import argparse
from io import BytesIO
from pathlib import Path

import pymupdf
from openpyxl import Workbook

COMPANY = "Harbor Demo Co., Ltd."
SUPPLIER = "Fabric Demo Co., Ltd."
REFERENCE = "INV-FIXTURE-101"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def encoded(workbook):
    stream = BytesIO()
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


def supplier(
    *,
    quantity=12,
    packing_quantity=12,
    packing_description="Woven label",
    packing_price="2.50",
    missing_ref=False,
    missing_amount=False,
    merged=False,
    footer_currency=None,
    declared_subtotal="30.00",
    packages=2,
):
    book = Workbook()
    invoice = book.active
    invoice.title = "invoice"
    invoice.append([SUPPLIER])
    invoice.append(["Commercial Invoice"])
    invoice.append(["Invoice No:", None if missing_ref else REFERENCE])
    invoice.append(["Consignee", COMPANY])
    invoice.append(["Port of Loading", "Demo Port A"])
    invoice.append(["Port of Discharge", "Demo Port B"])
    invoice.append(["Container No:", "ABCD1234567"])
    invoice.append(["BY SEA"])
    if merged:
        if footer_currency is None:
            invoice.cell(17, 1, "USD")
        invoice.merge_cells("C18:G19")
        invoice["C18"] = "数量与货品名称"
        invoice.merge_cells("I18:L18")
        invoice["I18"] = "总值"
        invoice["I19"] = "Amount"
        for row, name, qty, price in [
            (25, "Woven label", quantity, "2.50"),
            (26, "Fabric rack", 3, "8.25"),
        ]:
            for col, value in [
                (3, name),
                (5, qty),
                (6, "PCS"),
                (8, price),
                (10, "=E25*H25" if missing_amount else str(qty * float(price))),
            ]:
                invoice.cell(row, col, value)
        if footer_currency is not None:
            invoice["C35"] = "TOTAL:"
            invoice["J35"] = declared_subtotal
            invoice["J36"] = footer_currency
    else:
        invoice.append(
            [
                "H.S.Code",
                "Descriptions of Commodities",
                None,
                "Quantity",
                "Unit",
                "Unit Price USD",
                "Subtotal USD",
                "Packages",
                "Gross Weight KG",
                "Net Weight KG",
            ]
        )
        invoice.append(
            [
                "580710",
                "织唛",
                "Woven label",
                quantity,
                "PCS",
                "2.50",
                "=D10*F10" if missing_amount else "30.00",
                packages,
                "24.00",
                "22.00",
            ]
        )
        invoice.append(
            [
                "TOTAL:",
                None,
                None,
                quantity,
                None,
                None,
                None if missing_amount else declared_subtotal,
                packages,
                "24.00",
                "22.00",
            ]
        )
        if footer_currency is not None:
            invoice["G12"] = footer_currency
    packing = book.create_sheet("PackingList")
    packing.append([SUPPLIER])
    packing.append(["Packing List"])
    packing.append(["Invoice No:", None if missing_ref else REFERENCE])
    packing.append(["Consignee", COMPANY])
    packing.append(["Port of Loading", "Demo Port A"])
    packing.append(["Port of Discharge", "Demo Port B"])
    packing.append(["Container No:", "ABCD1234567"])
    packing.append(["BY SEA"])
    packing.append(
        [
            "H.S.Code",
            "Descriptions of Commodities",
            None,
            "Quantity",
            None,
            "Unit Price USD",
            "Amount USD",
            "Packages",
            "G.W.",
            "N.W.",
        ]
    )
    packing.append([None, None, None, None, None, None, None, None, "Kgs", "Kgs"])
    packing.append(
        [
            "580710",
            packing_description,
            None,
            packing_quantity,
            "PCS",
            packing_price,
            "30.00",
            packages,
            "24.00",
            "22.00",
        ]
    )
    packing.append(
        ["TOTAL:", None, None, packing_quantity, None, None, "30.00", packages, "24.00", "22.00"]
    )
    return encoded(book)


def draft_bill(
    *,
    unreadable=False,
    weight="24.00",
    company=COMPANY,
    container="ABCD1234567",
    vessel=None,
    packages=2,
    scanned=False,
):
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        if not unreadable:
            page.insert_text(
                (50, 60),
                "\n".join(
                    [
                        "DRAFT BILL OF LADING",
                        "B/L No: DEMOBL0001",
                        f"Shipper: {SUPPLIER}",
                        f"Consignee: {company}",
                        "Port of Loading: Demo Port A",
                        "Port of Discharge: Demo Port B",
                        f"Container No: {container}",
                        "Seal No: DEMO5678",
                        f"Packages: {packages} PKG",
                        f"Gross Weight: {weight} KG",
                        "Net Weight: 22 KG",
                        "BY SEA",
                        "Description of Goods: Woven label",
                        *([f"Vessel: {vessel}"] if vessel else []),
                    ]
                ),
            )
        if scanned:
            image = page.get_pixmap(dpi=110, colorspace=pymupdf.csGRAY)
            image.set_dpi(110, 110)
            with pymupdf.open() as scan:
                scan.new_page(width=page.rect.width, height=page.rect.height).insert_image(
                    page.rect, pixmap=image
                )
                return scan.tobytes(deflate=True)
        return pdf.tobytes()


def master(
    *,
    unit="PCS",
    price="2.50",
    balance="60",
    company=COMPANY,
    price_header=True,
    extra_rows=0,
):
    book = Workbook()
    sheet = book.active
    sheet.title = "CDC cut stock"
    sheet.append([company, "QIP # DEMO-2026"])
    sheet.append(
        [
            "No",
            "DESCRIPTION OF GOODS",
            None,
            None,
            None,
            "UNIT",
            "QUANTITY",
            "UNIT PRICE (USD)" if price_header else None,
            "TOTAL PRICE (USD)",
            "ENDING" if balance is not None else None,
        ]
    )
    sheet.append(
        [
            1,
            "Woven label",
            None,
            None,
            None,
            unit,
            100,
            price if price_header else None,
            "250.00",
            balance,
        ]
    )
    for serial in range(2, extra_rows + 2):
        sheet.append([serial, f"Synthetic item {serial}", None, None, None, "PCS", 100])
    return encoded(book)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent-demo", type=Path, metavar="DIRECTORY")
    args = parser.parse_args()
    if args.agent_demo:
        args.agent_demo.mkdir(parents=True, exist_ok=True)
        for name, data in (
            ("supplier-531.xlsx", supplier(packages=531)),
            ("draft-bl-scan-531.pdf", draft_bill(packages=531, scanned=True)),
            ("draft-bl-513.pdf", draft_bill(packages=513)),
            ("cdc-paged.xlsx", master(extra_rows=120)),
        ):
            (args.agent_demo / name).write_bytes(data)
        raise SystemExit(0)
    base = Path(__file__).parent
    for name, data in (
        ("supplier-review.xlsx", supplier(packing_quantity=10, packing_price="2.75")),
        ("draft-bl-review.pdf", draft_bill(weight="26.00")),
        ("cdc-review.xlsx", master(unit="ROLL", price="3.00", balance="=G3-10")),
        ("cdc-approval.xlsx", master()),
    ):
        (base / name).write_bytes(data)
