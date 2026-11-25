"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Truck,
  Navigation,
  Search,
  Compass,
  ArrowRight,
  Layers,
  Ship,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/page-layout";
import { RouteTrackerMap } from "./route-tracker-map";
import { DispatchDialog } from "./dispatch-dialog";
import type { DispatchTrip, Vehicle, Driver } from "@/lib/contracts";
import {
  fetchFleetTracking,
  fetchVehicles,
  fetchDrivers,
  updateDispatch,
} from "./fleet-api";
import { getMilestoneInfo, MILESTONE_SEQUENCE, resolveLocation } from "@/lib/geo-routing";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const MILESTONE_FILTERS: { id: string; label: string; dotColor?: string }[] = [
  { id: "all", label: "All Statuses" },
  { id: "in_transit", label: "In Transit", dotColor: "bg-sky-500" },
  { id: "at_factory", label: "At Factory", dotColor: "bg-amber-500" },
  { id: "gate_out", label: "Gate-Out", dotColor: "bg-indigo-500" },
  { id: "dispatched", label: "Dispatched", dotColor: "bg-slate-400" },
  { id: "empty_returned", label: "Completed", dotColor: "bg-emerald-500" },
];

export function FleetMonitorView() {
  const [trips, setTrips] = useState<DispatchTrip[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [search, setSearch] = useState("");
  const [milestoneFilter, setMilestoneFilter] = useState("all");
  const [haulierFilter, setHaulierFilter] = useState("all");
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<"fleet" | "single">("fleet");
  const [loading, setLoading] = useState(true);
  const [updatingTripId, setUpdatingTripId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [tList, vList, dList] = await Promise.all([
        fetchFleetTracking(),
        fetchVehicles(),
        fetchDrivers(),
      ]);
      setTrips(tList);
      setVehicles(vList);
      setDrivers(dList);
    } catch (err) {
      console.error("Failed to load fleet data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  // Lookup vehicle for haulier type (in_house vs subcontractor)
  const vehicleMap = useMemo(() => {
    const map = new Map<string, Vehicle>();
    vehicles.forEach((v) => {
      map.set(v.plate_number.toLowerCase().replace(/\s+/g, ""), v);
    });
    return map;
  }, [vehicles]);

  const getHaulierInfo = useCallback(
    (truckPlate: string) => {
      const key = truckPlate.toLowerCase().replace(/\s+/g, "");
      const v = vehicleMap.get(key);
      if (!v) {
        return {
          type: "in_house" as const,
          label: "IN-HOUSE",
          haulierName: "Harborway Fleet",
        };
      }
      return {
        type: v.haulier_type,
        label: v.haulier_type === "in_house" ? "IN-HOUSE" : "3PL HAULIER",
        haulierName: v.haulier_name || (v.haulier_type === "in_house" ? "Harborway Fleet" : "3PL Haulier"),
      };
    },
    [vehicleMap]
  );

  // Filtered trips list
  const filteredTrips = useMemo(() => {
    return trips.filter((t) => {
      // 1. Search term
      if (search.trim()) {
        const query = search.toLowerCase();
        const matchesQuery =
          t.trip_number.toLowerCase().includes(query) ||
          t.truck_plate.toLowerCase().includes(query) ||
          t.container_no.toLowerCase().includes(query) ||
          t.shipment_ref.toLowerCase().includes(query) ||
          t.company_name.toLowerCase().includes(query) ||
          t.destination.toLowerCase().includes(query) ||
          t.driver_name.toLowerCase().includes(query);
        if (!matchesQuery) return false;
      }

      // 2. Milestone filter
      if (milestoneFilter !== "all" && t.milestone !== milestoneFilter) {
        return false;
      }

      // 3. Haulier filter
      if (haulierFilter !== "all") {
        const haulier = getHaulierInfo(t.truck_plate);
        if (haulierFilter === "in_house" && haulier.type !== "in_house") return false;
        if (haulierFilter === "subcontractor" && haulier.type !== "subcontractor") return false;
      }

      return true;
    });
  }, [trips, search, milestoneFilter, haulierFilter, getHaulierInfo]);

  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return trips.find((t) => t.id === selectedTripId) || null;
  }, [trips, selectedTripId]);

  const handleSelectTrip = useCallback((trip: DispatchTrip | null) => {
    if (!trip) {
      setSelectedTripId(null);
      setMapMode("fleet");
      return;
    }
    setSelectedTripId(trip.id);
    setMapMode("single");
  }, []);

  const handleMilestoneUpdate = useCallback(
    async (tripId: string, nextMilestone: DispatchTrip["milestone"]) => {
      setUpdatingTripId(tripId);
      try {
        await updateDispatch(tripId, { milestone: nextMilestone });
        await refresh();
        toast.saved(`Trip status updated to ${nextMilestone.replace("_", " ")}`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to update milestone");
      } finally {
        setUpdatingTripId(null);
      }
    },
    [refresh]
  );

  // Statistics
  const stats = useMemo(() => {
    const total = trips.length;
    const inTransit = trips.filter((t) => t.milestone === "in_transit").length;
    const atFactory = trips.filter((t) => t.milestone === "at_factory").length;
    const gateOut = trips.filter((t) => t.milestone === "gate_out").length;
    return { total, inTransit, atFactory, gateOut };
  }, [trips]);

  return (
    <div className="space-y-3">
      {/* 1. Header with Stats & Actions */}
      <PageHeading
        title="Fleet Radar · Live Operations"
        description="Real-time multi-shipment dispatch monitor and delivery tracking across Cambodia."
        action={
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
              <Button
                size="xs"
                variant={mapMode === "fleet" ? "secondary" : "ghost"}
                onClick={() => {
                  setMapMode("fleet");
                  setSelectedTripId(null);
                }}
                className="gap-1.5 h-7 px-2.5 text-xs font-medium"
              >
                <Compass className="h-3.5 w-3.5 text-primary" /> Full Fleet ({trips.length})
              </Button>
              <Button
                size="xs"
                variant={mapMode === "single" ? "secondary" : "ghost"}
                disabled={!selectedTrip && trips.length === 0}
                onClick={() => {
                  setMapMode("single");
                  if (!selectedTripId && trips.length > 0) {
                    setSelectedTripId(trips[0].id);
                  }
                }}
                className="gap-1.5 h-7 px-2.5 text-xs font-medium"
              >
                <Navigation className="h-3.5 w-3.5 text-sky-600" /> Single Shipment
              </Button>
            </div>
            <DispatchDialog vehicles={vehicles} drivers={drivers} onSaved={refresh} />
          </div>
        }
      />

      {/* 2. Main Two-Column Layout: Left Shipments List, Big Right Map */}
      <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-3 h-[calc(100vh-170px)] min-h-[640px]">
        {/* LEFT COLUMN: Shipments List Panel */}
        <div className="flex flex-col rounded-xl border border-border bg-card overflow-hidden shadow-xs">
          {/* List Search & Quick Filter Controls */}
          <div className="p-3 border-b border-border/80 space-y-2.5 bg-muted/20 shrink-0">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search trip #, plate, container, client..."
                className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Status Filter Chips */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
              {MILESTONE_FILTERS.map((f) => {
                const active = milestoneFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setMilestoneFilter(f.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors border",
                      active
                        ? "border-primary bg-primary text-primary-foreground font-semibold"
                        : "border-border/70 bg-background text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {f.dotColor && (
                      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-white" : f.dotColor)} />
                    )}
                    {f.label}
                  </button>
                );
              })}
            </div>

            {/* Haulier Type Selector */}
            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/60">
              <span className="text-muted-foreground font-medium flex items-center gap-1">
                <Layers className="h-3 w-3" /> Haulier
              </span>
              <div className="flex items-center gap-1">
                {[
                  { id: "all", label: "All" },
                  { id: "in_house", label: "In-House" },
                  { id: "subcontractor", label: "3PL Haulier" },
                ].map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setHaulierFilter(h.id)}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                      haulierFilter === h.id
                        ? "bg-foreground text-background font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* List Header Count */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 border-b border-border/60 text-[11px] text-muted-foreground font-medium shrink-0">
            <span>Active Shipments ({filteredTrips.length})</span>
            {selectedTrip && (
              <button
                type="button"
                onClick={() => handleSelectTrip(null)}
                className="text-primary hover:underline text-[10px] font-semibold"
              >
                Reset to Full Fleet
              </button>
            )}
          </div>

          {/* Scrollable Shipment Cards */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {loading ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                Loading live fleet radar...
              </div>
            ) : filteredTrips.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground space-y-1">
                <Truck className="h-6 w-6 mx-auto text-muted-foreground/60" />
                <p className="font-medium text-foreground">No shipments match your filters</p>
                <p className="text-[11px]">Try clearing search or milestone filters.</p>
              </div>
            ) : (
              filteredTrips.map((t) => {
                const isSelected = selectedTripId === t.id;
                const haulier = getHaulierInfo(t.truck_plate);
                const milestone = getMilestoneInfo(t.milestone);

                return (
                  <div
                    key={t.id}
                    onClick={() => handleSelectTrip(t)}
                    className={cn(
                      "cursor-pointer rounded-lg border p-3 text-xs transition-all space-y-2 select-none",
                      isSelected
                        ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary/30"
                        : "border-border hover:border-border/80 hover:bg-muted/40"
                    )}
                  >
                    {/* Top Row: Trip #, Plate, Haulier Tag */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono font-bold text-foreground truncate">
                          {t.trip_number}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-sky-700 dark:text-sky-400">
                          {t.truck_plate}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider shrink-0",
                          haulier.type === "in_house"
                            ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700"
                            : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700"
                        )}
                      >
                        {haulier.label}
                      </span>
                    </div>

                    {/* Middle Row: Customer, Shipment Ref & Container */}
                    <div className="space-y-0.5">
                      <div className="font-medium text-foreground truncate">{t.company_name}</div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>Ref: <span className="font-mono text-foreground">{t.shipment_ref}</span></span>
                        <span>·</span>
                        <span>Cont: <span className="font-mono text-foreground">{t.container_no}</span></span>
                      </div>
                    </div>

                    {/* Maritime Vessel Badge (if overseas sea shipment) */}
                    {t.vessel && (
                      <div className="flex items-center gap-1.5 text-[10px] text-teal-800 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 rounded px-2 py-0.5 font-mono">
                        <Ship className="h-3 w-3 text-teal-600 shrink-0" />
                        <span className="font-semibold truncate">{t.vessel.name}</span>
                        {t.vessel.voyage && <span className="text-teal-600">· {t.vessel.voyage}</span>}
                        <span className="ml-auto text-[9px] text-teal-600 font-sans">
                          {t.vessel.speed_knots} kts ({t.vessel.progress_pct}%)
                        </span>
                      </div>
                    )}

                    {/* Bottom Row: Origin ➔ Destination */}
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground pt-1 border-t border-border/60">
                      <span className="truncate max-w-[150px]">{t.origin.split(" ")[0]}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                      <span className="truncate font-medium text-foreground">{t.destination}</span>
                    </div>

                    {/* Footer: Driver & Milestone Status Badge */}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-muted-foreground truncate">
                        {t.driver_name} ({t.driver_phone})
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide shrink-0",
                          t.milestone === "in_transit" && "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
                          t.milestone === "at_factory" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
                          t.milestone === "empty_returned" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
                          (t.milestone === "dispatched" || t.milestone === "gate_out") && "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            t.milestone === "in_transit" && "bg-sky-500",
                            t.milestone === "at_factory" && "bg-amber-500",
                            t.milestone === "empty_returned" && "bg-emerald-500",
                            (t.milestone === "dispatched" || t.milestone === "gate_out") && "bg-slate-400"
                          )}
                        />
                        {milestone.label}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* BIG RIGHT COLUMN: Full Map Display */}
        <div className="relative flex-1 rounded-xl border border-border bg-card overflow-hidden shadow-xs">
          {/* Floating Top Bar on Map */}
          <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
            {/* Status Information Pill */}
            <div className="pointer-events-auto rounded-lg border border-border/80 bg-background/95 px-3 py-1.5 backdrop-blur shadow-sm flex items-center gap-2 text-xs">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              {selectedTrip ? (
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">
                    Shipment Focus: <span className="font-mono font-bold">{selectedTrip.trip_number}</span> · {selectedTrip.truck_plate}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSelectTrip(null)}
                    className="ml-2 rounded px-1.5 py-0.5 text-[10px] bg-muted hover:bg-muted/80 text-foreground font-semibold"
                  >
                    View All Fleet
                  </button>
                </div>
              ) : (
                <span className="font-medium text-foreground">
                  Full Fleet Mode: <b>{filteredTrips.length}</b> trucks active across Cambodia
                </span>
              )}
            </div>

            {/* Quick Haulier Indicator */}
            <div className="pointer-events-auto hidden md:flex items-center gap-2 rounded-lg border border-border/80 bg-background/95 px-3 py-1.5 backdrop-blur shadow-sm text-[11px] text-muted-foreground">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky-500" /> In Transit ({stats.inTransit})
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 ml-1" /> At Factory ({stats.atFactory})
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-400 ml-1" /> Port / Gate ({stats.gateOut})
            </div>
          </div>

          {/* The Full Interactive Leaflet Map */}
          <RouteTrackerMap
            trip={selectedTrip}
            trips={filteredTrips}
            selectedTripId={selectedTrip?.id}
            onSelectTrip={handleSelectTrip}
            onUpdateMilestone={handleMilestoneUpdate}
            mode={mapMode}
            height="100%"
            className="h-full w-full rounded-none border-0"
            showOverseasLeg={Boolean(selectedTrip?.vessel)}
            overseasOrigin={selectedTrip?.vessel?.origin_port || null}
            hideControls={true}
          />

          {/* Floating Focused Shipment Detail Card (Bottom-Left Overlay) */}
          {selectedTrip && (
            <div className="absolute bottom-4 left-4 right-4 sm:right-auto sm:max-w-md z-[1000] rounded-xl border border-border bg-background/95 p-4 backdrop-blur shadow-xl space-y-3">
              {/* Trip Header */}
              <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Truck className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-mono text-xs font-bold text-foreground">
                      {selectedTrip.trip_number} · {selectedTrip.truck_plate}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {selectedTrip.company_name} · Cont: {selectedTrip.container_no}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleSelectTrip(null)}
                  className="text-xs text-muted-foreground hover:text-foreground font-medium"
                >
                  Close
                </button>
              </div>

              {/* Driver & Route Info */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-medium block">
                    Driver
                  </span>
                  <p className="font-medium text-foreground truncate">{selectedTrip.driver_name}</p>
                  <p className="text-[11px] font-mono text-muted-foreground">{selectedTrip.driver_phone}</p>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase font-medium block">
                    Destination
                  </span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="font-medium text-foreground truncate">{selectedTrip.destination}</p>
                    {(selectedTrip.destination_point?.maps_url ||
                      resolveLocation(selectedTrip.destination, "destination").mapsUrl) && (
                      <a
                        href={
                          selectedTrip.destination_point?.maps_url ||
                          resolveLocation(selectedTrip.destination, "destination").mapsUrl
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-primary hover:underline shrink-0"
                      >
                        Maps
                      </a>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground font-mono">ETA: {selectedTrip.eta || "In Transit"}</p>
                </div>
              </div>

              {/* 1-Click Milestone Progression Stepper */}
              <div className="space-y-1.5 pt-1 border-t border-border/60">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground font-medium">Update Status</span>
                  <span className="font-mono text-xs font-bold text-primary capitalize">
                    {getMilestoneInfo(selectedTrip.milestone).label} ({getMilestoneInfo(selectedTrip.milestone).percentage}%)
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {MILESTONE_SEQUENCE.map((ms, idx) => {
                    const isCurrent = selectedTrip.milestone === ms.key;
                    const isDone =
                      MILESTONE_SEQUENCE.findIndex((m) => m.key === selectedTrip.milestone) >= idx;

                    return (
                      <button
                        key={ms.key}
                        type="button"
                        disabled={updatingTripId === selectedTrip.id}
                        onClick={() => handleMilestoneUpdate(selectedTrip.id, ms.key)}
                        className={cn(
                          "flex flex-col items-center justify-center rounded p-1 text-[10px] transition-all border",
                          isCurrent
                            ? "border-primary bg-primary text-primary-foreground font-semibold shadow-xs"
                            : isDone
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted"
                        )}
                        title={`Advance to ${ms.label}`}
                      >
                        <span className="truncate">{ms.label.split(" ")[0]}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Click any stage above to advance delivery checkpoint.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
