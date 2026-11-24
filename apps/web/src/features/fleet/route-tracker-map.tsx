"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import type L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Truck,
  Anchor,
  Building2,
  Compass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DispatchTrip } from "@/lib/contracts";
import {
  resolveLocation,
  getHighwayWaypoints,
  getSeaWaypoints,
  getPositionForMilestone,
  getMilestoneInfo,
  MILESTONE_SEQUENCE,
} from "@/lib/geo-routing";
import { cn } from "@/lib/utils";

export interface RouteTrackerMapProps {
  trip?: DispatchTrip | null;
  trips?: DispatchTrip[];
  selectedTripId?: string | null;
  onSelectTrip?: (trip: DispatchTrip) => void;
  onUpdateMilestone?: (tripId: string, milestone: DispatchTrip["milestone"]) => Promise<void> | void;
  height?: string;
  className?: string;
  overseasOrigin?: string | null;
  showOverseasLeg?: boolean;
  mode?: "fleet" | "single";
  hideControls?: boolean;
}

export function RouteTrackerMap({
  trip,
  trips,
  selectedTripId,
  onSelectTrip,
  onUpdateMilestone,
  height = "480px",
  className,
  overseasOrigin,
  showOverseasLeg = false,
  mode,
  hideControls = false,
}: RouteTrackerMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const [localTripOverride, setLocalTripOverride] = useState<DispatchTrip | null>(null);
  const [updatingTripId, setUpdatingTripId] = useState<string | null>(null);

  // Determine current active trip
  const currentTrip =
    mode === "fleet"
      ? null
      : localTripOverride ||
        trip ||
        (selectedTripId && trips ? trips.find((t) => t.id === selectedTripId) : null);

  // Initialize Leaflet map instance once
  useEffect(() => {
    let map: L.Map | null = null;

    async function initMap() {
      if (!mapContainerRef.current) return;
      if (mapInstanceRef.current) return;

      const leafletModule = await import("leaflet");
      const Leaflet = leafletModule.default || leafletModule;

      // Default center: Cambodia (Phnom Penh)
      map = Leaflet.map(mapContainerRef.current, {
        center: [11.5564, 104.9282],
        zoom: 8,
        zoomControl: true,
        attributionControl: false,
      });

      // Clean OpenStreetMap tiles
      Leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        minZoom: 4,
      }).addTo(map);

      // Dedicated layer group for dynamically rendered markers/lines
      const layerGroup = Leaflet.layerGroup().addTo(map);
      layerGroupRef.current = layerGroup;
      mapInstanceRef.current = map;

      // Invalidate size after layout settles to avoid grey tiles
      setTimeout(() => {
        map?.invalidateSize();
      }, 200);
    }

    void initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        layerGroupRef.current = null;
      }
    };
  }, []);

  // Render routes and markers whenever current trip, trips list, or map changes
  useEffect(() => {
    async function renderLayers() {
      const map = mapInstanceRef.current;
      const layerGroup = layerGroupRef.current;
      if (!map || !layerGroup) return;

      const leafletModule = await import("leaflet");
      const L = leafletModule.default || leafletModule;

      layerGroup.clearLayers();
      const allBounds: L.LatLngExpression[] = [];

      // Helper to create HTML icons
      function createHtmlIcon(html: string, size: [number, number] = [36, 36], anchor?: [number, number]) {
        return L.divIcon({
          className: "bg-transparent border-0",
          html,
          iconSize: size,
          iconAnchor: anchor || [size[0] / 2, size[1] / 2],
          popupAnchor: [0, -size[1] / 2],
        });
      }

      // Render the primary trip details
      if (currentTrip) {
        const originHub = resolveLocation(currentTrip.origin, "origin");
        const destHub = resolveLocation(currentTrip.destination, "destination");
        const highwayWaypoints = getHighwayWaypoints(originHub.coords, destHub.coords);
        const currentPos = getPositionForMilestone(highwayWaypoints, currentTrip.milestone);
        const milestoneInfo = getMilestoneInfo(currentTrip.milestone);

        // 1. Draw Optional Sea Leg (if overseas origin is provided)
        if (showOverseasLeg && overseasOrigin) {
          const overseasHub = resolveLocation(overseasOrigin, "origin");
          const seaPoints = getSeaWaypoints(overseasHub.coords, originHub.coords);
          const seaLatLngs: L.LatLngExpression[] = seaPoints.map((p) => [p[0], p[1]]);

          L.polyline(seaLatLngs, {
            color: "#0d9488", // Teal
            weight: 3,
            dashArray: "6, 8",
            opacity: 0.8,
          }).addTo(layerGroup);

          allBounds.push(...seaLatLngs);

          // Sea Origin Port Marker
          const overseasIcon = createHtmlIcon(
            `<div class="flex items-center justify-center w-8 h-8 rounded-full bg-teal-600 text-white shadow-md border-2 border-white ring-1 ring-teal-400">
               <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9 9 0 0 0 9-9c0-4.97-4.03-9-9-9s-9 4.03-9 9a9 9 0 0 0 9 9Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M3.6 9h16.8M3.6 15h16.8"/></svg>
             </div>`
          );
          L.marker([overseasHub.coords[0], overseasHub.coords[1]], { icon: overseasIcon })
            .bindPopup(
              `<div class="text-xs p-1">
                <p class="font-bold text-slate-800">Port of Loading (Origin)</p>
                <p class="text-slate-600">${overseasHub.name}</p>
                <p class="text-[10px] text-teal-700 mt-1">International Sea Freight Leg</p>
              </div>`
            )
            .addTo(layerGroup);
        }

        // 2. Draw Highway Delivery Corridor (Inland Road)
        const roadLatLngs: L.LatLngExpression[] = highwayWaypoints.map((p) => [p[0], p[1]]);
        allBounds.push(...roadLatLngs);

        // Glowing background line
        L.polyline(roadLatLngs, {
          color: "#38bdf8",
          weight: 6,
          opacity: 0.35,
        }).addTo(layerGroup);

        // Core route line
        L.polyline(roadLatLngs, {
          color: "#0284c7", // Sky 600
          weight: 4,
          opacity: 0.9,
        }).addTo(layerGroup);

        // 3. Origin Port Marker
        const originIcon = createHtmlIcon(
          `<div class="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white shadow-lg border-2 border-white ring-2 ring-blue-300">
             <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg>
           </div>`
        );
        L.marker([originHub.coords[0], originHub.coords[1]], { icon: originIcon })
          .bindPopup(
            `<div class="text-xs p-1">
               <p class="font-bold text-slate-900">${originHub.name}</p>
               <p class="text-slate-600">${originHub.label}</p>
               <span class="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700 font-medium">Port Terminal</span>
             </div>`
          )
          .addTo(layerGroup);

        // 4. Destination Factory Marker
        const destIcon = createHtmlIcon(
          `<div class="flex items-center justify-center w-8 h-8 rounded-full bg-rose-600 text-white shadow-lg border-2 border-white ring-2 ring-rose-300">
             <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 21h18M6 21V7l6-4v7l6-4v15"/></svg>
           </div>`
        );
        L.marker([destHub.coords[0], destHub.coords[1]], { icon: destIcon })
          .bindPopup(
            `<div class="text-xs p-1">
               <p class="font-bold text-slate-900">${currentTrip.company_name}</p>
               <p class="text-slate-600">${destHub.label}</p>
               <span class="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] bg-rose-50 text-rose-700 font-medium">Consignee Factory</span>
             </div>`
          )
          .addTo(layerGroup);

        // 5. Waypoint Checkpoints
        highwayWaypoints.forEach((wp, idx) => {
          if (idx === 0 || idx === highwayWaypoints.length - 1) return;
          const checkpointIcon = createHtmlIcon(
            `<div class="w-3 h-3 rounded-full bg-white border-2 border-sky-600 shadow-sm"></div>`,
            [12, 12],
            [6, 6]
          );
          L.marker([wp[0], wp[1]], { icon: checkpointIcon })
            .bindPopup(`<span class="text-[11px] font-mono text-slate-700">Waypoint #${idx}</span>`)
            .addTo(layerGroup);
        });

        // 6. Active Moving Vehicle Marker (Pulsing Truck)
        const truckIconColor =
          currentTrip.milestone === "in_transit"
            ? "bg-sky-500 ring-sky-300"
            : currentTrip.milestone === "at_factory"
            ? "bg-amber-500 ring-amber-300"
            : currentTrip.milestone === "empty_returned"
            ? "bg-emerald-500 ring-emerald-300"
            : "bg-indigo-600 ring-indigo-300";

        const truckIcon = createHtmlIcon(
          `<div class="relative flex items-center justify-center w-10 h-10">
             <span class="absolute w-full h-full rounded-full ${truckIconColor} opacity-75 animate-ping"></span>
             <div class="relative flex items-center justify-center w-9 h-9 rounded-full ${truckIconColor} text-white shadow-xl border-2 border-white ring-2">
               <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18.5" r="2.5"/><circle cx="7" cy="18.5" r="2.5"/></svg>
             </div>
           </div>`,
          [40, 40],
          [20, 20]
        );

        const truckMarker = L.marker([currentPos[0], currentPos[1]], {
          icon: truckIcon,
          zIndexOffset: 1000,
        }).addTo(layerGroup);

        truckMarker.bindPopup(
          `<div class="min-w-44 p-1 text-xs space-y-1">
             <div class="flex items-center justify-between border-b pb-1 font-mono font-bold text-slate-800">
               <span>${currentTrip.trip_number}</span>
               <span class="text-sky-700">${currentTrip.truck_plate}</span>
             </div>
             <p class="text-slate-600">Driver: <b>${currentTrip.driver_name}</b></p>
             <p class="text-slate-600">Container: <b class="font-mono">${currentTrip.container_no}</b></p>
             <div class="mt-1 pt-1 border-t text-[11px] flex justify-between">
               <span class="text-slate-500">Status:</span>
               <span class="font-semibold uppercase tracking-wider text-sky-700">${milestoneInfo.label}</span>
             </div>
           </div>`
        );
      } else if (trips && trips.length > 0) {
        // Render markers for all trips in overview mode
        trips.forEach((t) => {
          const originHub = resolveLocation(t.origin, "origin");
          const destHub = resolveLocation(t.destination, "destination");
          const waypoints = getHighwayWaypoints(originHub.coords, destHub.coords);
          const pos = getPositionForMilestone(waypoints, t.milestone);
          allBounds.push([pos[0], pos[1]]);

          const pinIcon = createHtmlIcon(
            `<div class="flex items-center justify-center w-8 h-8 rounded-full bg-sky-600 text-white shadow-md border-2 border-white ring-1 ring-sky-300">
               <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><circle cx="17" cy="18.5" r="2.5"/><circle cx="7" cy="18.5" r="2.5"/></svg>
             </div>`
          );

          L.marker([pos[0], pos[1]], { icon: pinIcon })
            .on("click", () => {
              setLocalTripOverride(t);
              onSelectTrip?.(t);
            })
            .bindTooltip(`<b>${t.trip_number}</b> · ${t.truck_plate} (${t.milestone})`, {
              direction: "top",
              offset: [0, -16],
            })
            .addTo(layerGroup);
        });
      }

      // Auto-fit bounds to nicely center the journey
      if (allBounds.length > 0) {
        map.fitBounds(L.latLngBounds(allBounds), {
          padding: [50, 50],
          maxZoom: 12,
        });
      }
    }

    void renderLayers();
  }, [currentTrip, trips, showOverseasLeg, overseasOrigin, onSelectTrip]);

  const handleNextMilestone = useCallback(
    async (nextKey: DispatchTrip["milestone"]) => {
      if (!currentTrip || !onUpdateMilestone) return;
      setUpdatingTripId(currentTrip.id);
      try {
        await onUpdateMilestone(currentTrip.id, nextKey);
        setLocalTripOverride((prev) => (prev ? { ...prev, milestone: nextKey } : { ...currentTrip, milestone: nextKey }));
      } finally {
        setUpdatingTripId(null);
      }
    },
    [currentTrip, onUpdateMilestone]
  );

  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}>
      {/* Map Leaflet Container */}
      <div ref={mapContainerRef} style={{ height }} className="w-full z-0" />

      {/* Trip Status & Milestone Quick-Action Bar */}
      {currentTrip && (
        <div className="absolute top-3 left-3 right-3 sm:right-auto sm:max-w-md z-[1000] rounded-lg border border-border/80 bg-background/95 p-3.5 backdrop-blur shadow-md space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Truck className="h-4 w-4" />
              </span>
              <div>
                <p className="font-mono text-xs font-semibold text-foreground tracking-tight">
                  {currentTrip.trip_number} · {currentTrip.truck_plate}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {currentTrip.company_name} · Cont: {currentTrip.container_no}
                </p>
              </div>
            </div>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
                currentTrip.milestone === "in_transit" && "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
                currentTrip.milestone === "at_factory" && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
                currentTrip.milestone === "empty_returned" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
                (currentTrip.milestone === "dispatched" || currentTrip.milestone === "gate_out") && "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300"
              )}
            >
              {getMilestoneInfo(currentTrip.milestone).label}
            </span>
          </div>

          {/* Route Endpoints */}
          <div className="grid grid-cols-2 gap-2 border-y border-border/60 py-2 text-xs">
            <div className="space-y-0.5">
              <span className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-1">
                <Anchor className="h-3 w-3 text-blue-500" /> Origin
              </span>
              <p className="font-medium text-foreground truncate">{currentTrip.origin}</p>
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-1">
                <Building2 className="h-3 w-3 text-rose-500" /> Destination
              </span>
              <p className="font-medium text-foreground truncate">{currentTrip.destination}</p>
            </div>
          </div>

          {/* Milestone Stepper & Quick-Action Update */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground font-medium">Delivery Progress</span>
              <span className="font-mono text-xs font-semibold text-primary">
                {getMilestoneInfo(currentTrip.milestone).percentage}%
              </span>
            </div>

            {/* Stepper buttons for staff to advance status in 1 click */}
            <div className="grid grid-cols-5 gap-1">
              {MILESTONE_SEQUENCE.map((ms, idx) => {
                const isCurrent = currentTrip.milestone === ms.key;
                const isDone =
                  MILESTONE_SEQUENCE.findIndex((m) => m.key === currentTrip.milestone) >= idx;

                return (
                  <button
                    key={ms.key}
                    type="button"
                    disabled={updatingTripId === currentTrip.id || !onUpdateMilestone}
                    onClick={() => handleNextMilestone(ms.key)}
                    className={cn(
                      "group flex flex-col items-center justify-center rounded p-1 text-[10px] transition-all border",
                      isCurrent
                        ? "border-primary bg-primary text-primary-foreground font-semibold shadow-sm"
                        : isDone
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted"
                    )}
                    title={`Click to set status to: ${ms.label}`}
                  >
                    <span className="truncate">{ms.label.split(" ")[0]}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Click any step above to update the truck delivery status immediately.
            </p>
          </div>
        </div>
      )}

      {/* Floating Center Map Reset Button */}
      <div className="absolute bottom-3 right-3 z-[1000]">
        <Button
          size="sm"
          variant="outline"
          className="bg-background/90 backdrop-blur shadow-md text-xs gap-1.5"
          onClick={() => {
            const map = mapInstanceRef.current;
            if (map) {
              map.setView([11.5564, 104.9282], 8);
            }
          }}
        >
          <Compass className="h-3.5 w-3.5 text-primary" /> Recenter Cambodia
        </Button>
      </div>
    </div>
  );
}
