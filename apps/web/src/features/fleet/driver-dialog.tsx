"use client";

import React, { useState } from "react";
import { Edit2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { FormDialog } from "@/components/ui/form-dialog";
import { toast } from "@/lib/toast";
import type { Driver } from "@/lib/contracts";
import { createDriver, updateDriver } from "./fleet-api";

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
            <Label htmlFor="dlicense">Driver&apos;s License No</Label>
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
