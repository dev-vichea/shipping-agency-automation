from collections import defaultdict
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select

from shipping_ai.models import CdcMasterVersion, CdcReservation
from shipping_ai.review.schemas import MasterItem
from shipping_ai.review.values import decimal, usable


def totals(db, master_id, *, exclude_import=None):
    query = select(
        CdcReservation.master_row,
        func.sum(CdcReservation.quantity),
        func.sum(CdcReservation.amount),
    ).where(CdcReservation.master_id == master_id)
    if exclude_import:
        query = query.where(CdcReservation.import_id != exclude_import)
    return {
        row: (quantity, amount)
        for row, quantity, amount in db.execute(query.group_by(CdcReservation.master_row))
    }


def plan(db, record, master, invoice, mappings, eligible):
    existing_master_ids = set(
        db.scalars(select(CdcReservation.master_id).where(CdcReservation.import_id == record.id))
    )
    if not eligible:
        if existing_master_ids:
            raise HTTPException(409, "Resolve the CDC checks before changing a reserved import")
        return {}

    # Serialize approvals that consume the same workbook balances.
    db.scalars(
        select(CdcMasterVersion.id)
        .where(CdcMasterVersion.id.in_(existing_master_ids | {master.id}))
        .order_by(CdcMasterVersion.id)
        .with_for_update()
    ).all()
    reserved = totals(db, master.id, exclude_import=record.id)
    rows = {entry["row"]: MasterItem.model_validate(entry) for entry in master.items}
    selected = {entry["invoice_row"]: entry["master_row"] for entry in mappings}
    quantity, value = defaultdict(Decimal), defaultdict(Decimal)
    for line in invoice.items:
        master_row = selected[line.row]
        quantity[master_row] += decimal(usable(line.fields["quantity"]))
        value[master_row] += decimal(usable(line.fields["amount"]))
    for row in quantity:
        used_quantity, used_value = reserved.get(row, (Decimal(0), Decimal(0)))
        entry = rows[row]
        for limit, requested in (
            (entry.approved_quantity, used_quantity + quantity[row]),
            (entry.remaining_quantity, used_quantity + quantity[row]),
            (entry.approved_value, used_value + value[row]),
            (entry.remaining_value, used_value + value[row]),
        ):
            if (ceiling := decimal(usable(limit))) is not None and requested > ceiling:
                raise HTTPException(
                    409, f"CDC row {row} has insufficient balance after internal reservations"
                )
    return {row: (quantity[row], value[row]) for row in quantity}
