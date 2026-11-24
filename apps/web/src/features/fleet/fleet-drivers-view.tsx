"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Users,
  Phone,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Moon,
  Trash2,
  Truck,
  PlusCircle,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/page-layout";
import { FleetStatGrid, type FleetStatItem } from "./fleet-stat-grid";
import { FleetFilterBar, type FilterCategoryGroup } from "./fleet-filter-bar";
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
import { DriverDialog } from "./driver-dialog";
import type { Driver, Vehicle } from "@/lib/contracts";
import {
  fetchDrivers,
  updateDriver,
  removeDriver,
  fetchVehicles,
} from "@/features/fleet/fleet-api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function FleetDriversView() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [dList, vList] = await Promise.all([
        fetchDrivers({ q: search, status: statusFilter }),
        fetchVehicles(),
      ]);
      setDrivers(dList);
      setVehicles(vList);
    } catch (err) {
      console.error("Failed to load driver data from API:", err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const total = drivers.length;
    const available = drivers.filter((d) => d.status === "available").length;
    const onTrip = drivers.filter((d) => d.status === "on_trip").length;
    const offDuty = drivers.filter((d) => d.status === "off_duty").length;
    return { total, available, onTrip, offDuty };
  }, [drivers]);

  const statItems: FleetStatItem[] = useMemo(
    () => [
      {
        id: "total",
        label: "Enrolled Drivers",
        value: stats.total,
        icon: Users,
        active: statusFilter === "all",
        onClick: () => setStatusFilter("all"),
      },
      {
        id: "available",
        label: "Available (On Call)",
        value: stats.available,
        icon: CheckCircle2,
        iconColor: "text-emerald-500",
        active: statusFilter === "available",
        onClick: () => setStatusFilter(statusFilter === "available" ? "all" : "available"),
      },
      {
        id: "on_trip",
        label: "Active on Trip",
        value: stats.onTrip,
        icon: Clock,
        iconColor: "text-sky-500",
        active: statusFilter === "on_trip",
        onClick: () => setStatusFilter(statusFilter === "on_trip" ? "all" : "on_trip"),
      },
      {
        id: "off_duty",
        label: "Off Duty / Rest",
        value: stats.offDuty,
        icon: Moon,
        iconColor: "text-slate-400",
        active: statusFilter === "off_duty",
        onClick: () => setStatusFilter(statusFilter === "off_duty" ? "all" : "off_duty"),
      },
    ],
    [stats, statusFilter]
  );

  const categories: FilterCategoryGroup[] = useMemo(
    () => [
      {
        id: "status",
        label: "Status",
        value: statusFilter,
        onToggle: (val) => setStatusFilter(statusFilter === val ? "all" : val),
        options: [
          { value: "all", label: "All Statuses", count: stats.total },
          { value: "available", label: "Available", count: stats.available, dotColor: "bg-emerald-500" },
          { value: "on_trip", label: "On Trip", count: stats.onTrip, dotColor: "bg-sky-500" },
          { value: "off_duty", label: "Off Duty", count: stats.offDuty, dotColor: "bg-slate-400" },
        ],
      },
    ],
    [statusFilter, stats]
  );

  const handleReset = () => {
    setSearch("");
    setStatusFilter("all");
  };

  const hasActiveFilters = Boolean(search || statusFilter !== "all");

  const handleUpdateVehicle = useCallback(
    async (driver: Driver, plate?: string) => {
      try {
        await updateDriver(driver.id, {
          assigned_vehicle_plate: plate ?? null,
        });
        await refresh();
        toast.saved(
          plate
            ? `Assigned vehicle ${plate} to ${driver.name}`
            : `Unassigned vehicle from ${driver.name}`
        );
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update vehicle");
      }
    },
    [refresh]
  );

  const handleUpdateStatus = useCallback(
    async (
      driver: Driver,
      nextStatus: "available" | "on_trip" | "off_duty"
    ) => {
      try {
        await updateDriver(driver.id, { status: nextStatus });
        await refresh();
        toast.saved(
          `Driver status set to ${
            nextStatus === "available"
              ? "Available"
              : nextStatus === "on_trip"
              ? "On Trip"
              : "Off Duty"
          }`
        );
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update status");
      }
    },
    [refresh]
  );

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (confirm(`Remove driver ${name} from the database?`)) {
        try {
          await removeDriver(id);
          await refresh();
          toast.saved(`Removed driver ${name}`);
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Failed to delete driver");
        }
      }
    },
    [refresh]
  );

  // Strictly single-line per cell!
  const columns: ResizableColumn<Driver>[] = useMemo(
    () => [
    {
      id: "index",
      header: "#",
      defaultWidth: 46,
      minWidth: 40,
      align: "center",
      cell: (_, idx) => <span className="font-mono text-muted-foreground">{idx + 1}</span>,
    },
    {
      id: "name",
      header: "Driver Name",
      defaultWidth: 170,
      minWidth: 130,
      cell: (d) => (
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="grid size-6 place-items-center rounded bg-primary/10 text-primary shrink-0">
            <Users size={13} aria-hidden />
          </span>
          <span className="font-medium text-foreground tracking-tight">{d.name}</span>
        </div>
      ),
    },
    {
      id: "phone",
      header: "Phone Number",
      defaultWidth: 140,
      minWidth: 110,
      cell: (d) => (
        <a
          href={`tel:${d.phone.replace(/\s+/g, "")}`}
          className="inline-flex items-center gap-1.5 font-mono text-primary hover:underline text-xs whitespace-nowrap"
        >
          <Phone size={12} className="text-muted-foreground shrink-0" />
          <span>{d.phone}</span>
        </a>
      ),
    },
    // SPLIT: Driving License (1 line)
    {
      id: "license",
      header: "Driving License",
      defaultWidth: 140,
      minWidth: 110,
      cell: (d) => (
        <span className="font-mono text-code-tabular text-foreground text-xs whitespace-nowrap">
          {d.license_number || "—"}
        </span>
      ),
    },
    // SPLIT: National ID / NID (1 line)
    {
      id: "national_id",
      header: "National ID (NID)",
      defaultWidth: 140,
      minWidth: 110,
      cell: (d) => (
        <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {d.national_id || "—"}
        </span>
      ),
    },
    // ASSIGNMENT: Vehicle (Direct Inline)
    {
      id: "assigned_truck",
      header: (
        <span className="inline-flex items-center gap-1 text-primary dark:text-sky-400">
          <Truck size={12} /> Assigned Truck
        </span>
      ),
      defaultWidth: 170,
      minWidth: 130,
      cell: (d) => {
        return (
          <Popover>
            <PopoverTrigger asChild>
              {d.assigned_vehicle_plate ? (
                <button
                  type="button"
                  className="group/veh flex items-center gap-1.5 font-mono text-xs font-medium text-foreground hover:text-primary transition-colors text-left whitespace-nowrap"
                  title="Click to reassign vehicle"
                >
                  <span className="underline decoration-border group-hover/veh:decoration-primary">
                    {d.assigned_vehicle_plate}
                  </span>
                  <span className="text-[10px] text-muted-foreground opacity-60 group-hover/veh:opacity-100">
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
                  Assign Truck to {d.name}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-muted-foreground">
                  Select fleet vehicle:
                </span>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                  {vehicles.map((v) => {
                    const isCurrent = d.assigned_vehicle_plate === v.plate_number;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => void handleUpdateVehicle(d, v.plate_number)}
                        className={cn(
                          "flex items-center justify-between rounded px-2 py-1.5 text-xs text-left transition-colors",
                          isCurrent
                            ? "bg-primary text-primary-foreground font-medium"
                            : "hover:bg-accent text-foreground"
                        )}
                      >
                        <div className="flex flex-col">
                          <span className="font-mono font-medium">{v.plate_number}</span>
                          <span className="text-[10px] opacity-75">{v.vehicle_type}</span>
                        </div>
                        <span className="text-[10px] font-mono opacity-80">
                          {v.status}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {d.assigned_vehicle_plate && (
                <div className="pt-2 border-t">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => void handleUpdateVehicle(d, undefined)}
                    className="w-full text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs h-7"
                  >
                    Unassign Truck
                  </Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        );
      },
    },
    {
      id: "safety",
      header: "Safety Rating",
      defaultWidth: 110,
      minWidth: 90,
      align: "center",
      cell: (d) => (
        <span className="inline-flex items-center gap-1 font-mono text-amber-600 dark:text-amber-400 text-xs whitespace-nowrap">
          <ShieldCheck size={13} />
          <span>{d.safety_rating}</span>
        </span>
      ),
    },
    {
      id: "trips",
      header: "Total Trips",
      defaultWidth: 95,
      minWidth: 80,
      align: "right",
      cell: (d) => (
        <span className="font-mono text-code-tabular text-muted-foreground text-xs whitespace-nowrap">
          {d.total_trips}
        </span>
      ),
    },
    // OPERATING STATUS (Interactive inline status dropdown)
    {
      id: "status",
      header: "Status",
      defaultWidth: 130,
      minWidth: 110,
      align: "center",
      cell: (d) => {
        const style =
          d.status === "available"
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300/40"
            : d.status === "on_trip"
            ? "bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border-sky-300/40"
            : "bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300/40";
        const label =
          d.status === "available"
            ? "Available"
            : d.status === "on_trip"
            ? "On Trip"
            : "Off Duty";

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border cursor-pointer hover:ring-1 hover:ring-primary/40 transition-all whitespace-nowrap",
                  style
                )}
                title="Click to change driver status"
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
                onClick={() => void handleUpdateStatus(d, "available")}
                className="text-xs gap-2"
              >
                <span className="size-2 rounded-full bg-emerald-500" />
                <span>Available</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleUpdateStatus(d, "on_trip")}
                className="text-xs gap-2"
              >
                <span className="size-2 rounded-full bg-sky-500" />
                <span>On Trip</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleUpdateStatus(d, "off_duty")}
                className="text-xs gap-2"
              >
                <span className="size-2 rounded-full bg-slate-400" />
                <span>Off Duty</span>
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
      cell: (d) => (
        <div className="flex items-center justify-end gap-1">
          <DriverDialog driver={d} onSaved={refresh} />
          <Button
            size="icon-xs"
            variant="ghost"
            title="Delete Driver"
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete(d.id, d.name);
            }}
            className="text-muted-foreground hover:text-rose-600"
          >
            <Trash2 size={13} aria-hidden />
          </Button>
        </div>
      ),
    },
  ],
  [vehicles, refresh, handleDelete, handleUpdateStatus, handleUpdateVehicle]
);

  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const columnLabels: Record<string, string> = useMemo(
    () => ({
      index: "#",
      name: "Driver Name",
      phone: "Phone Number",
      license: "Driving License",
      national_id: "National ID (NID)",
      assigned_truck: "Assigned Truck",
      trips: "Total Trips",
      status: "Status",
    }),
    []
  );

  const columnsOptions = useMemo(
    () =>
      columns
        .filter((c) => c.id !== "actions")
        .map((c) => ({
          id: c.id,
          label: columnLabels[c.id] ?? c.id,
          visible: !hiddenColumns.has(c.id),
        })),
    [columns, hiddenColumns, columnLabels]
  );

  const toggleColumn = (id: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenColumns.has(c.id)),
    [columns, hiddenColumns]
  );

  return (
    <div className="space-y-3">
      {/* 1. Header with Add Driver at Top (Subtitle removed) */}
      <PageHeading
        title="Drivers Directory"
        action={<DriverDialog onSaved={refresh} />}
      />

      {/* 2. Connected Grid Card (No Gap, no border accent) */}
      <FleetStatGrid items={statItems} />

      {/* 3. Search and Action controls OUTSIDE the table, NO background, NO border */}
      <FleetFilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search driver name, phone, license, vehicle…"
        categories={categories}
        columns={columnsOptions}
        onToggleColumn={toggleColumn}
        onReset={handleReset}
        hasActiveFilters={hasActiveFilters}
      />

      {/* 4. Table container */}
      <div className="panel overflow-hidden">
        <ResizableTable
          columns={visibleColumns}
          data={drivers}
          storageKey="fleet_drivers"
          rowKey={(d) => d.id}
          className="min-w-[1100px]"
          emptyState={
            <div className="py-8 text-center">
              <Users size={28} className="mx-auto text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium text-foreground">
                {loading ? "Loading drivers from database…" : "No drivers found"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Click &quot;Add Driver&quot; at the top to enroll a new driver.
              </p>
            </div>
          }
        />
      </div>
    </div>
  );
}
