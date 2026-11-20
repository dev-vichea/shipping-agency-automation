"""Fleet vehicles, drivers, and dispatch management with seed data.

Revision ID: 0013
Revises: 0012
"""

from uuid import uuid4
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

DEFAULT_WORKSPACE = "00000000-0000-4000-8000-000000000001"


def upgrade():
    # 1. Create fleet_drivers
    op.create_table(
        "fleet_drivers",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "workspace_id",
            sa.UUID(),
            sa.ForeignKey("workspaces.id"),
            server_default=DEFAULT_WORKSPACE,
            nullable=False,
        ),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("phone", sa.String(64), nullable=False),
        sa.Column("license_number", sa.String(64), nullable=True),
        sa.Column("national_id", sa.String(64), nullable=True),
        sa.Column("assigned_vehicle_plate", sa.String(64), nullable=True),
        sa.Column("status", sa.String(24), server_default="available", nullable=False),
        sa.Column("total_trips", sa.Integer(), server_default="0", nullable=False),
        sa.Column("safety_rating", sa.String(16), server_default="5.0", nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('available','on_trip','off_duty')",
            name=op.f("ck_fleet_drivers_driver_status"),
        ),
    )
    op.create_index("ix_fleet_drivers_workspace", "fleet_drivers", ["workspace_id"])
    op.create_index("ix_fleet_drivers_phone", "fleet_drivers", ["phone"])
    op.create_index("ix_fleet_drivers_name", "fleet_drivers", ["name"])

    # 2. Create fleet_vehicles
    op.create_table(
        "fleet_vehicles",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "workspace_id",
            sa.UUID(),
            sa.ForeignKey("workspaces.id"),
            server_default=DEFAULT_WORKSPACE,
            nullable=False,
        ),
        sa.Column("plate_number", sa.String(64), nullable=False),
        sa.Column("trailer_plate", sa.String(64), nullable=True),
        sa.Column("vehicle_type", sa.String(64), server_default="40ft Flatbed Chassis", nullable=False),
        sa.Column("haulier_type", sa.String(32), server_default="in_house", nullable=False),
        sa.Column("haulier_name", sa.String(160), server_default="Harborway Fleet", nullable=False),
        sa.Column(
            "assigned_driver_id",
            sa.UUID(),
            sa.ForeignKey("fleet_drivers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("assigned_driver_name", sa.String(160), nullable=True),
        sa.Column("driver_phone", sa.String(64), nullable=True),
        sa.Column("status", sa.String(24), server_default="available", nullable=False),
        sa.Column("capacity", sa.String(64), server_default="45 Tons", nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('available','on_trip','maintenance')",
            name=op.f("ck_fleet_vehicles_vehicle_status"),
        ),
        sa.CheckConstraint(
            "haulier_type IN ('in_house','subcontractor')",
            name=op.f("ck_fleet_vehicles_haulier_type"),
        ),
        sa.UniqueConstraint("workspace_id", "plate_number", name="uq_fleet_vehicle_plate"),
    )
    op.create_index("ix_fleet_vehicles_workspace", "fleet_vehicles", ["workspace_id"])
    op.create_index("ix_fleet_vehicles_plate_number", "fleet_vehicles", ["plate_number"])

    # 3. Create fleet_dispatches
    op.create_table(
        "fleet_dispatches",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "workspace_id",
            sa.UUID(),
            sa.ForeignKey("workspaces.id"),
            server_default=DEFAULT_WORKSPACE,
            nullable=False,
        ),
        sa.Column("trip_number", sa.String(64), nullable=False),
        sa.Column("shipment_ref", sa.String(160), nullable=False),
        sa.Column("company_name", sa.String(254), server_default="XIN CAI FU", nullable=False),
        sa.Column("direction", sa.String(16), server_default="inbound", nullable=False),
        sa.Column("truck_plate", sa.String(64), nullable=False),
        sa.Column("trailer_plate", sa.String(64), nullable=True),
        sa.Column("driver_name", sa.String(160), nullable=False),
        sa.Column("driver_phone", sa.String(64), nullable=False),
        sa.Column("container_no", sa.String(64), nullable=False),
        sa.Column("seal_no", sa.String(64), nullable=False),
        sa.Column("origin", sa.String(254), nullable=False),
        sa.Column("destination", sa.String(254), nullable=False),
        sa.Column("milestone", sa.String(32), server_default="dispatched", nullable=False),
        sa.Column("eta", sa.String(64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "direction IN ('inbound','outbound')",
            name=op.f("ck_fleet_dispatches_dispatch_direction"),
        ),
        sa.CheckConstraint(
            "milestone IN ('dispatched','gate_out','in_transit','at_factory','empty_returned')",
            name=op.f("ck_fleet_dispatches_dispatch_milestone"),
        ),
    )
    op.create_index("ix_fleet_dispatches_workspace", "fleet_dispatches", ["workspace_id"])
    op.create_index("ix_fleet_dispatches_trip_number", "fleet_dispatches", ["trip_number"])
    op.create_index("ix_fleet_dispatches_shipment_ref", "fleet_dispatches", ["shipment_ref"])

    # 4. Insert Seed Data
    drivers_table = sa.table(
        "fleet_drivers",
        sa.column("id", sa.UUID),
        sa.column("workspace_id", sa.UUID),
        sa.column("name", sa.String),
        sa.column("phone", sa.String),
        sa.column("license_number", sa.String),
        sa.column("national_id", sa.String),
        sa.column("assigned_vehicle_plate", sa.String),
        sa.column("status", sa.String),
        sa.column("total_trips", sa.Integer),
        sa.column("safety_rating", sa.String),
        sa.column("notes", sa.Text),
    )

    d1 = uuid4()
    d2 = uuid4()
    d3 = uuid4()
    d4 = uuid4()
    d5 = uuid4()

    op.bulk_insert(
        drivers_table,
        [
            {
                "id": d1,
                "workspace_id": DEFAULT_WORKSPACE,
                "name": "Seng Vichea",
                "phone": "012 889 912",
                "license_number": "DL-KH-204918",
                "national_id": "NID-01928374",
                "assigned_vehicle_plate": "Phnom Penh 3E-1234",
                "status": "on_trip",
                "total_trips": 142,
                "safety_rating": "4.9",
                "notes": "Heavy container certified · Bavet border route specialist",
            },
            {
                "id": d2,
                "workspace_id": DEFAULT_WORKSPACE,
                "name": "Chhorn Chantha",
                "phone": "098 765 432",
                "license_number": "DL-KH-198273",
                "national_id": "NID-08273645",
                "assigned_vehicle_plate": "Phnom Penh 3F-5678",
                "status": "available",
                "total_trips": 98,
                "safety_rating": "4.8",
                "notes": "Experienced with Sihanoukville Port container yard",
            },
            {
                "id": d3,
                "workspace_id": DEFAULT_WORKSPACE,
                "name": "Bun Sopheak",
                "phone": "089 123 456",
                "license_number": "DL-KH-312984",
                "national_id": "NID-03948572",
                "assigned_vehicle_plate": "Kandal 3B-9012",
                "status": "on_trip",
                "total_trips": 215,
                "safety_rating": "5.0",
                "notes": "Senior driver at So Nguon Transport",
            },
            {
                "id": d4,
                "workspace_id": DEFAULT_WORKSPACE,
                "name": "Kosal Ratanak",
                "phone": "077 554 433",
                "license_number": "DL-KH-441209",
                "national_id": "NID-04481239",
                "assigned_vehicle_plate": "Phnom Penh 3D-4455",
                "status": "off_duty",
                "total_trips": 87,
                "safety_rating": "4.7",
                "notes": "On maintenance duty at Phnom Penh depot",
            },
            {
                "id": d5,
                "workspace_id": DEFAULT_WORKSPACE,
                "name": "Heng Dara",
                "phone": "010 332 211",
                "license_number": "DL-KH-509182",
                "national_id": "NID-05829103",
                "assigned_vehicle_plate": "Preah Sihanouk 3A-7890",
                "status": "available",
                "total_trips": 164,
                "safety_rating": "4.9",
                "notes": "Reefer & Dry container certified",
            },
        ],
    )

    vehicles_table = sa.table(
        "fleet_vehicles",
        sa.column("id", sa.UUID),
        sa.column("workspace_id", sa.UUID),
        sa.column("plate_number", sa.String),
        sa.column("trailer_plate", sa.String),
        sa.column("vehicle_type", sa.String),
        sa.column("haulier_type", sa.String),
        sa.column("haulier_name", sa.String),
        sa.column("assigned_driver_id", sa.UUID),
        sa.column("assigned_driver_name", sa.String),
        sa.column("driver_phone", sa.String),
        sa.column("status", sa.String),
        sa.column("capacity", sa.String),
        sa.column("notes", sa.Text),
    )

    op.bulk_insert(
        vehicles_table,
        [
            {
                "id": uuid4(),
                "workspace_id": DEFAULT_WORKSPACE,
                "plate_number": "Phnom Penh 3E-1234",
                "trailer_plate": "4A-8821",
                "vehicle_type": "40ft Flatbed Chassis",
                "haulier_type": "in_house",
                "haulier_name": "Harborway Fleet",
                "assigned_driver_id": d1,
                "assigned_driver_name": "Seng Vichea",
                "driver_phone": "012 889 912",
                "status": "on_trip",
                "capacity": "45 Tons",
                "notes": "Assigned to Bavet Border cross-docking",
            },
            {
                "id": uuid4(),
                "workspace_id": DEFAULT_WORKSPACE,
                "plate_number": "Phnom Penh 3F-5678",
                "trailer_plate": "4A-9912",
                "vehicle_type": "20ft Skeleton Chassis",
                "haulier_type": "in_house",
                "haulier_name": "Harborway Fleet",
                "assigned_driver_id": d2,
                "assigned_driver_name": "Chhorn Chantha",
                "driver_phone": "098 765 432",
                "status": "available",
                "capacity": "35 Tons",
                "notes": "Ready for Sihanoukville Autonomous Port (PAS) pickup",
            },
            {
                "id": uuid4(),
                "workspace_id": DEFAULT_WORKSPACE,
                "plate_number": "Kandal 3B-9012",
                "trailer_plate": "4B-1123",
                "vehicle_type": "40ft Flatbed Chassis",
                "haulier_type": "subcontractor",
                "haulier_name": "So Nguon Transport",
                "assigned_driver_id": d3,
                "assigned_driver_name": "Bun Sopheak",
                "driver_phone": "089 123 456",
                "status": "on_trip",
                "capacity": "45 Tons",
                "notes": "Direct haul: Sihanoukville Port -> Xin Cai Fu Factory",
            },
            {
                "id": uuid4(),
                "workspace_id": DEFAULT_WORKSPACE,
                "plate_number": "Phnom Penh 3D-4455",
                "trailer_plate": "4A-3321",
                "vehicle_type": "Prime Mover (Tractor)",
                "haulier_type": "in_house",
                "haulier_name": "Harborway Fleet",
                "assigned_driver_id": d4,
                "assigned_driver_name": "Kosal Ratanak",
                "driver_phone": "077 554 433",
                "status": "maintenance",
                "capacity": "50 Tons",
                "notes": "Scheduled brake and tire inspection in depot",
            },
            {
                "id": uuid4(),
                "workspace_id": DEFAULT_WORKSPACE,
                "plate_number": "Preah Sihanouk 3A-7890",
                "trailer_plate": "4A-6677",
                "vehicle_type": "45ft Goose-neck",
                "haulier_type": "subcontractor",
                "haulier_name": "Mekong Express Logistics",
                "assigned_driver_id": d5,
                "assigned_driver_name": "Heng Dara",
                "driver_phone": "010 332 211",
                "status": "available",
                "capacity": "48 Tons",
                "notes": "Stationed at Sihanoukville Special Economic Zone",
            },
        ],
    )

    dispatches_table = sa.table(
        "fleet_dispatches",
        sa.column("id", sa.UUID),
        sa.column("workspace_id", sa.UUID),
        sa.column("trip_number", sa.String),
        sa.column("shipment_ref", sa.String),
        sa.column("company_name", sa.String),
        sa.column("direction", sa.String),
        sa.column("truck_plate", sa.String),
        sa.column("trailer_plate", sa.String),
        sa.column("driver_name", sa.String),
        sa.column("driver_phone", sa.String),
        sa.column("container_no", sa.String),
        sa.column("seal_no", sa.String),
        sa.column("origin", sa.String),
        sa.column("destination", sa.String),
        sa.column("milestone", sa.String),
        sa.column("eta", sa.String),
        sa.column("notes", sa.Text),
    )

    op.bulk_insert(
        dispatches_table,
        [
            {
                "id": uuid4(),
                "workspace_id": DEFAULT_WORKSPACE,
                "trip_number": "TRIP-2026-081",
                "shipment_ref": "RE2612049",
                "company_name": "XIN CAI FU",
                "direction": "inbound",
                "truck_plate": "Phnom Penh 3E-1234",
                "trailer_plate": "4A-8821",
                "driver_name": "Seng Vichea",
                "driver_phone": "012 889 912",
                "container_no": "TGHU1234567",
                "seal_no": "ML-KH84920",
                "origin": "PAS (Sihanoukville Port)",
                "destination": "Xin Cai Fu Factory, Phnom Penh SEZ",
                "milestone": "in_transit",
                "eta": "Today, 17:00",
                "notes": "Cambodia Expressway route (E1) · High security bolt seal verified",
            },
            {
                "id": uuid4(),
                "workspace_id": DEFAULT_WORKSPACE,
                "trip_number": "TRIP-2026-080",
                "shipment_ref": "SIH26110051",
                "company_name": "XIN CAI FU",
                "direction": "inbound",
                "truck_plate": "Kandal 3B-9012",
                "trailer_plate": "4B-1123",
                "driver_name": "Bun Sopheak",
                "driver_phone": "089 123 456",
                "container_no": "TEMU7654321",
                "seal_no": "COS-883921",
                "origin": "Bavet Border Checkpoint",
                "destination": "Xin Cai Fu Factory, Phnom Penh SEZ",
                "milestone": "at_factory",
                "eta": "Today, 20:30",
                "notes": "Unloading raw fabric at factory bay 2",
            },
            {
                "id": uuid4(),
                "workspace_id": DEFAULT_WORKSPACE,
                "trip_number": "TRIP-2026-079",
                "shipment_ref": "RCLY26113284",
                "company_name": "XIN CAI FU",
                "direction": "inbound",
                "truck_plate": "Phnom Penh 3F-5678",
                "trailer_plate": "4A-9912",
                "driver_name": "Chhorn Chantha",
                "driver_phone": "098 765 432",
                "container_no": "SITU3928104",
                "seal_no": "SL-019284",
                "origin": "Phnom Penh Autonomous Port (LM17)",
                "destination": "Xin Cai Fu Factory, Phnom Penh SEZ",
                "milestone": "empty_returned",
                "eta": "Completed",
                "notes": "Empty container returned to SITC depot on time. No detention incurred.",
            },
            {
                "id": uuid4(),
                "workspace_id": DEFAULT_WORKSPACE,
                "trip_number": "TRIP-2026-082",
                "shipment_ref": "EXP-2026-004",
                "company_name": "XIN CAI FU",
                "direction": "outbound",
                "truck_plate": "Preah Sihanouk 3A-7890",
                "trailer_plate": "4A-6677",
                "driver_name": "Heng Dara",
                "driver_phone": "010 332 211",
                "container_no": "MRKU8829103",
                "seal_no": "MSK-772910",
                "origin": "Xin Cai Fu Factory, Phnom Penh SEZ",
                "destination": "PAS (Sihanoukville Port Gate 2)",
                "milestone": "gate_out",
                "eta": "Today, 18:00",
                "notes": "Finished garment export for US market · GDCE export clearance complete",
            },
        ],
    )


def downgrade():
    op.drop_table("fleet_dispatches")
    op.drop_table("fleet_vehicles")
    op.drop_table("fleet_drivers")
