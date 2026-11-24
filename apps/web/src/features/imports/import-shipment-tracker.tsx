"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Truck,
  Anchor,
  Building2,
  ExternalLink,
  Compass,
  Navigation,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/page-layout";
import { RouteTrackerMap } from "@/features/fleet/route-tracker-map";
import { fetchDispatches, updateDispatch, createDispatch } from "@/features/fleet/fleet-api";
import type { DispatchTrip } from "@/lib/contracts";
import { resolveLocation, getMilestoneInfo } from "@/lib/geo-routing";
import { toast } from "@/lib/toast";

export interface ImportShipmentTrackerProps {
  invoiceNo: string;
  company: string;
  supplier?: string | null;
  consignee?: string | null;
  eta?: string | null;
  isApproved?: boolean;
}

export function ImportShipmentTracker({
  invoiceNo,
  company,
  supplier,
  consignee,
  eta,
}: ImportShipmentTrackerProps) {
  const [trips, setTrips] = useState<DispatchTrip[]>([]);
  const [showSeaLeg, setShowSeaLeg] = useState(true);
  const [creatingTrip, setCreatingTrip] = useState(false);

  const loadTrip = useCallback(async () => {
    try {
      const data = await fetchDispatches({ q: invoiceNo });
      setTrips(data);
    } catch (err) {
      console.error("Failed to load dispatch trip for import:", err);
    }
  }, [invoiceNo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTrip();
  }, [loadTrip]);

  const activeTrip = trips.length > 0 ? trips[0] : null;

  // Resolve estimated ports & destinations
  const originPort = useMemo(() => resolveLocation(supplier || "Ningbo Port", "origin"), [supplier]);
  const destFactory = useMemo(
    () => resolveLocation(consignee || company || "Phnom Penh SEZ", "destination"),
    [consignee, company]
  );

  // If no trip exists in database yet, create a synthetic proposed trip for visualization
  const displayTrip: DispatchTrip = useMemo(() => {
    if (activeTrip) return activeTrip;
    return {
      id: "predicted-preview",
      trip_number: `PRED-${invoiceNo.slice(-6)}`,
      shipment_ref: invoiceNo,
      company_name: company || consignee || "Customer Factory",
      direction: "inbound",
      truck_plate: "Pending Assignment",
      driver_name: "Dispatcher Team",
      driver_phone: "—",
      container_no: "Assigned at Gate-Out",
      seal_no: "—",
      origin: "Sihanoukville Autonomous Port (PAS)",
      destination: destFactory.label,
      milestone: "dispatched",
      eta: eta || "Pending Arrival",
      notes: "Predicted delivery corridor from port of discharge to consignee warehouse.",
    };
  }, [activeTrip, invoiceNo, company, consignee, destFactory, eta]);

  const handleMilestoneUpdate = async (tripId: string, nextMilestone: DispatchTrip["milestone"]) => {
    if (!activeTrip) {
      toast.error("Create or assign a dispatch truck first before updating delivery milestones.");
      return;
    }
    try {
      await updateDispatch(tripId, { milestone: nextMilestone });
      await loadTrip();
      toast.saved(`Delivery status updated to ${nextMilestone.replace("_", " ")}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update trip milestone");
    }
  };

  const handleQuickDispatch = async () => {
    setCreatingTrip(true);
    try {
      const newTrip = await createDispatch({
        trip_number: `TRP-${Date.now().toString().slice(-6)}`,
        shipment_ref: invoiceNo,
        company_name: company || "Harborway Client",
        direction: "inbound",
        truck_plate: "3A-7890 PP",
        driver_name: "Sokha Heng",
        driver_phone: "+855 12 889 900",
        container_no: "WHLU9283741",
        seal_no: "SL-49201",
        origin: "Sihanoukville Autonomous Port (PAS)",
        destination: destFactory.label,
        milestone: "dispatched",
        eta: eta || "Today 16:30",
        notes: `Inbound delivery for invoice ${invoiceNo}`,
      });
      await loadTrip();
      toast.saved(`Dispatch created: Trip ${newTrip.trip_number} assigned to truck ${newTrip.truck_plate}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create quick dispatch");
    } finally {
      setCreatingTrip(false);
    }
  };

  return (
    <Section
      title="Shipment & Inland Delivery Tracking"
      action={
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setShowSeaLeg((prev) => !prev)}
            className="text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            <Compass className="h-3.5 w-3.5 text-primary" />
            {showSeaLeg ? "Hide Sea Route" : "Show Sea Route"}
          </Button>
          <Button asChild size="xs" variant="outline">
            <Link href="/fleet/dispatches">
              Fleet Dispatches <ExternalLink className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
      }
    >
      <div className="space-y-3 p-3 bg-card border-b border-border/80">
        {/* Route Summary Pills */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <Anchor className="h-4 w-4 text-teal-600 shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] text-muted-foreground uppercase font-medium block">
                Loading Port (Sea Origin)
              </span>
              <p className="font-semibold text-foreground truncate">{originPort.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <Navigation className="h-4 w-4 text-blue-600 shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] text-muted-foreground uppercase font-medium block">
                Discharge Port (Gate-Out)
              </span>
              <p className="font-semibold text-foreground truncate">Sihanoukville Port (PAS)</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <Building2 className="h-4 w-4 text-rose-600 shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] text-muted-foreground uppercase font-medium block">
                Final Delivery Consignee
              </span>
              <p className="font-semibold text-foreground truncate">{destFactory.label}</p>
            </div>
          </div>
        </div>

        {/* Live Truck Status or Dispatch Trigger */}
        {!activeTrip ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/40 p-3 text-xs">
            <div className="space-y-0.5">
              <p className="font-medium text-sky-900 dark:text-sky-200">
                Predicted Port-to-Door Delivery Route
              </p>
              <p className="text-sky-700 dark:text-sky-400 text-[11px]">
                No delivery truck is linked to invoice <span className="font-mono">{invoiceNo}</span> yet.
                Showing predicted delivery highway path below.
              </p>
            </div>
            <Button
              size="sm"
              onClick={handleQuickDispatch}
              disabled={creatingTrip}
              className="gap-1.5 shadow-xs"
            >
              <Truck className="h-3.5 w-3.5" />
              {creatingTrip ? "Assigning Truck…" : "Dispatch Delivery Truck"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Truck className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-foreground">{activeTrip.trip_number}</span>
                  <span className="font-mono text-sky-700 dark:text-sky-400 font-semibold">
                    {activeTrip.truck_plate}
                  </span>
                  <span className="capitalize px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-semibold">
                    {getMilestoneInfo(activeTrip.milestone).label}
                  </span>
                </div>
                <p className="text-muted-foreground text-[11px] mt-0.5">
                  Driver: <b>{activeTrip.driver_name}</b> ({activeTrip.driver_phone}) · Container:{" "}
                  <b className="font-mono">{activeTrip.container_no}</b>
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-muted-foreground uppercase font-medium">Estimated Arrival</span>
              <p className="font-mono font-medium text-foreground">{activeTrip.eta || eta || "In Transit"}</p>
            </div>
          </div>
        )}

        {/* The Interactive Map */}
        <RouteTrackerMap
          trip={displayTrip}
          onUpdateMilestone={activeTrip ? handleMilestoneUpdate : undefined}
          height="420px"
          overseasOrigin={supplier || "Ningbo"}
          showOverseasLeg={showSeaLeg}
        />
      </div>
    </Section>
  );
}
