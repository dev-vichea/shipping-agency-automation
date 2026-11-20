"use client";

import React, { useState } from "react";
import { Edit2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { FormDialog } from "@/components/ui/form-dialog";
import { toast } from "@/lib/toast";
import type { DispatchTrip, Driver, Vehicle } from "@/lib/contracts";
import { createDispatch, updateDispatch } from "./fleet-api";

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
