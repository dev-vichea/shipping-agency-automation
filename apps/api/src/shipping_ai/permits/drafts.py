from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from io import BytesIO

from openpyxl import load_workbook
from services.permit_exporter import export_permit_draft

from shipping_ai.cdc.master import BALANCE_MAX_AGE, company_key
from shipping_ai.review.compare import compare, item_pairs
from shipping_ai.review.schemas import MasterItem
from shipping_ai.review.values import convert, decimal, usable

PROFILE = "cdc_application_usd_v1"


def prepare(invoice, packing, master, mappings):
    if (
        not master
        or not master.approval_ref
        or master.company_key != company_key(usable(invoice.fields.get("consignee")))
    ):
        return None, "Select a verified CDC workbook for the invoice consignee."
    if (
        not master.balance_as_of
        or not timedelta(0) <= (datetime.now(UTC).date() - master.balance_as_of) <= BALANCE_MAX_AGE
    ):
        return None, "A current CDC balance is required for this template."
    pairs = dict(item_pairs(invoice.items, packing.items))
    if len(pairs) != len(invoice.items) or len(pairs) != len(packing.items):
        return None, "Each invoice line must pair with a packing-list line."
    lines = {entry["invoice_row"]: entry["master_row"] for entry in mappings}
    rows = {item["row"]: MasterItem.model_validate(item) for item in master.items}
    metadata = {key: usable(value) or "" for key, value in invoice.fields.items()}
    if metadata.get("invoice_date") and metadata["invoice_date"][:4] != str(master.year):
        return None, "The workbook year differs from the reviewed invoice year."
    quantity_totals = defaultdict(Decimal)
    value_totals = defaultdict(Decimal)
    invoice_lines, packing_lines, selections, linked = [], [], [], []
    for i, line in enumerate(invoice.items):
        cdc = rows.get(lines.get(line.row))
        if not cdc:
            return None, f"Select and verify the CDC item for invoice row {line.row}."
        f = line.fields
        quantity = decimal(usable(f["quantity"]))
        price = decimal(usable(f["unit_price"]))
        amount = decimal(usable(f["amount"]))
        unit = usable(f["unit"])
        if f["amount"].currency != "USD":
            return None, "The current permit template requires USD."
        # This template retains reviewed invoice quantities and prices. Do not substitute
        # master prices or sum mixed units in the exporter.
        if unit != usable(cdc.unit):
            return None, f"Invoice row {line.row} requires the same unit as its CDC item."
        if (
            cdc.unit_price.status != "missing"
            and compare("cdc", "unit_price", f["unit_price"], cdc.unit_price, required=True).outcome
            != "PASS"
        ):
            return None, f"Invoice row {line.row} has an unresolved CDC price check."
        quantity_totals[cdc.row] += quantity
        value_totals[cdc.row] += amount
        description = usable(f.get("english_description")) or usable(f["description"])
        invoice_lines.append(
            {
                "english_provided": description,
                "hs_code": usable(f.get("hs_code")) or "",
                "qty": quantity,
                "unit": unit,
                "unit_price": price,
                "total": amount,
            }
        )
        # Omit the match unit/price so the legacy exporter retains Decimal invoice values.
        selections.append(
            {
                "decision": "Reviewed candidate (not approved)",
                "match": {"serial": cdc.serial, "description": description},
            }
        )
        item = packing.items[pairs[i]]
        p = item.fields

        def kg(key):
            weight = p.get(key)
            value = decimal(usable(weight))
            return convert(value, weight.unit, "KG") if value is not None else None

        packing_lines.append(
            {
                "sheet": packing.sheet,
                "row": item.row,
                "english_provided": description,
                "packages": decimal(usable(p.get("packages"))),
                "qty": decimal(usable(p["quantity"])),
                "unit": usable(p["unit"]),
                "net_weight": kg("net_weight"),
                "gross_weight": kg("gross_weight"),
                "volume": None,
            }
        )
        linked.append({"packing": packing_lines[-1]})
    if (
        len({line["unit"] for line in invoice_lines}) > 1
        or len({line["unit"] for line in packing_lines}) > 1
    ):
        return None, "This template requires a single quantity unit per sheet."
    for row, quantity in quantity_totals.items():
        cdc = rows[row]
        for limit in (cdc.approved_quantity, cdc.remaining_quantity):
            ceiling = decimal(usable(limit))
            if ceiling is None or quantity > ceiling:
                return None, f"CDC row {row} has an unknown or insufficient quantity limit."
        for limit in (cdc.approved_value, cdc.remaining_value):
            if limit.status != "missing" and (
                limit.currency != "USD"
                or (ceiling := decimal(usable(limit))) is None
                or value_totals[row] > ceiling
            ):
                return None, f"CDC row {row} has an unknown or insufficient value limit."
    return (
        metadata,
        {"company": master.company},
        invoice_lines,
        selections,
        packing_lines,
        linked,
        [],
        master.approval_ref,
    ), None


def render(arguments):
    source = export_permit_draft(*arguments)
    # Force all formula-looking supplier strings to literal Excel text. Keep the
    # approved line amounts, including accepted cent rounding, in the generated draft.
    with BytesIO(source) as stream:
        book = load_workbook(stream)
    try:
        for sheet in book:
            for row in sheet:
                for cell in row:
                    if cell.data_type == "f":
                        cell.data_type = "s"
        for row, line in enumerate(arguments[2], start=12):
            book["INV"].cell(row, 7, line["total"])
        output = BytesIO()
        book.save(output)
        return output.getvalue()
    finally:
        book.close()
