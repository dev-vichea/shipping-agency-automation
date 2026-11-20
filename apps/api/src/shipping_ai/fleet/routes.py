from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select

from shipping_ai.core.access import require_workspace
from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.models import FleetDispatch, FleetDriver, FleetVehicle

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
# DISPATCHES
# -------------------------------------------------------------
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

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
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
