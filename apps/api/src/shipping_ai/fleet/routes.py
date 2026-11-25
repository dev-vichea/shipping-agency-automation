import re
from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select

from shipping_ai.core.access import require_workspace
from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.models import (
    DocumentExtraction,
    FleetDispatch,
    FleetDriver,
    FleetVehicle,
    ImportRecord,
    IntakeCase,
    ReviewSnapshot,
)

router = APIRouter(prefix="/fleet", tags=["fleet"])
mutation = [Depends(browser_origin)]


class DriverInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    phone: str
    license_number: str | None = None
    national_id: str | None = None
    assigned_vehicle_plate: str | None = None
    status: str = "available"
    notes: str | None = None


class DriverUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str | None = None
    phone: str | None = None
    license_number: str | None = None
    national_id: str | None = None
    assigned_vehicle_plate: str | None = None
    status: str | None = None
    notes: str | None = None


class DriverView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    phone: str
    license_number: str | None
    national_id: str | None
    assigned_vehicle_plate: str | None
    status: str
    total_trips: int
    safety_rating: str
    notes: str | None
    created_at: datetime
    updated_at: datetime


class VehicleInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    plate_number: str
    trailer_plate: str | None = None
    vehicle_type: str = "40ft Flatbed Chassis"
    haulier_type: str = "in_house"
    haulier_name: str = "Harborway Fleet"
    assigned_driver_id: UUID | None = None
    assigned_driver_name: str | None = None
    driver_phone: str | None = None
    status: str = "available"
    capacity: str = "45 Tons"
    notes: str | None = None


class VehicleUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    trailer_plate: str | None = None
    vehicle_type: str | None = None
    haulier_type: str | None = None
    haulier_name: str | None = None
    assigned_driver_id: UUID | None = None
    assigned_driver_name: str | None = None
    driver_phone: str | None = None
    status: str | None = None
    capacity: str | None = None
    notes: str | None = None


class VehicleView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    plate_number: str
    trailer_plate: str | None
    vehicle_type: str
    haulier_type: str
    haulier_name: str
    assigned_driver_id: UUID | None
    assigned_driver_name: str | None
    driver_phone: str | None
    status: str
    capacity: str
    notes: str | None
    created_at: datetime
    updated_at: datetime


class DispatchInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    trip_number: str
    shipment_ref: str
    company_name: str = "XIN CAI FU"
    direction: str = "inbound"
    truck_plate: str
    trailer_plate: str | None = None
    driver_name: str
    driver_phone: str
    container_no: str
    seal_no: str
    origin: str
    destination: str
    milestone: str = "dispatched"
    eta: str | None = None
    notes: str | None = None


class DispatchUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    shipment_ref: str | None = None
    company_name: str | None = None
    direction: str | None = None
    truck_plate: str | None = None
    trailer_plate: str | None = None
    driver_name: str | None = None
    driver_phone: str | None = None
    container_no: str | None = None
    seal_no: str | None = None
    origin: str | None = None
    destination: str | None = None
    milestone: str | None = None
    eta: str | None = None
    notes: str | None = None


