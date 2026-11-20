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
  Search,
  Box,
  Trash2,
  Lock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { PageHeading, Section } from "@/components/ui/page-layout";
import { ResizableTable, type ResizableColumn } from "@/components/ui/resizable-table";
import { DispatchDialog } from "./dispatch-dialog";
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

  const handleMilestoneChange = async (
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
  };

  const handleDelete = async (id: string, tripNo: string) => {
    if (confirm(`Remove trip ${tripNo} from the records?`)) {
      try {
        await removeDispatch(id);
        await refresh();
        toast.saved(`Removed trip ${tripNo}`);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to delete trip");
      }
    }
  };

  // Strictly single-line per cell!
  const columns: ResizableColumn<DispatchTrip>[] = [
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
    // Milestone status (inline selector)
    {
      id: "milestone",
      header: "Milestone",
      defaultWidth: 150,
      minWidth: 120,
      cell: (t) => {
        return (
          <NativeSelect
            value={t.milestone}
            onChange={(e) =>
              void handleMilestoneChange(
                t.id,
                e.target.value as DispatchTrip["milestone"]
              )
            }
            className="h-7 text-[11px] font-medium bg-background"
          >
            {MILESTONES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
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
      defaultWidth: 80,
      minWidth: 70,
      align: "right",
      cell: (t) => (
        <div className="flex items-center justify-end gap-1">
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
  ];

  return (
    <div className="space-y-4">
      {/* 1. Header with New Dispatch at Top */}
      <PageHeading
        title="Active Dispatch Trips"
        description="Monitor live cargo movements, gate checkpoints, and empty container returns."
        action={
          <DispatchDialog
            vehicles={vehicles}
            drivers={drivers}
            onSaved={refresh}
          />
        }
      />

      {/* 2. The 4 KPI Cards Above the Table */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Active Trips</span>
            <Navigation size={16} />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-foreground">
            {stats.total}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-sky-600 dark:text-sky-400">
            <span className="text-xs font-medium">In Transit (Highway)</span>
            <Clock size={16} />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-sky-600 dark:text-sky-400">
            {stats.inTransit}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-purple-600 dark:text-purple-400">
            <span className="text-xs font-medium">At Factory</span>
            <Box size={16} />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-purple-600 dark:text-purple-400">
            {stats.atFactory}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span className="text-xs font-medium">Empty Returned (Done)</span>
            <CheckCircle2 size={16} />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.completed}
          </div>
        </div>
      </div>

      {/* 3. Main Table Section - Direct Edge-to-Edge Table (No double container wrap) */}
      <Section title="Live Dispatch Movements">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 sm:max-w-xl">
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search trip #, shipment, container, seal, driver…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs bg-background"
              />
            </div>
            <NativeSelect
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value)}
              className="h-8 text-xs w-32 bg-background"
            >
              <option value="all">All directions</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </NativeSelect>
            <NativeSelect
              value={milestoneFilter}
              onChange={(e) => setMilestoneFilter(e.target.value)}
              className="h-8 text-xs w-36 bg-background"
            >
              <option value="all">All milestones</option>
              <option value="dispatched">Dispatched</option>
              <option value="gate_out">Port Gate-Out</option>
              <option value="in_transit">In Transit</option>
              <option value="at_factory">At Factory</option>
              <option value="empty_returned">Empty Returned</option>
            </NativeSelect>
          </div>
        </div>

        {/* Resizable Table sits DIRECTLY in Section (flush edge-to-edge) */}
        <ResizableTable
          columns={columns}
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
      </Section>
    </div>
  );
}
