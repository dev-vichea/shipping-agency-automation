"""Seed two active import shipments and linked fleet dispatches for live tracking demo."""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from sqlalchemy import select, delete
from shipping_ai.core.db import session_factory
from shipping_ai.models import (
    Company,
    FleetDispatch,
    FleetVehicle,
    FleetDriver,
    ImportItem,
    ImportRecord,
    IntakeCase,
    IncomingMessage,
)

WORKSPACE_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")

def seed():
    with session_factory()() as db:
        # 1. Resolve company
        company = db.scalar(
            select(Company).where(
                Company.workspace_id == WORKSPACE_ID,
                Company.name.ilike("%XIN CAI FU%"),
            )
        )
        if not company:
            company = Company(
                id=uuid.uuid4(),
                workspace_id=WORKSPACE_ID,
                name="XIN CAI FU (CAMBODIA) CO., LTD.",
                identity_key="xin cai fu (cambodia) co., ltd.",
            )
            db.add(company)
            db.flush()

        print(f"Using company: {company.name} ({company.id})")

        # 2. Seed / Update 2 Import Shipments
        shipment_data = [
            {
                "invoice_no": "SIH26110051",
                "supplier": "Ningbo Texstar Industrial Co., Ltd.",
                "consignee": "XIN CAI FU (CAMBODIA) CO., LTD. (Prey Sar, Dangkao, Phnom Penh)",
                "etd": date(2026, 11, 18),
                "eta": date(2026, 11, 25),
                "items": [
                    {"line_no": 1, "desc": "100% Cotton Knitted Fabric", "qty": Decimal("1000"), "unit": "PCS", "amt": Decimal("4500.00"), "cur": "USD"},
                    {"line_no": 2, "desc": "Polyester Woven Interlining", "qty": Decimal("500"), "unit": "YDS", "amt": Decimal("1850.00"), "cur": "USD"},
                ],
            },
            {
                "invoice_no": "RE2612049",
                "supplier": "Shanghai Grand Garment Accessories Co.",
                "consignee": "XIN CAI FU (CAMBODIA) CO., LTD. (Prey Sar, Dangkao, Phnom Penh)",
                "etd": date(2026, 11, 20),
                "eta": date(2026, 11, 26),
                "items": [
                    {"line_no": 1, "desc": "Metal Zippers & Sliders #5", "qty": Decimal("2500"), "unit": "KGS", "amt": Decimal("6250.00"), "cur": "USD"},
                ],
            },
        ]

        for s in shipment_data:
            # Check existing import record
            existing_import = db.scalar(
                select(ImportRecord).where(ImportRecord.invoice_no == s["invoice_no"])
            )
            if existing_import:
                print(f"Import {s['invoice_no']} already exists ({existing_import.id}), updating fields...")
                existing_import.supplier = s["supplier"]
                existing_import.consignee = s["consignee"]
                existing_import.etd = s["etd"]
                existing_import.eta = s["eta"]
                existing_import.etd_status = "confirmed"
                existing_import.eta_status = "confirmed"
                existing_import.state = "approved"
                if not existing_import.approved_at:
                    existing_import.approved_at = datetime.now(timezone.utc)
                import_rec = existing_import
            else:
                # Create IntakeCase
                intake = IntakeCase(
                    id=uuid.uuid4(),
                    workspace_id=WORKSPACE_ID,
                    company_id=company.id,
                    state="approved",
                    channel="email",
                    detected_reference=s["invoice_no"],
                    review_reason="Approved import intake",
                )
                db.add(intake)
                db.flush()

                # Create ImportRecord
                import_rec = ImportRecord(
                    id=uuid.uuid4(),
                    intake_case_id=intake.id,
                    company_id=company.id,
                    invoice_no=s["invoice_no"],
                    supplier=s["supplier"],
                    consignee=s["consignee"],
                    state="approved",
                    etd=s["etd"],
                    eta=s["eta"],
                    etd_status="confirmed",
                    eta_status="confirmed",
                    approved_at=datetime.now(timezone.utc),
                )
                db.add(import_rec)
                db.flush()

                # Add items
                for it in s["items"]:
                    item = ImportItem(
                        id=uuid.uuid4(),
                        import_id=import_rec.id,
                        intake_case_id=intake.id,
                        line_no=it["line_no"],
                        raw_description=it["desc"],
                        normalized_description=it["desc"],
                        quantity=it["qty"],
                        unit=it["unit"],
                        amount=it["amt"],
                        currency=it["cur"],
                        verification_state="verified",
                    )
                    db.add(item)
                print(f"Created ImportRecord {s['invoice_no']} ({import_rec.id})")

        # 3. Seed / Update Linked Fleet Dispatches
        dispatches = [
            {
                "trip_number": "TRIP-2026-080",
                "shipment_ref": "SIH26110051",
                "company_name": "XIN CAI FU (CAMBODIA) CO., LTD.",
                "direction": "inbound",
                "truck_plate": "Kandal 3B-9012",
                "trailer_plate": "4B-1123",
                "driver_name": "Bun Sopheak",
                "driver_phone": "089 123 456",
                "container_no": "TEMU7654321",
                "seal_no": "SL-99201",
                "origin": "PAS (Sihanoukville Port)",
                "destination": "Xin Cai Fu Factory (Prey Sar, Dangkao, Phnom Penh)",
                "milestone": "in_transit",
                "eta": "Today, 16:30",
                "notes": "Container in transit on E4 Expressway to Xin Cai Fu Factory (Prey Sar, Dangkao, Phnom Penh).",
            },
            {
                "trip_number": "TRIP-2026-081",
                "shipment_ref": "RE2612049",
                "company_name": "XIN CAI FU (CAMBODIA) CO., LTD.",
                "direction": "inbound",
                "truck_plate": "Phnom Penh 3E-1234",
                "trailer_plate": "4A-8821",
                "driver_name": "Seng Vichea",
                "driver_phone": "012 889 912",
                "container_no": "TGHU1234567",
                "seal_no": "ML-KH84920",
                "origin": "PAS (Sihanoukville Port)",
                "destination": "Xin Cai Fu Factory (Prey Sar, Dangkao, Phnom Penh)",
                "milestone": "at_factory",
                "eta": "Today, 14:15",
                "notes": "Arrived at Xin Cai Fu Factory gate (Santepheap 40M Rd, Prey Sar), preparing for container unloading.",
            },
        ]

        for d in dispatches:
            existing_trip = db.scalar(
                select(FleetDispatch).where(
                    FleetDispatch.workspace_id == WORKSPACE_ID,
                    FleetDispatch.trip_number == d["trip_number"],
                )
            )
            if existing_trip:
                print(f"Updating trip {d['trip_number']}...")
                for k, v in d.items():
                    setattr(existing_trip, k, v)
                existing_trip.updated_at = datetime.now(timezone.utc)
            else:
                trip = FleetDispatch(
                    id=uuid.uuid4(),
                    workspace_id=WORKSPACE_ID,
                    **d,
                )
                db.add(trip)
                print(f"Created FleetDispatch {d['trip_number']}")

        db.commit()
        print("Seeding completed successfully!")

if __name__ == "__main__":
    seed()