class DispatchView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    trip_number: str
    shipment_ref: str
    company_name: str
    direction: str
    truck_plate: str
    trailer_plate: str | None
    driver_name: str
    driver_phone: str
    container_no: str
    seal_no: str
    origin: str
    destination: str
    milestone: str
    eta: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class LocationPoint(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    label: str
    lat: float
    lng: float
    category: str = "factory"
    maps_url: str | None = None


class VesselTelemetry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    voyage: str | None = None
    shipping_line: str | None = None
    origin_port: str = "Ningbo-Zhoushan Port"
    discharge_port: str = "Sihanoukville Autonomous Port (PAS)"
    status: str = "underway"
    speed_knots: float = 16.4
    progress_pct: int = 70
    eta: str | None = None


class TrackingDispatchView(DispatchView):
    vessel: VesselTelemetry | None = None
    supplier: str | None = None
    consignee: str | None = None
    haulier_type: str | None = None
    haulier_name: str | None = None
    origin_point: LocationPoint | None = None
    destination_point: LocationPoint | None = None


XIN_CAI_FU_FACTORY = LocationPoint(
    id="xin_cai_fu",
    name="Xin Cai Fu Factory (Phnom Penh)",
    label="Xin Cai Fu (Cambodia) Co., Ltd. · Santepheap 40M Rd, Prey Sar, Dangkao",
    lat=11.502458,
    lng=104.837447,
    category="factory",
    maps_url="https://maps.app.goo.gl/dc3Zjc3qQEUyvQVbA",
)

COORD_PATTERN = re.compile(r"(-?\d{1,2}\.\d{4,})\s*,\s*\+?(-?\d{1,3}\.\d{4,})")


def _resolve_location_point(
    raw: str | None,
    *,
    company_name: str | None = None,
    role: str = "destination",
) -> LocationPoint:
    text = (raw or "").strip().lower()
    comp = (company_name or "").strip().lower()

    if text:
        coord_match = COORD_PATTERN.search(text)
        if coord_match:
            lat = float(coord_match.group(1))
            lng = float(coord_match.group(2))
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                return LocationPoint(
                    id=f"coords-{lat:.5f}-{lng:.5f}",
                    name=raw.strip() if raw else "Custom Coordinates",
                    label=raw.strip() if raw else f"{lat:.6f}, {lng:.6f}",
                    lat=lat,
                    lng=lng,
                    category="port" if role == "origin" else "factory",
                )

    if any(
        kw in text
        for kw in (
            "xin cai fu",
            "xincaifu",
            "prey sar",
            "dangkao",
            "dangkor",
            "santepheap",
            "dc3zjc3qqeuyvqvba",
        )
    ):
        return XIN_CAI_FU_FACTORY

    if not text and ("xin cai fu" in comp or "xincaifu" in comp) and role == "destination":
        return XIN_CAI_FU_FACTORY

    if any(kw in text for kw in ("sihanoukville", "pas", "kompong som", "preah sihanouk")):
        if "sez" in text or "special economic" in text:
            return LocationPoint(
                id="ssez",
                name="Sihanoukville Special Economic Zone (SSEZ)",
                label="SSEZ, Prey Nob, Preah Sihanouk",
                lat=10.741,
                lng=103.628,
                category="factory",
            )
        return LocationPoint(
            id="pas",
            name="Sihanoukville Autonomous Port (PAS)",
            label="PAS Container Terminal, Preah Sihanouk",
            lat=10.645722,
            lng=103.508383,
            category="port",
        )

    if any(kw in text for kw in ("lm17", "kien svay", "kandal")):
        if "ppap" in text or "lm17" in text or "port" in text or "terminal" in text:
            return LocationPoint(
                id="ppap_lm17",
                name="Phnom Penh Autonomous Port (LM17)",
                label="PPAP Container Terminal LM17, Kien Svay, Kandal",
                lat=11.475764,
                lng=105.140036,
                category="port",
            )

    if any(kw in text for kw in ("ppap", "km6", "phnom penh port", "phnom penh autonomous")):
        return LocationPoint(
            id="ppap",
            name="Phnom Penh Autonomous Port (PPAP)",
            label="PPAP Old Terminal (KM6), Phnom Penh",
            lat=11.583303,
            lng=104.921484,
            category="port",
        )

    if any(kw in text for kw in ("bavet", "manhattan", "svay rieng")):
        is_border = "border" in text or "checkpoint" in text
        return LocationPoint(
            id="bavet_border" if is_border else "bavet_manhattan",
            name="Bavet International Border" if is_border else "Manhattan SEZ (Bavet)",
            label="Bavet Border Checkpoint, Svay Rieng" if is_border else "Manhattan SEZ, Bavet, Svay Rieng",
            lat=11.074 if is_border else 11.082,
            lng=106.174 if is_border else 106.142,
            category="port" if is_border else "factory",
        )

    if "tai seng" in text or "taiseng" in text:
        return LocationPoint(
            id="bavet_taiseng",
            name="Tai Seng Bavet SEZ",
            label="Tai Seng SEZ, Bavet",
            lat=11.076,
            lng=106.134,
            category="factory",
        )

    if "canadia" in text or "veng sreng" in text:
        return LocationPoint(
            id="canadia",
            name="Canadia Industrial Park",
            label="Canadia Industrial Park, Veng Sreng, Phnom Penh",
            lat=11.535,
            lng=104.862,
            category="factory",
        )

    if "vattanac" in text:
        return LocationPoint(
            id="vattanac",
            name="Vattanac Industrial Park",
            label="Vattanac Industrial Park, National Road 2",
            lat=11.492,
            lng=104.928,
            category="factory",
        )

    if "ppsez" in text or ("phnom penh" in text and "sez" in text):
        return LocationPoint(
            id="ppsez",
            name="Phnom Penh Special Economic Zone (PPSEZ)",
            label="Phnom Penh SEZ (National Road 4)",
            lat=11.523,
            lng=104.786,
            category="factory",
        )

    if "phnom penh" in text or "kandal" in text:
        if role == "origin":
            return LocationPoint(
                id="ppap_lm17",
                name="Phnom Penh Autonomous Port (LM17)",
                label="PPAP Container Terminal LM17, Kien Svay, Kandal",
                lat=11.475764,
                lng=105.140036,
                category="port",
            )
        if "xin cai fu" in comp or "xincaifu" in comp:
            return XIN_CAI_FU_FACTORY
        return LocationPoint(
            id="ppsez",
            name="Phnom Penh Special Economic Zone (PPSEZ)",
            label="Phnom Penh SEZ (National Road 4)",
            lat=11.523,
            lng=104.786,
            category="factory",
        )

    if role == "destination" and ("xin cai fu" in comp or "xincaifu" in comp):
        return XIN_CAI_FU_FACTORY

    return LocationPoint(
        id="default-pas" if role == "origin" else "default-dest",
        name=(raw or "").strip() or ("PAS Terminal" if role == "origin" else "Destination"),
        label=(raw or "").strip() or ("PAS Container Terminal, Preah Sihanouk" if role == "origin" else "Phnom Penh"),
        lat=10.645722 if role == "origin" else 11.502458,
        lng=103.508383 if role == "origin" else 104.837447,
        category="port" if role == "origin" else "factory",
    )


# -------------------------------------------------------------
# VEHICLES
# -------------------------------------------------------------
@router.get("/vehicles", response_model=list[VehicleView])
def list_vehicles(
    db: DB,
    _user: Staff,
    q: str = Query(default="", max_length=100),
    status: str | None = Query(default=None),
    haulier_type: str | None = Query(default=None),
):
    workspace_id = require_workspace(db)
    stmt = select(FleetVehicle).where(FleetVehicle.workspace_id == workspace_id)
    if q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                FleetVehicle.plate_number.ilike(term),
                FleetVehicle.trailer_plate.ilike(term),
                FleetVehicle.haulier_name.ilike(term),
                FleetVehicle.assigned_driver_name.ilike(term),
            )
        )
    if status and status != "all":
        stmt = stmt.where(FleetVehicle.status == status)
    if haulier_type and haulier_type != "all":
        stmt = stmt.where(FleetVehicle.haulier_type == haulier_type)

    stmt = stmt.order_by(FleetVehicle.plate_number)
    return list(db.scalars(stmt))


