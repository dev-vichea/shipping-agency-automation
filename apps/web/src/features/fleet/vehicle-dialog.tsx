"use client";

import React, { useState } from "react";
import { Edit2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { FormDialog } from "@/components/ui/form-dialog";
import { toast } from "@/lib/toast";
import type { Vehicle } from "@/lib/contracts";
import { createVehicle, updateVehicle } from "./fleet-api";

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
