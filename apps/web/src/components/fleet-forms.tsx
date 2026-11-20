"use client";

import React, { useState } from "react";
import { Plus, Edit2, UserPlus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { FormDialog } from "@/components/ui/form-dialog";
import { toast } from "@/components/ui/toast";
import type { Vehicle, Driver, DispatchTrip } from "@/lib/contracts";
import {
  createVehicle,
  updateVehicle,
  createDriver,
  updateDriver,
  createDispatch,
  updateDispatch,
} from "@/lib/fleet-api";

export function VehicleDialog({
  vehicle,
  onSaved,
}: {
  vehicle?: Vehicle;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isEdit = !!vehicle;

  const [plateNumber, setPlateNumber] = useState(vehicle?.plate_number ?? "");
  const [trailerPlate, setTrailerPlate] = useState(vehicle?.trailer_plate ?? "");
  const [vehicleType, setVehicleType] = useState<string>(
    vehicle?.vehicle_type ?? "40ft Flatbed Chassis"
  );
  const [haulierType, setHaulierType] = useState<"in_house" | "subcontractor">(
    vehicle?.haulier_type ?? "in_house"
  );
  const [haulierName, setHaulierName] = useState(
    vehicle?.haulier_name ?? "Harborway Fleet"
  );
  const [driverName, setDriverName] = useState(vehicle?.assigned_driver_name ?? "");
  const [driverPhone, setDriverPhone] = useState(vehicle?.driver_phone ?? "");
  const [status, setStatus] = useState<"available" | "on_trip" | "maintenance">(
    vehicle?.status ?? "available"
  );
  const [capacity, setCapacity] = useState(vehicle?.capacity ?? "45 Tons");
  const [notes, setNotes] = useState(vehicle?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plateNumber.trim()) {
      toast.saved("Please enter truck plate number");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Partial<Vehicle> = {
        plate_number: plateNumber.trim(),
        trailer_plate: trailerPlate.trim() || null,
        vehicle_type: vehicleType,
        haulier_type: haulierType,
        haulier_name: haulierName.trim() || (haulierType === "in_house" ? "Harborway Fleet" : "3PL Haulier"),
        assigned_driver_name: driverName.trim() || null,
        driver_phone: driverPhone.trim() || null,
        status,
        capacity: capacity.trim() || "40 Tons",
        notes: notes.trim() || null,
      };

      if (isEdit && vehicle) {
        await updateVehicle(vehicle.id, payload);
        toast.saved("Vehicle updated successfully!");
      } else {
        await createVehicle(payload);
        toast.saved("Vehicle registered successfully!");
      }
      setOpen(false);
      onSaved?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save vehicle");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      title={isEdit ? "Edit Vehicle & Equipment" : "Register New Vehicle"}
      description={
        isEdit
          ? "Update equipment specifications, haulier, and driver assignment."
          : "Add a prime mover, chassis, or flatbed truck to the fleet."
      }
      open={open}
      onOpenChange={setOpen}
      trigger={
        isEdit ? (
          <Button size="icon-xs" variant="ghost" title="Edit Vehicle">
            <Edit2 size={13} aria-hidden />
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5">
            <Plus size={15} aria-hidden /> Add Vehicle
          </Button>
        )
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="plate">Truck Head Plate *</Label>
            <Input
              id="plate"
              placeholder="e.g. Phnom Penh 3E-1234"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="trailer">Trailer / Chassis Plate</Label>
            <Input
              id="trailer"
              placeholder="e.g. 4A-8821"
              value={trailerPlate}
              onChange={(e) => setTrailerPlate(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="vtype">Equipment Type</Label>
            <NativeSelect
              id="vtype"
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
            >
              <option value="40ft Flatbed Chassis">40ft Flatbed Chassis</option>
              <option value="20ft Skeleton Chassis">20ft Skeleton Chassis</option>
              <option value="45ft Goose-neck">45ft Goose-neck</option>
              <option value="Prime Mover (Tractor)">Prime Mover (Tractor)</option>
              <option value="Rigid Truck (5T)">Rigid Truck (5T)</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="status">Operating Status</Label>
            <NativeSelect
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as "available" | "on_trip" | "maintenance")}
            >
              <option value="available">Available (In Yard)</option>
              <option value="on_trip">On Trip (In Transit)</option>
              <option value="maintenance">In Maintenance</option>
            </NativeSelect>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="htype">Fleet Type</Label>
            <NativeSelect
              id="htype"
              value={haulierType}
              onChange={(e) => {
                const val = e.target.value as "in_house" | "subcontractor";
                setHaulierType(val);
                if (val === "in_house") setHaulierName("Harborway Fleet");
              }}
            >
              <option value="in_house">In-House Fleet</option>
              <option value="subcontractor">3PL Subcontractor</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="hname">Carrier / Haulier Name</Label>
            <Input
              id="hname"
              placeholder="e.g. So Nguon Transport"
              value={haulierName}
              onChange={(e) => setHaulierName(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="driver">Assigned Driver</Label>
            <Input
              id="driver"
              placeholder="e.g. Seng Vichea"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="phone">Driver Phone</Label>
            <Input
              id="phone"
              placeholder="e.g. 012 889 912"
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="cap">Payload Capacity</Label>
          <Input
            id="cap"
            placeholder="e.g. 45 Tons"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="notes">Notes / Special Instructions</Label>
          <Input
            id="notes"
            placeholder="e.g. Certified for Bavet border cross-docking"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : isEdit ? "Update Vehicle" : "Save Vehicle"}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

export function DriverDialog({
  driver,
  onSaved,
}: {
  driver?: Driver;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isEdit = !!driver;

  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [license, setLicense] = useState(driver?.license_number ?? "");
  const [nationalId, setNationalId] = useState(driver?.national_id ?? "");
  const [assignedPlate, setAssignedPlate] = useState(
    driver?.assigned_vehicle_plate ?? ""
  );
  const [status, setStatus] = useState<"available" | "on_trip" | "off_duty">(
    driver?.status ?? "available"
  );
  const [notes, setNotes] = useState(driver?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.saved("Please enter driver name");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Partial<Driver> = {
        name: name.trim(),
        phone: phone.trim(),
        license_number: license.trim() || null,
        national_id: nationalId.trim() || null,
        assigned_vehicle_plate: assignedPlate.trim() || null,
        status,
        notes: notes.trim() || null,
      };

      if (isEdit && driver) {
        await updateDriver(driver.id, payload);
        toast.saved("Driver profile updated!");
      } else {
        await createDriver(payload);
        toast.saved("Driver enrolled successfully!");
      }
      setOpen(false);
      onSaved?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save driver");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      title={isEdit ? "Edit Driver Profile" : "Enroll New Driver"}
      description={
        isEdit
          ? "Update driver contact, license number, and vehicle assignment."
          : "Register a transport driver with phone and license details."
      }
      open={open}
      onOpenChange={setOpen}
      trigger={
        isEdit ? (
          <Button size="icon-xs" variant="ghost" title="Edit Driver">
            <Edit2 size={13} aria-hidden />
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5">
            <UserPlus size={15} aria-hidden /> Add Driver
          </Button>
        )
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="dname">Full Name *</Label>
            <Input
              id="dname"
              placeholder="e.g. Seng Vichea"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dphone">Contact Phone *</Label>
            <Input
              id="dphone"
              placeholder="e.g. 012 889 912"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="dlicense">Driver's License No</Label>
            <Input
              id="dlicense"
              placeholder="e.g. DL-KH-204918"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dnid">National ID Card (NID)</Label>
            <Input
              id="dnid"
              placeholder="e.g. NID-01928374"
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="dplate">Assigned Vehicle</Label>
            <Input
              id="dplate"
              placeholder="e.g. Phnom Penh 3E-1234"
              value={assignedPlate}
              onChange={(e) => setAssignedPlate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dstatus">Driver Status</Label>
            <NativeSelect
              id="dstatus"
              value={status}
              onChange={(e) => setStatus(e.target.value as "available" | "on_trip" | "off_duty")}
            >
              <option value="available">Available (On Call)</option>
              <option value="on_trip">On Trip (Active)</option>
              <option value="off_duty">Off Duty / Rest</option>
            </NativeSelect>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="dnotes">Notes / Certifications</Label>
          <Input
            id="dnotes"
            placeholder="e.g. Dangerous goods certified, Bavet border specialist"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : isEdit ? "Update Driver" : "Save Driver"}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

export function DispatchDialog({
  trip,
  vehicles = [],
  drivers = [],
  onSaved,
}: {
  trip?: DispatchTrip;
  vehicles?: Vehicle[];
  drivers?: Driver[];
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isEdit = !!trip;

  const [shipmentRef, setShipmentRef] = useState(trip?.shipment_ref ?? "RE2612049");
  const [companyName, setCompanyName] = useState(trip?.company_name ?? "XIN CAI FU");
  const [direction, setDirection] = useState<"inbound" | "outbound">(
    trip?.direction ?? "inbound"
  );
  const [containerNo, setContainerNo] = useState(trip?.container_no ?? "TGHU1234567");
  const [sealNo, setSealNo] = useState(trip?.seal_no ?? "ML-KH84920");
  const [truckPlate, setTruckPlate] = useState(trip?.truck_plate ?? "Phnom Penh 3E-1234");
  const [driverName, setDriverName] = useState(trip?.driver_name ?? "Seng Vichea");
  const [driverPhone, setDriverPhone] = useState(trip?.driver_phone ?? "012 889 912");
  const [origin, setOrigin] = useState(trip?.origin ?? "PAS (Sihanoukville Port)");
  const [destination, setDestination] = useState(
    trip?.destination ?? "Xin Cai Fu Factory, Phnom Penh SEZ"
  );
  const [milestone, setMilestone] = useState<
    "dispatched" | "gate_out" | "in_transit" | "at_factory" | "empty_returned"
  >(trip?.milestone ?? "dispatched");
  const [eta, setEta] = useState(trip?.eta ?? "Today, 17:00");
  const [notes, setNotes] = useState(trip?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSelectTruck = (plate: string) => {
    setTruckPlate(plate);
    const matched = vehicles.find((v) => v.plate_number === plate);
    if (matched?.assigned_driver_name) {
      setDriverName(matched.assigned_driver_name);
      if (matched.driver_phone) setDriverPhone(matched.driver_phone);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!truckPlate.trim() || !driverName.trim()) {
      toast.saved("Please specify both truck and driver");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Partial<DispatchTrip> = {
        trip_number: trip?.trip_number ?? `TRIP-2026-${Math.floor(100 + Math.random() * 900)}`,
        shipment_ref: shipmentRef.trim(),
        company_name: companyName.trim(),
        direction,
        truck_plate: truckPlate.trim(),
        driver_name: driverName.trim(),
        driver_phone: driverPhone.trim(),
        container_no: containerNo.trim().toUpperCase(),
        seal_no: sealNo.trim().toUpperCase(),
        origin: origin.trim(),
        destination: destination.trim(),
        milestone,
        eta: eta.trim() || null,
        notes: notes.trim() || null,
      };

      if (isEdit && trip) {
        await updateDispatch(trip.id, payload);
        toast.saved("Dispatch trip updated!");
      } else {
        await createDispatch(payload);
        toast.saved("New trip dispatched successfully!");
      }
      setOpen(false);
      onSaved?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save dispatch");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      title={isEdit ? "Update Dispatch Trip" : "Create Dispatch / Haulage Trip"}
      description="Assign truck, driver, container, and seal numbers to transport cargo."
      open={open}
      onOpenChange={setOpen}
      trigger={
        isEdit ? (
          <Button size="icon-xs" variant="ghost" title="Edit Dispatch">
            <Edit2 size={13} aria-hidden />
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5">
            <Send size={15} aria-hidden /> New Dispatch
          </Button>
        )
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="sref">Shipment / Invoice Ref *</Label>
            <Input
              id="sref"
              placeholder="e.g. RE2612049"
              value={shipmentRef}
              onChange={(e) => setShipmentRef(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cname">Client / Consignee</Label>
            <Input
              id="cname"
              placeholder="e.g. XIN CAI FU"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tdir">Direction</Label>
            <NativeSelect
              id="tdir"
              value={direction}
              onChange={(e) => setDirection(e.target.value as "inbound" | "outbound")}
            >
              <option value="inbound">Inbound · Import</option>
              <option value="outbound">Outbound · Export</option>
            </NativeSelect>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="cno">Container No (ISO 6346) *</Label>
            <Input
              id="cno"
              placeholder="e.g. TGHU1234567"
              value={containerNo}
              onChange={(e) => setContainerNo(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sno">Seal No (Carrier / Bolt Seal) *</Label>
            <Input
              id="sno"
              placeholder="e.g. ML-KH84920"
              value={sealNo}
              onChange={(e) => setSealNo(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="tpl">Assigned Truck *</Label>
            <NativeSelect
              id="tpl"
              value={truckPlate}
              onChange={(e) => handleSelectTruck(e.target.value)}
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.plate_number}>
                  {v.plate_number} ({v.vehicle_type} - {v.haulier_name})
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tdr">Assigned Driver *</Label>
            <NativeSelect
              id="tdr"
              value={driverName}
              onChange={(e) => {
                const name = e.target.value;
                setDriverName(name);
                const d = drivers.find((x) => x.name === name);
                if (d) setDriverPhone(d.phone);
              }}
            >
              {drivers.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name} ({d.phone})
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="torg">Origin (Port / Border / Depot)</Label>
            <Input
              id="torg"
              placeholder="e.g. PAS (Sihanoukville Port)"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tdst">Destination (Factory / Warehouse)</Label>
            <Input
              id="tdst"
              placeholder="e.g. Xin Cai Fu Factory, Phnom Penh SEZ"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="tmil">Trip Milestone Status</Label>
            <NativeSelect
              id="tmil"
              value={milestone}
              onChange={(e) => setMilestone(e.target.value as "dispatched" | "gate_out" | "in_transit" | "at_factory" | "empty_returned")}
            >
              <option value="dispatched">Dispatched</option>
              <option value="gate_out">Port Gate-Out</option>
              <option value="in_transit">In Transit (Highway)</option>
              <option value="at_factory">At Factory (Unloading/Stuffing)</option>
              <option value="empty_returned">Empty Returned (Completed)</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="teta">Expected Arrival (ETA)</Label>
            <Input
              id="teta"
              placeholder="e.g. Today, 17:00"
              value={eta}
              onChange={(e) => setEta(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="tnot">Dispatch Notes / Gate Pass Info</Label>
          <Input
            id="tnot"
            placeholder="e.g. Driver carries customs release permit and original B/L"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : isEdit ? "Update Dispatch" : "Confirm & Dispatch"}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