@router.post("/vehicles", response_model=VehicleView, status_code=201, dependencies=mutation)
def create_vehicle(payload: VehicleInput, db: DB, _user: Staff):
    workspace_id = require_workspace(db)
    existing = db.scalar(
        select(FleetVehicle).where(
            FleetVehicle.workspace_id == workspace_id,
            FleetVehicle.plate_number == payload.plate_number.strip(),
        )
    )
    if existing:
        raise HTTPException(409, f"Vehicle with plate {payload.plate_number} already exists")

    vehicle = FleetVehicle(
        workspace_id=workspace_id,
        plate_number=payload.plate_number.strip(),
        trailer_plate=payload.trailer_plate.strip() if payload.trailer_plate else None,
        vehicle_type=payload.vehicle_type,
        haulier_type=payload.haulier_type,
        haulier_name=payload.haulier_name.strip() or "Harborway Fleet",
        assigned_driver_id=payload.assigned_driver_id,
        assigned_driver_name=payload.assigned_driver_name.strip() if payload.assigned_driver_name else None,
        driver_phone=payload.driver_phone.strip() if payload.driver_phone else None,
        status=payload.status,
        capacity=payload.capacity,
        notes=payload.notes,
    )
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleView, dependencies=mutation)
def update_vehicle(vehicle_id: UUID, payload: VehicleUpdate, db: DB, _user: Staff):
    workspace_id = require_workspace(db)
    vehicle = db.scalar(
        select(FleetVehicle).where(
            FleetVehicle.id == vehicle_id, FleetVehicle.workspace_id == workspace_id
        )
    )
    if not vehicle:
        raise HTTPException(404, "Vehicle not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(vehicle, field, value)

    vehicle.updated_at = datetime.now()
    db.commit()
    db.refresh(vehicle)
    return vehicle


@router.delete("/vehicles/{vehicle_id}", status_code=204, dependencies=mutation)
def delete_vehicle(vehicle_id: UUID, db: DB, _user: Staff):
    workspace_id = require_workspace(db)
    vehicle = db.scalar(
        select(FleetVehicle).where(
            FleetVehicle.id == vehicle_id, FleetVehicle.workspace_id == workspace_id
        )
    )
    if not vehicle:
        raise HTTPException(404, "Vehicle not found")
    db.delete(vehicle)
    db.commit()
    return Response(status_code=204)


# -------------------------------------------------------------
# DRIVERS
# -------------------------------------------------------------
@router.get("/drivers", response_model=list[DriverView])
def list_drivers(
    db: DB,
    _user: Staff,
    q: str = Query(default="", max_length=100),
    status: str | None = Query(default=None),
):
    workspace_id = require_workspace(db)
    stmt = select(FleetDriver).where(FleetDriver.workspace_id == workspace_id)
    if q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                FleetDriver.name.ilike(term),
                FleetDriver.phone.ilike(term),
                FleetDriver.license_number.ilike(term),
                FleetDriver.assigned_vehicle_plate.ilike(term),
            )
        )
    if status and status != "all":
        stmt = stmt.where(FleetDriver.status == status)

    stmt = stmt.order_by(FleetDriver.name)
    return list(db.scalars(stmt))


