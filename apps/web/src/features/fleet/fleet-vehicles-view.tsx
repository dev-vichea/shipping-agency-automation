"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Truck,
  PlusCircle,
  CheckCircle2,
  Clock,
  Wrench,
  Search,
  Trash2,
  Link2,
  UserCheck,
  Send,
  ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { PageHeading, Section } from "@/components/ui/page-layout";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ResizableTable, type ResizableColumn } from "@/components/ui/resizable-table";
import { DispatchDialog } from "./dispatch-dialog";
import { VehicleDialog } from "./vehicle-dialog";
import type { Vehicle, Driver, DispatchTrip } from "@/lib/contracts";
import {
  fetchVehicles,
  updateVehicle,
  removeVehicle,
  fetchDrivers,
  fetchDispatches,
} from "@/features/fleet/fleet-api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const COMMON_TRAILERS = [
  "4A-8821 (40ft Flatbed)",
  "4A-9912 (20ft Skeleton)",
  "4B-1123 (40ft Flatbed)",
  "4A-3321 (Prime Chassis)",
  "4A-6677 (45ft Goose-neck)",
  "4A-5544 (Heavy Duty 3-Axle)",
];

export function FleetVehiclesView() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [dispatches, setDispatches] = useState<DispatchTrip[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [haulierFilter, setHaulierFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [vList, dList, tList] = await Promise.all([
        fetchVehicles({ q: search, status: statusFilter, haulier_type: haulierFilter }),
        fetchDrivers(),
        fetchDispatches(),
      ]);
      setVehicles(vList);
      setDrivers(dList);
      setDispatches(tList);
    } catch (err) {
      console.error("Failed to load fleet data from backend:", err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, haulierFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const total = vehicles.length;
    const available = vehicles.filter((v) => v.status === "available").length;
    const onTrip = vehicles.filter((v) => v.status === "on_trip").length;
    const maintenance = vehicles.filter((v) => v.status === "maintenance").length;
    return { total, available, onTrip, maintenance };
  }, [vehicles]);

  const handleUpdateDriver = async (
    vehicle: Vehicle,
    driverId?: string,
    driverName?: string,
    driverPhone?: string
  ) => {
    try {
      await updateVehicle(vehicle.id, {
        assigned_driver_id: driverId ?? null,
        assigned_driver_name: driverName ?? null,
        driver_phone: driverPhone ?? null,
      });
      await refresh();
      toast.saved(
        driverName
          ? `Assigned ${driverName} to ${vehicle.plate_number}`
          : `Unassigned driver from ${vehicle.plate_number}`
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to assign driver");
    }
  };

  const handleUpdateTrailer = async (vehicle: Vehicle, trailerPlate: string) => {
    try {
      await updateVehicle(vehicle.id, {
        trailer_plate: trailerPlate || null,
      });
      await refresh();
      toast.saved(
        trailerPlate
          ? `Assigned trailer ${trailerPlate}`
          : `Cleared trailer assignment`
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update trailer");
    }
  };

  const handleUpdateStatus = async (
    vehicle: Vehicle,
    nextStatus: "available" | "on_trip" | "maintenance"
  ) => {
    try {
      await updateVehicle(vehicle.id, { status: nextStatus });
      await refresh();
      toast.saved(
        `Status set to ${nextStatus === "available" ? "Available" : nextStatus === "on_trip" ? "On Trip" : "Maintenance"}`
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  const handleDelete = async (id: string, plate: string) => {
    if (confirm(`Remove vehicle ${plate} from the database?`)) {
      try {
        await removeVehicle(id);
        await refresh();
        toast.saved(`Removed vehicle ${plate}`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to delete vehicle");
      }
    }
  };

  // Every column is strictly single-line!
  const columns: ResizableColumn<Vehicle>[] = [
    {
      id: "index",
      header: "#",
      defaultWidth: 46,
      minWidth: 40,
      align: "center",
      cell: (_, idx) => <span className="font-mono text-muted-foreground">{idx + 1}</span>,
    },
    {
      id: "plate",
      header: "Truck Head Plate",
      defaultWidth: 180,
      minWidth: 140,
      cell: (v) => (
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          <Truck size={13} className="text-primary shrink-0" aria-hidden />
          <span className="font-mono font-medium text-foreground tracking-tight">
            {v.plate_number}
          </span>
        </div>
      ),
    },
    {
      id: "type",
      header: "Equipment Type",
      defaultWidth: 160,
      minWidth: 130,
      cell: (v) => (
        <span className="text-foreground whitespace-nowrap">{v.vehicle_type}</span>
      ),
    },
    // SPLIT: Haulier Name (1 line)
    {
      id: "haulier",
      header: "Haulier",
      defaultWidth: 160,
      minWidth: 120,
      cell: (v) => (
        <span className="font-medium text-foreground whitespace-nowrap truncate block">
          {v.haulier_name}
        </span>
      ),
    },
    // SPLIT: Fleet Type (1 line badge)
    {
      id: "fleet_type",
      header: "Fleet Type",
      defaultWidth: 120,
      minWidth: 100,
      align: "center",
      cell: (v) => (
        <span
          className={cn(
            "inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap border",
            v.haulier_type === "in_house"
              ? "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
              : "bg-amber-50 text-amber-800 border-amber-300/60 dark:bg-amber-950/40 dark:text-amber-300"
          )}
        >
          {v.haulier_type === "in_house" ? "In-House" : "3PL Haulier"}
        </span>
      ),
    },
    // ASSIGNMENTS: Trailer / Chassis (1 line)
    {
      id: "trailer",
      header: (
        <span className="inline-flex items-center gap-1 text-primary dark:text-sky-400">
          <Link2 size={11} /> Trailer
        </span>
      ),
      defaultWidth: 140,
      minWidth: 110,
      cell: (v) => {
        return (
          <Popover>
            <PopoverTrigger asChild>
              {v.trailer_plate ? (
                <button
                  type="button"
                  className="group/btn inline-flex items-center gap-1 font-mono text-xs font-medium text-foreground hover:text-primary transition-colors whitespace-nowrap"
                  title="Click to reassign trailer"
                >
                  <span className="underline decoration-border group-hover/btn:decoration-primary">
                    {v.trailer_plate}
                  </span>
                  <span className="text-[10px] text-muted-foreground opacity-60 group-hover/btn:opacity-100">
                    ✎
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
                >
                  <PlusCircle size={13} />
                  <span>Assign</span>
                </button>
              )}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3 space-y-2.5">
              <div className="flex items-center justify-between border-b pb-1.5">
                <span className="text-xs font-semibold text-foreground">
                  Assign Trailer / Chassis
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {v.plate_number.split(" ")[1] ?? v.plate_number}
                </span>
              </div>
              <div className="space-y-1.5">
                <span className="text-[11px] text-muted-foreground">
                  Quick select chassis:
                </span>
                <div className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1">
                  {COMMON_TRAILERS.map((item) => {
                    const plate = item.split(" ")[0];
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => void handleUpdateTrailer(v, plate)}
                        className={cn(
                          "flex items-center justify-between rounded px-2 py-1 text-xs text-left transition-colors",
                          v.trailer_plate === plate
                            ? "bg-primary text-primary-foreground font-medium"
                            : "hover:bg-accent text-foreground"
                        )}
                      >
                        <span className="font-mono">{plate}</span>
                        <span className="text-[10px] opacity-75">
                          {item.split("(")[1]?.replace(")", "") ?? ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {v.trailer_plate && (
                <div className="pt-2 border-t">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => void handleUpdateTrailer(v, "")}
                    className="w-full text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs h-7"
                  >
                    Unassign Trailer
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        );
      },
    },
    // SPLIT: Assigned Driver Name (1 line)
    {
      id: "driver_name",
      header: (
        <span className="inline-flex items-center gap-1 text-primary dark:text-sky-400">
          <UserCheck size={11} /> Assigned Driver
        </span>
      ),
      defaultWidth: 160,
      minWidth: 130,
      cell: (v) => {
        return (
          <Popover>
            <PopoverTrigger asChild>
              {v.assigned_driver_name ? (
                <button
                  type="button"
                  className="group/drv inline-flex items-center gap-1 text-left transition-colors whitespace-nowrap"
                  title="Click to reassign driver"
                >
                  <span className="font-medium text-foreground text-xs underline decoration-border group-hover/drv:decoration-primary group-hover/drv:text-primary">
                    {v.assigned_driver_name}
                  </span>
                  <span className="text-[10px] text-muted-foreground opacity-60 group-hover/drv:opacity-100">
                    ✎
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
                >
                  <PlusCircle size={13} />
                  <span>Assign</span>
                </button>
              )}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3 space-y-2.5">
              <div className="flex items-center justify-between border-b pb-1.5">
                <span className="text-xs font-semibold text-foreground">
                  Assign Driver
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {v.plate_number.split(" ")[1] ?? v.plate_number}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">
                  Available drivers ({drivers.length}):
                </span>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                  {drivers.map((d) => {
                    const isAssigned = v.assigned_driver_name === d.name;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => void handleUpdateDriver(v, d.id, d.name, d.phone)}
                        className={cn(
                          "flex items-center justify-between rounded px-2 py-1.5 text-xs text-left transition-colors",
                          isAssigned
                            ? "bg-primary text-primary-foreground font-medium"
                            : "hover:bg-accent text-foreground"
                        )}
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{d.name}</span>
                          <span className="font-mono text-[10px] opacity-75">
                            {d.phone}
                          </span>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[9px] uppercase font-semibold",
                            d.status === "available"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                              : d.status === "on_trip"
                              ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                              : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          )}
                        >
                          {d.status.replace("_", " ")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {v.assigned_driver_name && (
                <div className="pt-2 border-t">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => void handleUpdateDriver(v, undefined, undefined, undefined)}
                    className="w-full text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs h-7"
                  >
                    Unassign Driver
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        );
      },
    },
    // SPLIT: Driver Phone (1 line)
    {
      id: "driver_phone",
      header: "Driver Phone",
      defaultWidth: 140,
      minWidth: 110,
      cell: (v) =>
        v.driver_phone ? (
          <a
            href={`tel:${v.driver_phone.replace(/\s+/g, "")}`}
            className="font-mono text-xs text-muted-foreground hover:text-primary hover:underline whitespace-nowrap"
          >
            {v.driver_phone}
          </a>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        ),
    },
    // SPLIT: Active Trip # (1 line)
    {
      id: "active_trip",
      header: (
        <span className="inline-flex items-center gap-1 text-primary dark:text-sky-400">
          <Send size={11} /> Active Trip
        </span>
      ),
      defaultWidth: 140,
      minWidth: 110,
      cell: (v) => {
        const activeTrip = dispatches.find(
          (t) =>
            t.truck_plate.includes(v.plate_number.split(" ")[1] ?? v.plate_number) ||
            v.plate_number.includes(t.truck_plate.split(" ")[1] ?? t.truck_plate)
        );

        if (activeTrip) {
          return (
            <span className="font-mono text-xs font-semibold text-primary whitespace-nowrap">
              {activeTrip.trip_number}
            </span>
          );
        }

        return (
          <DispatchDialog
            trip={{
              id: "",
              trip_number: `TRIP-2026-${Math.floor(100 + Math.random() * 900)}`,
              shipment_ref: "RE2612049",
              company_name: "XIN CAI FU",
              direction: "inbound",
              truck_plate: v.plate_number,
              trailer_plate: v.trailer_plate ?? "",
              driver_name: v.assigned_driver_name ?? "Seng Vichea",
              driver_phone: v.driver_phone ?? "012 889 912",
              container_no: "TGHU1234567",
              seal_no: "ML-KH84920",
              origin: "PAS (Sihanoukville Port)",
              destination: "Xin Cai Fu Factory, Phnom Penh SEZ",
              milestone: "dispatched",
              eta: "Today, 17:00",
            }}
            vehicles={vehicles}
            drivers={drivers}
            onSaved={refresh}
          />
        );
      },
    },
    // SPLIT: Shipment Ref (1 line)
    {
      id: "shipment_ref",
      header: "Shipment Ref",
      defaultWidth: 130,
      minWidth: 100,
      cell: (v) => {
        const activeTrip = dispatches.find(
          (t) =>
            t.truck_plate.includes(v.plate_number.split(" ")[1] ?? v.plate_number) ||
            v.plate_number.includes(t.truck_plate.split(" ")[1] ?? t.truck_plate)
        );

        return activeTrip ? (
          <Link
            href="/imports"
            className="font-mono text-xs text-primary hover:underline whitespace-nowrap"
          >
            {activeTrip.shipment_ref}
          </Link>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        );
      },
    },
    {
      id: "capacity",
      header: "Payload",
      defaultWidth: 95,
      minWidth: 80,
      align: "right",
      cell: (v) => (
        <span className="font-mono text-code-tabular text-muted-foreground text-xs whitespace-nowrap">
          {v.capacity}
        </span>
      ),
    },
    // OPERATING STATUS (1 line clickable badge)
    {
      id: "status",
      header: "Status",
      defaultWidth: 130,
      minWidth: 110,
      align: "center",
      cell: (v) => {
        const style =
          v.status === "available"
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300/40"
            : v.status === "on_trip"
            ? "bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border-sky-300/40"
            : "bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300/40";
        const label =
          v.status === "available"
            ? "Available"
            : v.status === "on_trip"
            ? "On Trip"
            : "Maintenance";

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border cursor-pointer hover:ring-1 hover:ring-primary/40 transition-all whitespace-nowrap",
                  style
                )}
                title="Click to change vehicle status"
              >
                <span className="size-1.5 rounded-full bg-current opacity-80 shrink-0" />
                <span>{label}</span>
                <ChevronDown size={10} className="opacity-60 ml-0.5 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-36">
              <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground">
                Set Status
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void handleUpdateStatus(v, "available")}
                className="text-xs gap-2"
              >
                <span className="size-2 rounded-full bg-emerald-500" />
                <span>Available</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleUpdateStatus(v, "on_trip")}
                className="text-xs gap-2"
              >
                <span className="size-2 rounded-full bg-sky-500" />
                <span>On Trip</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleUpdateStatus(v, "maintenance")}
                className="text-xs gap-2"
              >
                <span className="size-2 rounded-full bg-rose-500" />
                <span>Maintenance</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      defaultWidth: 80,
      minWidth: 70,
      align: "right",
      cell: (v) => (
        <div className="flex items-center justify-end gap-1">
          <VehicleDialog vehicle={v} onSaved={refresh} />
          <Button
            size="icon-xs"
            variant="ghost"
            title="Delete Vehicle"
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete(v.id, v.plate_number);
            }}
            className="text-muted-foreground hover:text-rose-600"
          >
            <Trash2 size={13} aria-hidden />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* 1. Header with Add Vehicle at Top */}
      <PageHeading
        title="Vehicles & Equipment"
        description="Monitor trucks, trailers, carrier fleets, and direct driver assignments."
        action={<VehicleDialog onSaved={refresh} />}
      />

      {/* 2. The 4 KPI Cards Above the Table */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Total Fleet</span>
            <Truck size={16} />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-foreground">
            {stats.total}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span className="text-xs font-medium">Available in Yard</span>
            <CheckCircle2 size={16} />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.available}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-sky-600 dark:text-sky-400">
            <span className="text-xs font-medium">On Trip (In Transit)</span>
            <Clock size={16} />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-sky-600 dark:text-sky-400">
            {stats.onTrip}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
            <span className="text-xs font-medium">Maintenance</span>
            <Wrench size={16} />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-rose-600 dark:text-rose-400">
            {stats.maintenance}
          </div>
        </div>
      </div>

      {/* 3. Main Table Section - Direct Edge-to-Edge Table (No double container wrap) */}
      <Section title="Fleet Inventory & Direct Assignments">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 sm:max-w-xl">
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search plate, trailer, driver, haulier…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs bg-background"
              />
            </div>
            <NativeSelect
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 text-xs w-36 bg-background"
            >
              <option value="all">All statuses</option>
              <option value="available">Available</option>
              <option value="on_trip">On Trip</option>
              <option value="maintenance">Maintenance</option>
            </NativeSelect>
            <NativeSelect
              value={haulierFilter}
              onChange={(e) => setHaulierFilter(e.target.value)}
              className="h-8 text-xs w-36 bg-background"
            >
              <option value="all">All fleets</option>
              <option value="in_house">In-House Fleet</option>
              <option value="subcontractor">3PL Subcontractor</option>
            </NativeSelect>
          </div>
        </div>

        {/* Resizable Table sits DIRECTLY in Section (no inner card wrap, edge-to-edge) */}
        <ResizableTable
          columns={columns}
          data={vehicles}
          storageKey="fleet_vehicles"
          rowKey={(v) => v.id}
          className="min-w-[1200px]"
          emptyState={
            <div className="py-8 text-center">
              <Truck size={28} className="mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium text-foreground">
                {loading ? "Loading fleet data from database…" : "No vehicles found"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Try adjusting your search filter or click &quot;Add Vehicle&quot; at the top.
              </p>
            </div>
          }
        />
      </Section>
    </div>
  );
}
