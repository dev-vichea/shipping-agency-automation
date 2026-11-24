"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Navigation,
  CheckCircle2,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Phone,
  Box,
  Trash2,
  Lock,
  ChevronDown,
  Check,
  Map,
  LayoutList,
  Columns2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { PageHeading } from "@/components/ui/page-layout";
import { FleetStatGrid, type FleetStatItem } from "./fleet-stat-grid";
import { FleetFilterBar, type FilterCategoryGroup } from "./fleet-filter-bar";
import { ResizableTable, type ResizableColumn } from "@/components/ui/resizable-table";
import { DispatchDialog } from "./dispatch-dialog";
import { RouteTrackerMap } from "./route-tracker-map";
import type { DispatchTrip, Vehicle, Driver } from "@/lib/contracts";
import {
  fetchDispatches,
  updateDispatch,
  removeDispatch,
  fetchVehicles,
  fetchDrivers,
} from "@/features/fleet/fleet-api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const MILESTONES: { id: DispatchTrip["milestone"]; label: string }[] = [
  { id: "dispatched", label: "Dispatched" },
  { id: "gate_out", label: "Port Gate-Out" },
  { id: "in_transit", label: "In Transit" },
  { id: "at_factory", label: "At Factory" },
  { id: "empty_returned", label: "Empty Returned" },
];