@router.post("/drivers", response_model=DriverView, status_code=201, dependencies=mutation)
def create_driver(payload: DriverInput, db: DB, _user: Staff):
    workspace_id = require_workspace(db)
    driver = FleetDriver(
        workspace_id=workspace_id,
        name=payload.name.strip(),
        phone=payload.phone.strip(),
        license_number=payload.license_number.strip() if payload.license_number else None,
        national_id=payload.national_id.strip() if payload.national_id else None,
        assigned_vehicle_plate=payload.assigned_vehicle_plate.strip() if payload.assigned_vehicle_plate else None,
        status=payload.status,
        notes=payload.notes,
    )
    db.add(driver)
    db.commit()
    db.refresh(driver)
    return driver


@router.patch("/drivers/{driver_id}", response_model=DriverView, dependencies=mutation)
def update_driver(driver_id: UUID, payload: DriverUpdate, db: DB, _user: Staff):
    workspace_id = require_workspace(db)
    driver = db.scalar(
        select(FleetDriver).where(
            FleetDriver.id == driver_id, FleetDriver.workspace_id == workspace_id
        )
    )
    if not driver:
        raise HTTPException(404, "Driver not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(driver, field, value)

    driver.updated_at = datetime.now()
    db.commit()
    db.refresh(driver)
    return driver


@router.delete("/drivers/{driver_id}", status_code=204, dependencies=mutation)
def delete_driver(driver_id: UUID, db: DB, _user: Staff):
    workspace_id = require_workspace(db)
    driver = db.scalar(
        select(FleetDriver).where(
            FleetDriver.id == driver_id, FleetDriver.workspace_id == workspace_id
        )
    )
    if not driver:
        raise HTTPException(404, "Driver not found")
    db.delete(driver)
    db.commit()
    return Response(status_code=204)


# -------------------------------------------------------------
# DISPATCHES & REAL-TIME TRACKING
# -------------------------------------------------------------
@router.get("/tracking", response_model=list[TrackingDispatchView])
def get_fleet_tracking(
    db: DB,
    _user: Staff,
    q: str = Query(default="", max_length=100),
    shipment_ref: str | None = Query(default=None),
):
    workspace_id = require_workspace(db)
    stmt = select(FleetDispatch).where(FleetDispatch.workspace_id == workspace_id)
    if shipment_ref:
        stmt = stmt.where(FleetDispatch.shipment_ref == shipment_ref.strip())
    if q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                FleetDispatch.trip_number.ilike(term),
                FleetDispatch.shipment_ref.ilike(term),
                FleetDispatch.truck_plate.ilike(term),
                FleetDispatch.company_name.ilike(term),
                FleetDispatch.driver_name.ilike(term),
            )
        )
    stmt = stmt.order_by(FleetDispatch.created_at.desc())
    dispatches = list(db.scalars(stmt))

    # Pre-fetch vehicles in workspace for haulier info
    vehicles = list(
        db.scalars(select(FleetVehicle).where(FleetVehicle.workspace_id == workspace_id))
    )
    veh_map = {v.plate_number.lower().replace(" ", ""): v for v in vehicles}

    # Pre-fetch import records and extracted B/L vessel fields for matched references
    refs = [d.shipment_ref for d in dispatches]
    imports = (
        list(db.scalars(select(ImportRecord).where(ImportRecord.invoice_no.in_(refs))))
        if refs
        else []
    )
    imp_map = {i.invoice_no: i for i in imports}

    extracted_bl_by_case: dict[UUID, dict[str, str]] = {}
    if imports:
        case_ids = [i.intake_case_id for i in imports]
        ext_rows = db.execute(
            select(IntakeCase.id, DocumentExtraction.payload)
            .join(
                ReviewSnapshot,
                (ReviewSnapshot.intake_case_id == IntakeCase.id)
                & (ReviewSnapshot.revision == IntakeCase.analysis_revision),
            )
            .join(DocumentExtraction, DocumentExtraction.snapshot_id == ReviewSnapshot.id)
            .where(
                IntakeCase.id.in_(case_ids),
                DocumentExtraction.role.in_(("final_bl", "draft_bl")),
            )
        ).all()
        for case_id, payload in ext_rows:
            fields = (payload or {}).get("fields", {}) if isinstance(payload, dict) else {}
            bl_meta: dict[str, str] = {}
            for key in ("vessel", "voyage", "port_of_loading", "port_of_discharge"):
                val = fields.get(key, {}).get("value") if isinstance(fields.get(key), dict) else None
                if val:
                    bl_meta[key] = str(val).strip()
            if bl_meta and case_id not in extracted_bl_by_case:
                extracted_bl_by_case[case_id] = bl_meta

    results: list[TrackingDispatchView] = []
    for d in dispatches:
        imp = imp_map.get(d.shipment_ref)
        bl_meta = extracted_bl_by_case.get(imp.intake_case_id, {}) if imp else {}
        v_key = d.truck_plate.lower().replace(" ", "")
        veh = veh_map.get(v_key)

        supplier_name = imp.supplier if imp else None
        consignee_name = imp.consignee if imp else None

        origin_point = _resolve_location_point(
            d.origin, company_name=d.company_name, role="origin"
        )
        destination_point = _resolve_location_point(
            d.destination, company_name=d.company_name, role="destination"
        )

        # Derive vessel telemetry for maritime inbound shipments
        vessel_info: VesselTelemetry | None = None
        ref_upper = d.shipment_ref.upper()
        supp_lower = (supplier_name or "").lower()
        origin_lower = d.origin.lower()
        is_outbound = d.direction == "outbound" or "EXP" in ref_upper
        is_land_border = "bavet" in origin_lower or "border" in origin_lower

        if not is_outbound and not is_land_border:
            if bl_meta.get("vessel"):
                vessel_info = VesselTelemetry(
                    name=bl_meta["vessel"],
                    voyage=bl_meta.get("voyage"),
                    origin_port=bl_meta.get("port_of_loading") or (supplier_name or "Ningbo-Zhoushan Port"),
                    discharge_port=bl_meta.get("port_of_discharge") or "Sihanoukville Autonomous Port (PAS)",
                    status="underway",
                    speed_knots=15.6,
                    progress_pct=75,
                    eta=d.eta,
                )
            elif "SIH" in ref_upper or "ningbo" in supp_lower:
                vessel_info = VesselTelemetry(
                    name="WAN HAI 510",
                    voyage="V.2611S",
                    shipping_line="WAN HAI LINES",
                    origin_port="Ningbo-Zhoushan Port",
                    discharge_port="Sihanoukville Autonomous Port (PAS)",
                    status="underway",
                    speed_knots=16.4,
                    progress_pct=72,
                    eta="2026-11-28 08:00",
                )
            elif "RE" in ref_upper or "shanghai" in supp_lower:
                vessel_info = VesselTelemetry(
                    name="COSCO SHIPPING LOTUS",
                    voyage="V.089S",
                    shipping_line="COSCO SHIPPING",
                    origin_port="Shanghai Yangshan Port",
                    discharge_port="Sihanoukville Autonomous Port (PAS)",
                    status="underway",
                    speed_knots=15.8,
                    progress_pct=85,
                    eta="2026-11-26 14:00",
                )
            else:
                vessel_info = VesselTelemetry(
                    name="SITC SHENZHEN",
                    voyage="V.2604S",
                    shipping_line="SITC CONTAINER LINES",
                    origin_port="Shenzhen Port (Shekou)",
                    discharge_port="Sihanoukville Autonomous Port (PAS)",
                    status="underway",
                    speed_knots=14.9,
                    progress_pct=60,
                    eta="2026-11-29 11:30",
                )

        results.append(
            TrackingDispatchView(
                id=d.id,
                trip_number=d.trip_number,
                shipment_ref=d.shipment_ref,
                company_name=d.company_name,
                direction=d.direction,
                truck_plate=d.truck_plate,
                trailer_plate=d.trailer_plate,
                driver_name=d.driver_name,
                driver_phone=d.driver_phone,
                container_no=d.container_no,
                seal_no=d.seal_no,
                origin=d.origin,
                destination=d.destination,
                milestone=d.milestone,
                eta=d.eta,
                notes=d.notes,
                created_at=d.created_at,
                updated_at=d.updated_at,
                vessel=vessel_info,
                supplier=supplier_name,
                consignee=consignee_name,
                haulier_type=veh.haulier_type if veh else "in_house",
                haulier_name=veh.haulier_name if veh else "Harborway Fleet",
                origin_point=origin_point,
                destination_point=destination_point,
            )
        )

    return results


@router.get("/dispatches", response_model=list[DispatchView])
def list_dispatches(
    db: DB,
    _user: Staff,
    q: str = Query(default="", max_length=100),
    direction: str | None = Query(default=None),
    milestone: str | None = Query(default=None),
):
    workspace_id = require_workspace(db)
    stmt = select(FleetDispatch).where(FleetDispatch.workspace_id == workspace_id)
    if q.strip():
        term = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                FleetDispatch.trip_number.ilike(term),
                FleetDispatch.shipment_ref.ilike(term),
                FleetDispatch.truck_plate.ilike(term),
                FleetDispatch.driver_name.ilike(term),
                FleetDispatch.container_no.ilike(term),
                FleetDispatch.destination.ilike(term),
            )
        )
    if direction and direction != "all":
        stmt = stmt.where(FleetDispatch.direction == direction)
    if milestone and milestone != "all":
        stmt = stmt.where(FleetDispatch.milestone == milestone)

    stmt = stmt.order_by(FleetDispatch.created_at.desc())
    return list(db.scalars(stmt))


@router.post("/dispatches", response_model=DispatchView, status_code=201, dependencies=mutation)
def create_dispatch(payload: DispatchInput, db: DB, _user: Staff):
    workspace_id = require_workspace(db)
    dispatch = FleetDispatch(
        workspace_id=workspace_id,
        trip_number=payload.trip_number.strip(),
        shipment_ref=payload.shipment_ref.strip(),
        company_name=payload.company_name.strip(),
        direction=payload.direction,
        truck_plate=payload.truck_plate.strip(),
        trailer_plate=payload.trailer_plate.strip() if payload.trailer_plate else None,
        driver_name=payload.driver_name.strip(),
        driver_phone=payload.driver_phone.strip(),
        container_no=payload.container_no.strip(),
        seal_no=payload.seal_no.strip(),
        origin=payload.origin.strip(),
        destination=payload.destination.strip(),
        milestone=payload.milestone,
        eta=payload.eta.strip() if payload.eta else None,
        notes=payload.notes,
    )
    db.add(dispatch)
    db.commit()
    db.refresh(dispatch)
    return dispatch