export function FleetDispatchesView() {
  const [trips, setTrips] = useState<DispatchTrip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [search, setSearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState<string>("all");
  const [milestoneFilter, setMilestoneFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"table" | "map" | "split">("table");
  const [selectedTrip, setSelectedTrip] = useState<DispatchTrip | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [tList, vList, dList] = await Promise.all([
        fetchDispatches({
          q: search,
          direction: directionFilter,
          milestone: milestoneFilter,
        }),
        fetchVehicles(),
        fetchDrivers(),
      ]);
      setTrips(tList);
      setVehicles(vList);
      setDrivers(dList);
      setSelectedTrip((prev) => {
        if (!prev) return tList.length > 0 ? tList[0] : null;
        return tList.find((t) => t.id === prev.id) || (tList.length > 0 ? tList[0] : null);
      });
    } catch (err) {
      console.error("Failed to load dispatches from API:", err);
    } finally {
      setLoading(false);
    }
  }, [search, directionFilter, milestoneFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const total = trips.length;
    const inTransit = trips.filter((t) => t.milestone === "in_transit").length;
    const atFactory = trips.filter((t) => t.milestone === "at_factory").length;
    const completed = trips.filter((t) => t.milestone === "empty_returned").length;
    return { total, inTransit, atFactory, completed };
  }, [trips]);

  const directionStats = useMemo(() => {
    const inbound = trips.filter((t) => t.direction === "inbound").length;
    const outbound = trips.filter((t) => t.direction === "outbound").length;
    return { inbound, outbound };
  }, [trips]);

  const milestoneCounts = useMemo(() => {
    const dispatched = trips.filter((t) => t.milestone === "dispatched").length;
    const gateOut = trips.filter((t) => t.milestone === "gate_out").length;
    return { dispatched, gateOut };
  }, [trips]);

  const statItems: FleetStatItem[] = useMemo(
    () => [
      {
        id: "total",
        label: "Active Trips",
        value: stats.total,
        icon: Navigation,
        active: milestoneFilter === "all",
        onClick: () => setMilestoneFilter("all"),
      },
      {
        id: "in_transit",
        label: "In Transit (Highway)",
        value: stats.inTransit,
        icon: Clock,
        iconColor: "text-sky-500",
        active: milestoneFilter === "in_transit",
        onClick: () => setMilestoneFilter(milestoneFilter === "in_transit" ? "all" : "in_transit"),
      },
      {
        id: "at_factory",
        label: "At Factory",
        value: stats.atFactory,
        icon: Box,
        iconColor: "text-amber-500",
        active: milestoneFilter === "at_factory",
        onClick: () => setMilestoneFilter(milestoneFilter === "at_factory" ? "all" : "at_factory"),
      },
      {
        id: "empty_returned",
        label: "Empty Returned (Done)",
        value: stats.completed,
        icon: CheckCircle2,
        iconColor: "text-emerald-500",
        active: milestoneFilter === "empty_returned",
        onClick: () => setMilestoneFilter(milestoneFilter === "empty_returned" ? "all" : "empty_returned"),
      },
    ],
    [stats, milestoneFilter]
  );

  const categories: FilterCategoryGroup[] = useMemo(
    () => [
      {
        id: "direction",
        label: "Direction",
        value: directionFilter,
        onToggle: (val) => setDirectionFilter(directionFilter === val ? "all" : val),
        options: [
          { value: "all", label: "All Directions", count: stats.total },
          { value: "inbound", label: "Inbound", count: directionStats.inbound, icon: ArrowDownLeft },
          { value: "outbound", label: "Outbound", count: directionStats.outbound, icon: ArrowUpRight },
        ],
      },
      {
        id: "milestone",
        label: "Milestone",
        value: milestoneFilter,
        onToggle: (val) => setMilestoneFilter(milestoneFilter === val ? "all" : val),
        options: [
          { value: "all", label: "All Milestones", count: stats.total },
          { value: "dispatched", label: "Dispatched", count: milestoneCounts.dispatched },
          { value: "gate_out", label: "Port Gate-Out", count: milestoneCounts.gateOut },
          { value: "in_transit", label: "In Transit", count: stats.inTransit, dotColor: "bg-sky-500" },
          { value: "at_factory", label: "At Factory", count: stats.atFactory, dotColor: "bg-amber-500" },
          { value: "empty_returned", label: "Empty Returned", count: stats.completed, dotColor: "bg-emerald-500" },
        ],
      },
    ],
    [directionFilter, milestoneFilter, stats, directionStats, milestoneCounts]
  );

  const handleReset = () => {
    setSearch("");
    setDirectionFilter("all");
    setMilestoneFilter("all");
  };

  const hasActiveFilters = Boolean(search || directionFilter !== "all" || milestoneFilter !== "all");

  const handleMilestoneChange = useCallback(
    async (
      tripId: string,
      nextMilestone: DispatchTrip["milestone"]
    ) => {
      try {
        await updateDispatch(tripId, { milestone: nextMilestone });
        await refresh();
        toast.saved(`Trip status updated to ${nextMilestone.replace("_", " ")}`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update milestone");
      }
    },
    [refresh]
  );

  const handleDelete = useCallback(
    async (id: string, tripNo: string) => {
      if (confirm(`Remove trip ${tripNo} from the records?`)) {
        try {
          await removeDispatch(id);
          await refresh();
          toast.saved(`Removed trip ${tripNo}`);
        } catch (err: unknown) {
          toast.error(err instanceof Error ? err.message : "Failed to delete trip");
        }
      }
    },
    [refresh]
  );

  // Strictly single-line per cell!
  const columns: ResizableColumn<DispatchTrip>[] = useMemo(
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
      id: "trip_no",
      header: "Trip #",
      defaultWidth: 140,
      minWidth: 110,
      cell: (t) => (
        <span className="font-mono text-code-tabular font-medium text-foreground text-xs whitespace-nowrap">
          {t.trip_number}
        </span>
      ),
    },
    // SPLIT: Shipment Ref (1 line)
    {
      id: "shipment",
      header: "Shipment Ref",
      defaultWidth: 130,
      minWidth: 100,
      cell: (t) => (
        <Link
          href="/imports"
          className="font-mono font-medium text-primary hover:underline text-xs whitespace-nowrap"
        >
          {t.shipment_ref}
        </Link>
      ),
    },
    // SPLIT: Client / Consignee (1 line)
    {
      id: "company",
      header: "Customer",
      defaultWidth: 140,
      minWidth: 110,
      cell: (t) => (
        <span className="font-medium text-foreground text-xs truncate block whitespace-nowrap">
          {t.company_name}
        </span>
      ),
    },
    {
      id: "direction",
      header: "Direction",
      defaultWidth: 110,
      minWidth: 90,
      align: "center",
      cell: (t) => {
        const isInbound = t.direction === "inbound";
        return (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border whitespace-nowrap",
              isInbound
                ? "bg-sky-50 text-sky-800 border-sky-300/40 dark:bg-sky-950/50 dark:text-sky-300"
                : "bg-amber-50 text-amber-800 border-amber-300/40 dark:bg-amber-950/50 dark:text-amber-300"
            )}
          >
            {isInbound ? <ArrowDownLeft size={11} /> : <ArrowUpRight size={11} />}
            <span>{isInbound ? "Inbound" : "Outbound"}</span>
          </span>
        );
      },
    },
    // SPLIT: Container No (1 line)
    {
      id: "container",
      header: "Container No",
      defaultWidth: 150,
      minWidth: 120,
      cell: (t) => (
        <div className="flex items-center gap-1.5 font-mono text-foreground font-semibold text-xs whitespace-nowrap">
          <Box size={13} className="text-primary shrink-0" />
          <span>{t.container_no}</span>
        </div>
      ),
    },
    // SPLIT: Seal No (1 line)
    {
      id: "seal",
      header: "Seal No",
      defaultWidth: 130,
      minWidth: 100,
      cell: (t) => (
        <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground whitespace-nowrap">
          <Lock size={11} className="text-muted-foreground/70 shrink-0" />
          <span>{t.seal_no}</span>
        </div>
      ),
    },
    {
      id: "truck",
      header: "Truck Plate",
      defaultWidth: 160,
      minWidth: 120,
      cell: (t) => (
        <span className="font-mono text-code-tabular font-medium text-foreground text-xs whitespace-nowrap">
          {t.truck_plate}
        </span>
      ),
    },
    // SPLIT: Driver Name (1 line)
    {
      id: "driver_name",
      header: "Driver",
      defaultWidth: 130,
      minWidth: 100,
      cell: (t) => (
        <span className="font-medium text-foreground text-xs whitespace-nowrap truncate block">
          {t.driver_name}
        </span>
      ),
    },
    // SPLIT: Driver Phone (1 line)
    {
      id: "driver_phone",
      header: "Driver Phone",
      defaultWidth: 130,
      minWidth: 100,
      cell: (t) => (
        <a
          href={`tel:${t.driver_phone.replace(/\s+/g, "")}`}
          className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary hover:underline whitespace-nowrap"
        >
          <Phone size={11} className="shrink-0" />
          <span>{t.driver_phone}</span>
        </a>
      ),
    },
    // SPLIT: Origin (1 line)
    {
      id: "origin",
      header: "Origin",
      defaultWidth: 180,
      minWidth: 130,
      cell: (t) => (
        <span className="text-xs text-muted-foreground truncate block whitespace-nowrap">
          {t.origin}
        </span>
      ),
    },
    // SPLIT: Destination (1 line)
    {
      id: "destination",
      header: "Destination",
      defaultWidth: 200,
      minWidth: 140,
      cell: (t) => (
        <span className="text-xs font-medium text-foreground truncate block whitespace-nowrap">
          {t.destination}
        </span>
      ),
    },
    // Milestone status (inline modern selector)
    {
      id: "milestone",
      header: "Milestone",
      defaultWidth: 150,
      minWidth: 120,
      cell: (t) => {
        const currentMilestone = MILESTONES.find((m) => m.id === t.milestone);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px] font-medium border bg-background hover:bg-muted/60 transition-colors cursor-pointer"
              >
                <span>{currentMilestone?.label ?? t.milestone}</span>
                <ChevronDown size={11} className="opacity-60 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-36 p-1">
              {MILESTONES.map((m) => {
                const isSelected = m.id === t.milestone;
                return (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={() =>
                      void handleMilestoneChange(
                        t.id,
                        m.id as DispatchTrip["milestone"]
                      )
                    }
                    className={cn(
                      "flex items-center justify-between text-xs px-2.5 py-1.5 cursor-pointer rounded-md transition-colors",
                      isSelected
                        ? "bg-accent/60 font-semibold text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span>{m.label}</span>
                    {isSelected && (
                      <Check size={12} className="text-primary shrink-0 stroke-[2.5]" />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
    {
      id: "eta",
      header: "ETA / Arrival",
      defaultWidth: 120,
      minWidth: 90,
      cell: (t) => (
        <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
          {t.eta || "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      defaultWidth: 105,
      minWidth: 95,
      align: "right",
      cell: (t) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            title="Track on Live Map"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedTrip(t);
              setViewMode("map");
            }}
            className="text-muted-foreground hover:text-sky-600"
          >
            <Map size={13} aria-hidden />
          </Button>
          <DispatchDialog
            trip={t}
            vehicles={vehicles}
            drivers={drivers}
            onSaved={refresh}
          />
          <Button
            size="icon-xs"
            variant="ghost"
            title="Delete Trip"
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete(t.id, t.trip_number);
            }}
            className="text-muted-foreground hover:text-rose-600"
          >
            <Trash2 size={13} aria-hidden />
          </Button>
        </div>
      ),
    },
  ],
  [vehicles, drivers, refresh, handleDelete, handleMilestoneChange]
);

  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const columnLabels: Record<string, string> = useMemo(
    () => ({
      index: "#",
      trip_no: "Trip #",
      shipment: "Shipment Ref",
      company: "Customer",
      direction: "Direction",
      container: "Container No",
      seal_no: "Seal No",
      truck: "Truck Plate",
      trailer: "Trailer",
      driver: "Driver",
      origin: "Origin",
      destination: "Destination",
      milestone: "Milestone",
      eta: "ETA / Arrival",
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
      {/* 1. Header with View Toggle and New Dispatch */}
      <PageHeading
        title="Active Dispatch Trips"
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
              <Button
                size="xs"
                variant={viewMode === "table" ? "secondary" : "ghost"}
                onClick={() => setViewMode("table")}
                className="gap-1.5 h-7 px-2.5 text-xs font-medium"
              >
                <LayoutList className="h-3.5 w-3.5" /> Table
              </Button>
              <Button
                size="xs"
                variant={viewMode === "map" ? "secondary" : "ghost"}
                onClick={() => {
                  setViewMode("map");
                  if (!selectedTrip && trips.length > 0) setSelectedTrip(trips[0]);
                }}
                className="gap-1.5 h-7 px-2.5 text-xs font-medium"
              >
                <Map className="h-3.5 w-3.5" /> Live Map
              </Button>
              <Button
                size="xs"
                variant={viewMode === "split" ? "secondary" : "ghost"}
                onClick={() => {
                  setViewMode("split");
                  if (!selectedTrip && trips.length > 0) setSelectedTrip(trips[0]);
                }}
                className="gap-1.5 h-7 px-2.5 text-xs font-medium hidden md:flex"
              >
                <Columns2 className="h-3.5 w-3.5" /> Split
              </Button>
            </div>
            <DispatchDialog
              vehicles={vehicles}
              drivers={drivers}
              onSaved={refresh}
            />
          </div>
        }
      />

      {/* 2. Connected Grid Card (No Gap, no border accent) */}
      <FleetStatGrid items={statItems} />

      {/* 3. Search and Action controls OUTSIDE the table, NO background, NO border */}
      <FleetFilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search trip #, shipment, container, seal, driver…"
        categories={categories}
        columns={columnsOptions}
        onToggleColumn={toggleColumn}
        onReset={handleReset}
        hasActiveFilters={hasActiveFilters}
      />

      {/* 4. Display based on View Mode */}
      {viewMode === "map" && (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-3">
          <div className="panel max-h-[580px] overflow-y-auto p-2 space-y-2">
            <div className="flex items-center justify-between px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <span>Dispatches ({trips.length})</span>
              <span className="text-[11px] font-normal lowercase text-muted-foreground">click to focus</span>
            </div>
            {trips.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No active dispatches found.
              </div>
            ) : (
              trips.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTrip(t)}
                  className={cn(
                    "cursor-pointer rounded-lg border p-3 text-xs transition-colors space-y-1.5",
                    selectedTrip?.id === t.id
                      ? "border-primary bg-primary/5 shadow-xs"
                      : "border-border hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center justify-between font-mono font-medium">
                    <span className="text-foreground">{t.trip_number}</span>
                    <span className="text-sky-600 dark:text-sky-400">{t.truck_plate}</span>
                  </div>
                  <div className="text-foreground font-medium truncate">{t.company_name}</div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/60">
                    <span className="truncate max-w-[180px]">{t.destination}</span>
                    <span className="font-semibold text-primary capitalize">
                      {t.milestone.replace("_", " ")}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          <div>
            <RouteTrackerMap
              trip={selectedTrip || (trips.length > 0 ? trips[0] : null)}
              trips={trips}
              selectedTripId={selectedTrip?.id}
              onSelectTrip={setSelectedTrip}
              onUpdateMilestone={handleMilestoneChange}
              height="580px"
            />
          </div>
        </div>
      )}

      {viewMode === "split" && (
        <div className="space-y-3">
          <RouteTrackerMap
            trip={selectedTrip || (trips.length > 0 ? trips[0] : null)}
            trips={trips}
            selectedTripId={selectedTrip?.id}
            onSelectTrip={setSelectedTrip}
            onUpdateMilestone={handleMilestoneChange}
            height="420px"
          />
          <div className="panel overflow-hidden">
            <ResizableTable
              columns={visibleColumns}
              data={trips}
              storageKey="fleet_dispatches"
              rowKey={(t) => t.id}
              className="min-w-[1400px]"
              emptyState={
                <div className="py-8 text-center">
                  <Navigation size={28} className="mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm font-medium text-foreground">
                    {loading ? "Loading dispatches from database…" : "No dispatch trips found"}
                  </p>
                </div>
              }
            />
          </div>
        </div>
      )}

      {viewMode === "table" && (
        <div className="panel overflow-hidden">
          <ResizableTable
            columns={visibleColumns}
            data={trips}
            storageKey="fleet_dispatches"
            rowKey={(t) => t.id}
            className="min-w-[1400px]"
            emptyState={
              <div className="py-8 text-center">
                <Navigation size={28} className="mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium text-foreground">
                  {loading ? "Loading dispatches from database…" : "No dispatch trips found"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Click &quot;New Dispatch&quot; at the top to create a trip.
                </p>
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}