@router.patch("/dispatches/{dispatch_id}", response_model=DispatchView, dependencies=mutation)
def update_dispatch(dispatch_id: UUID, payload: DispatchUpdate, db: DB, _user: Staff):
    workspace_id = require_workspace(db)
    dispatch = db.scalar(
        select(FleetDispatch).where(
            FleetDispatch.id == dispatch_id, FleetDispatch.workspace_id == workspace_id
        )
    )
    if not dispatch:
        raise HTTPException(404, "Dispatch trip not found")

    required_str_fields = {
        "shipment_ref",
        "company_name",
        "direction",
        "truck_plate",
        "driver_name",
        "driver_phone",
        "container_no",
        "seal_no",
        "origin",
        "destination",
        "milestone",
    }
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field in required_str_fields:
            if value is None or not str(value).strip():
                continue
            setattr(dispatch, field, str(value).strip())
        elif isinstance(value, str):
            setattr(dispatch, field, value.strip() or None)
        else:
            setattr(dispatch, field, value)

    dispatch.updated_at = datetime.now()
    db.commit()
    db.refresh(dispatch)
    return dispatch


@router.delete("/dispatches/{dispatch_id}", status_code=204, dependencies=mutation)
def delete_dispatch(dispatch_id: UUID, db: DB, _user: Staff):
    workspace_id = require_workspace(db)
    dispatch = db.scalar(
        select(FleetDispatch).where(
            FleetDispatch.id == dispatch_id, FleetDispatch.workspace_id == workspace_id
        )
    )
    if not dispatch:
        raise HTTPException(404, "Dispatch trip not found")
    db.delete(dispatch)
    db.commit()
    return Response(status_code=204)
