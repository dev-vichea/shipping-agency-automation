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
  CAMBODIA_HUBS,
  resolveLocation,
  fetchRoadGeometry,
  getSeaWaypoints,
  getPositionForMilestone,
  getVesselPosition,
  getMilestoneInfo,
  getPathBearingDegrees,
  MILESTONE_SEQUENCE,
  type GeoLocation,
} from "@/lib/geo-routing";
import {
  buildTruckPointerHtml,
  buildVesselPointerHtml,
  buildFactoryPointerHtml,
  buildPortPointerHtml,
  buildBorderGatePointerHtml,
} from "./map-markers";
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveTripEndpoints(t: DispatchTrip): { originHub: GeoLocation; destHub: GeoLocation } {
  const fallbackOrigin = resolveLocation(t.origin, "origin");
  const fallbackDest = resolveLocation(t.destination, "destination");

  const originHub: GeoLocation = t.origin_point
    ? {
        id: t.origin_point.id,
        name: t.origin_point.name,
        label: t.origin_point.label,
        coords: [t.origin_point.lat, t.origin_point.lng],
        category: t.origin_point.category === "port" ? "port" : "factory",
        country: "Cambodia",
        mapsUrl: t.origin_point.maps_url ?? undefined,
      }
    : fallbackOrigin;

  const destHub: GeoLocation = t.destination_point
    ? {
        id: t.destination_point.id,
        name: t.destination_point.name,
        label: t.destination_point.label,
        coords: [t.destination_point.lat, t.destination_point.lng],
        category: t.destination_point.category === "port" ? "port" : "factory",
        country: "Cambodia",
        mapsUrl: t.destination_point.maps_url ?? undefined,
      }
    : fallbackDest;

  return { originHub, destHub };
}

export function RouteTrackerMap({
  trip,
  trips,
  selectedTripId,
  onSelectTrip,
  onUpdateMilestone,
  height = "520px",
  className,
  overseasOrigin,
  showOverseasLeg = true,
  mode,
  hideControls = false,
}: RouteTrackerMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const [uncontrolledTrip, setUncontrolledTrip] = useState<DispatchTrip | null>(null);
  const [updatingTripId, setUpdatingTripId] = useState<string | null>(null);

  const onUpdateMilestoneRef = useRef(onUpdateMilestone);
  useEffect(() => {
    onUpdateMilestoneRef.current = onUpdateMilestone;
  }, [onUpdateMilestone]);

  const onSelectTripRef = useRef(onSelectTrip);
  useEffect(() => {
    onSelectTripRef.current = onSelectTrip;
  }, [onSelectTrip]);

  const currentTrip =
    mode === "fleet"
      ? null
      : trip ??
        (selectedTripId && trips ? trips.find((t) => t.id === selectedTripId) ?? null : null) ??
        uncontrolledTrip;

  // Initialize Leaflet map instance once
  useEffect(() => {
    let map: L.Map | null = null;

    async function initMap() {
      if (!mapContainerRef.current) return;
      if (mapInstanceRef.current) return;

      const leafletModule = await import("leaflet");
      const Leaflet = leafletModule.default || leafletModule;

      map = Leaflet.map(mapContainerRef.current, {
        center: [11.502458, 104.837447],
        zoom: 8,
        zoomControl: true,
        attributionControl: false,
      });

      Leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        minZoom: 3,
      }).addTo(map);

      const layerGroup = Leaflet.layerGroup().addTo(map);
      layerGroupRef.current = layerGroup;
      mapInstanceRef.current = map;

      setTimeout(() => {
        map?.invalidateSize();
      }, 250);
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

  // Render snapped roads, sea routes, truck, and vessel markers
  useEffect(() => {
    let isCancelled = false;

    async function renderLayers() {
      const map = mapInstanceRef.current;
      const layerGroup = layerGroupRef.current;
      if (!map || !layerGroup) return;

      const leafletModule = await import("leaflet");
      const L = leafletModule.default || leafletModule;

      layerGroup.clearLayers();
      const allBounds: L.LatLngExpression[] = [];

      function createPointerIcon(html: string, popupOffsetY = -44) {
        return L.divIcon({
          className: "bg-transparent border-0",
          html,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
          popupAnchor: [0, popupOffsetY],
        });
      }

      function drawHighwayRibbon(roadLatLngs: L.LatLngExpression[], focused: boolean) {
        if (!layerGroup) return;
        L.polyline(roadLatLngs, {
          color: "#38bdf8",
          weight: focused ? 7 : 5,
          opacity: focused ? 0.35 : 0.25,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layerGroup);

        L.polyline(roadLatLngs, {
          color: "#0284c7",
          weight: focused ? 4.5 : 3,
          opacity: focused ? 0.95 : 0.85,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(layerGroup);
      }

      // -------------------------------------------------------------
      // 1. SINGLE TRIP INSPECTION MODE
      // -------------------------------------------------------------
      if (currentTrip) {
        const { originHub, destHub } = resolveTripEndpoints(currentTrip);
        const isOutbound = currentTrip.direction === "outbound";
        const isLandBorderOrigin = currentTrip.origin.toLowerCase().includes("bavet");

        // Determine overseas port & sea leg (inbound maritime imports only)
        const originPortQuery =
          currentTrip.vessel?.origin_port ||
          overseasOrigin ||
          (currentTrip.shipment_ref.includes("SIH") ? "Ningbo Port" : "Shanghai Port");

        const overseasHub = resolveLocation(originPortQuery, "origin");
        const hasOverseasSeaLeg =
          !isOutbound &&
          !isLandBorderOrigin &&
          showOverseasLeg &&
          (Boolean(currentTrip.vessel) || (Boolean(overseasOrigin) && overseasHub.category === "overseas"));

        // 1A. MARITIME SEA ROUTE & VESSEL MARKER
        if (hasOverseasSeaLeg) {
          const dischargeHub =
            originHub.category === "port" ? originHub : CAMBODIA_HUBS.pas;
          const seaPoints = getSeaWaypoints(overseasHub.coords, dischargeHub.coords);
          const seaLatLngs: L.LatLngExpression[] = seaPoints.map((p) => [p[0], p[1]]);

          L.polyline(seaLatLngs, {
            color: "#0f766e",
            weight: 5,
            opacity: 0.25,
          }).addTo(layerGroup);

          L.polyline(seaLatLngs, {
            color: "#0d9488",
            weight: 3.5,
            dashArray: "8, 10",
            opacity: 0.9,
          }).addTo(layerGroup);

          allBounds.push(...seaLatLngs);

          const overseasIcon = createPointerIcon(
            buildPortPointerHtml({
              label: overseasHub.city || overseasHub.name,
              variant: "overseas",
              compact: true,
            }),
            -56
          );
          L.marker([overseasHub.coords[0], overseasHub.coords[1]], {
            icon: overseasIcon,
            zIndexOffset: 900,
          })
            .bindPopup(
              `<div class="p-2 text-xs space-y-1">
                 <div class="flex items-center gap-1.5 font-bold text-teal-800">
                   <span>Port of Loading (Overseas Origin)</span>
                 </div>
                 <p class="font-semibold text-slate-800 text-sm">${escapeHtml(overseasHub.name)}</p>
                 <p class="text-slate-500">${escapeHtml(overseasHub.city ? `${overseasHub.city}, ` : "")}${escapeHtml(overseasHub.country)}</p>
                 <span class="inline-block mt-1 px-2 py-0.5 rounded text-[10px] bg-teal-50 text-teal-700 border border-teal-200 font-medium">International Maritime Origin</span>
               </div>`
            )
            .addTo(layerGroup);

          const vesselProgress = currentTrip.vessel?.progress_pct ?? 72;
          const vesselPos = getVesselPosition(seaPoints, vesselProgress);
          const vesselBearingDeg = getPathBearingDegrees(seaPoints, vesselProgress / 100);
          const vesselName = currentTrip.vessel?.name || "WAN HAI 510";
          const voyageNo = currentTrip.vessel?.voyage || "V.2611S";
          const shippingLine = currentTrip.vessel?.shipping_line || "Carrier AIS";
          const vesselSpeed = currentTrip.vessel?.speed_knots ?? 16.4;

          const vesselIcon = createPointerIcon(
            buildVesselPointerHtml({
              name: vesselName,
              voyage: voyageNo,
              bearingDeg: vesselBearingDeg,
            }),
            -48
          );

          const vesselMarker = L.marker([vesselPos[0], vesselPos[1]], {
            icon: vesselIcon,
            zIndexOffset: 1200,
          }).addTo(layerGroup);

          vesselMarker.bindPopup(
            `<div class="min-w-56 p-2 text-xs space-y-2">
               <div class="flex items-center justify-between border-b pb-1.5">
                 <div>
                   <span class="text-[10px] text-teal-600 font-semibold uppercase tracking-wider block">Container Vessel · AIS Live</span>
                   <p class="font-bold text-slate-900 text-sm font-mono">${escapeHtml(vesselName)}</p>
                 </div>
                 <span class="px-2 py-0.5 rounded text-[10px] bg-teal-100 text-teal-800 font-mono font-medium">${escapeHtml(voyageNo)}</span>
               </div>
               <div class="grid grid-cols-2 gap-1.5 text-[11px]">
                 <div>
                   <span class="text-slate-500 block">Shipping Line</span>
                   <span class="font-semibold text-slate-800">${escapeHtml(shippingLine)}</span>
                 </div>
                 <div>
                   <span class="text-slate-500 block">AIS Speed</span>
                   <span class="font-semibold text-teal-700">${vesselSpeed} knots</span>
                 </div>
               </div>
               <div class="border-t pt-1.5 space-y-1 text-[11px]">
                 <div class="flex justify-between">
                   <span class="text-slate-500">Passage Progress:</span>
                   <span class="font-mono font-bold text-teal-700">${vesselProgress}%</span>
                 </div>
                 <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                   <div class="bg-teal-600 h-1.5 rounded-full" style="width: ${vesselProgress}%"></div>
                 </div>
                 <p class="text-[10px] text-slate-500 mt-1">Course: South China Sea -&gt; Ca Mau -&gt; Gulf of Thailand -&gt; ${escapeHtml(dischargeHub.name)}</p>
               </div>
             </div>`
          );
        }

        // 1B. REAL SNAPPED ROAD ROUTE (OSRM Snapped Highway Geometry)
        const roadPoints = await fetchRoadGeometry(originHub.coords, destHub.coords);
        if (isCancelled) return;

        const roadLatLngs: L.LatLngExpression[] = roadPoints.map((p) => [p[0], p[1]]);
        allBounds.push(...roadLatLngs);
        drawHighwayRibbon(roadLatLngs, true);

        // Origin Endpoint Pin (Port / Border / Pickup Factory)
        const originIsFactory = originHub.category === "factory" || isOutbound;
        const originIsBorder = originHub.id.includes("border");
        const originPinHtml = originIsBorder
          ? buildBorderGatePointerHtml({ label: originHub.name })
          : originIsFactory
          ? buildFactoryPointerHtml({ label: originHub.name })
          : buildPortPointerHtml({ label: originHub.name, variant: "cambodia" });

        const originPinIcon = createPointerIcon(originPinHtml, -42);
        L.marker([originHub.coords[0], originHub.coords[1]], {
          icon: originPinIcon,
          zIndexOffset: 900,
        })
          .bindPopup(
            `<div class="p-2 text-xs space-y-1">
               <span class="text-[10px] ${
                 originIsFactory ? "text-rose-600" : originIsBorder ? "text-indigo-600" : "text-blue-600"
               } font-semibold uppercase tracking-wider block">
                 ${originIsFactory ? "Pickup Factory / Warehouse" : originIsBorder ? "Border Checkpoint" : "Port of Discharge / Terminal"}
               </span>
               <p class="font-bold text-slate-900">${escapeHtml(originHub.name)}</p>
               <p class="text-slate-600">${escapeHtml(originHub.label)}</p>
               ${
                 originHub.mapsUrl
                   ? `<a href="${escapeHtml(originHub.mapsUrl)}" target="_blank" rel="noreferrer" class="inline-block mt-1 text-[11px] font-medium text-sky-700 underline">Open in Google Maps</a>`
                   : `<span class="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700 font-medium">Inland Trucking Origin</span>`
               }
             </div>`
          )
          .addTo(layerGroup);

        // Destination Endpoint Pin (Factory for inbound, Port for outbound)
        const destIsPort = destHub.category === "port" || isOutbound;
        const destPinHtml = destIsPort
          ? buildPortPointerHtml({ label: destHub.name, variant: "cambodia" })
          : buildFactoryPointerHtml({ label: currentTrip.company_name });

        const destIcon = createPointerIcon(destPinHtml, -42);
        L.marker([destHub.coords[0], destHub.coords[1]], {
          icon: destIcon,
          zIndexOffset: 950,
        })
          .bindPopup(
            `<div class="p-2 text-xs space-y-1">
               <span class="text-[10px] ${
                 destIsPort ? "text-blue-600" : "text-rose-600"
               } font-semibold uppercase tracking-wider block">
                 ${destIsPort ? "Destination Port Gate" : "Destination Consignee Factory"}
               </span>
               <p class="font-bold text-slate-900">${escapeHtml(destHub.name)}</p>
               <p class="text-slate-600">${escapeHtml(destHub.label)}</p>
               <p class="text-[10px] font-mono text-slate-500">${destHub.coords[0].toFixed(6)}, ${destHub.coords[1].toFixed(6)}</p>
               ${
                 destHub.mapsUrl
                   ? `<a href="${escapeHtml(destHub.mapsUrl)}" target="_blank" rel="noreferrer" class="inline-block mt-1 text-[11px] font-medium text-sky-700 underline">Open in Google Maps</a>`
                   : ""
               }
             </div>`
          )
          .addTo(layerGroup);

        // 1C. TOP-DOWN TRUCK MODEL (Driving directly on the snapped road lanes)
        const milestoneInfo = getMilestoneInfo(currentTrip.milestone);
        const truckPos = getPositionForMilestone(roadPoints, currentTrip.milestone);
        const truckBearingDeg = getPathBearingDegrees(roadPoints, milestoneInfo.percentage / 100);

        const is3PL =
          currentTrip.haulier_type === "subcontractor" ||
          currentTrip.truck_plate.includes("Kandal") ||
          currentTrip.driver_name.includes("Bun Sopheak");

        const truckIcon = createPointerIcon(
          buildTruckPointerHtml({
            plate: currentTrip.truck_plate,
            is3PL,
            milestone: currentTrip.milestone,
            bearingDeg: truckBearingDeg,
          }),
          -44
        );

        const truckMarker = L.marker([truckPos[0], truckPos[1]], {
          icon: truckIcon,
          zIndexOffset: 1500,
        }).addTo(layerGroup);

        truckMarker.bindPopup(
          `<div class="min-w-60 p-2 text-xs space-y-2">
             <div class="flex items-center justify-between border-b pb-1.5">
               <div>
                 <span class="font-mono font-bold text-slate-900 text-sm">${escapeHtml(currentTrip.truck_plate)}</span>
                 <p class="text-[10px] text-slate-500">${escapeHtml(currentTrip.trip_number)} · ${escapeHtml(currentTrip.shipment_ref)}</p>
               </div>
               <span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                 is3PL ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"
               }">
                 ${is3PL ? "3PL Haulier" : "In-House Fleet"}
               </span>
             </div>

             <div class="grid grid-cols-2 gap-2 text-[11px]">
               <div>
                 <span class="text-slate-500 block">Assigned Driver</span>
                 <span class="font-semibold text-slate-800">${escapeHtml(currentTrip.driver_name)}</span>
                 <span class="text-[10px] text-slate-500 block font-mono">${escapeHtml(currentTrip.driver_phone)}</span>
               </div>
               <div>
                 <span class="text-slate-500 block">Container & Seal</span>
                 <span class="font-semibold font-mono text-slate-800">${escapeHtml(currentTrip.container_no)}</span>
                 <span class="text-[10px] text-slate-500 block font-mono">Seal: ${escapeHtml(currentTrip.seal_no)}</span>
               </div>
             </div>

             <div class="border-t pt-1.5 space-y-1">
               <div class="flex justify-between items-center text-[11px]">
                 <span class="text-slate-500">Milestone:</span>
                 <span class="font-bold uppercase tracking-wider text-sky-700">${escapeHtml(milestoneInfo.label)} (${milestoneInfo.percentage}%)</span>
               </div>
               <p class="text-[10px] text-slate-600">${escapeHtml(milestoneInfo.description)}</p>
             </div>
           </div>`
        );
      } else if (trips && trips.length > 0) {
        // -------------------------------------------------------------
        // 2. FULL FLEET MONITOR RADAR MODE
        // -------------------------------------------------------------
        const baseHubs: GeoLocation[] = [
          CAMBODIA_HUBS.xin_cai_fu,
          CAMBODIA_HUBS.pas,
          CAMBODIA_HUBS.ppap_lm17,
        ];

        baseHubs.forEach((hub) => {
          const isFactory = hub.category === "factory";
          const hubIcon = createPointerIcon(
            isFactory
              ? buildFactoryPointerHtml({ label: hub.name, compact: true })
              : buildPortPointerHtml({ label: hub.name, variant: "cambodia", compact: true }),
            -38
          );
          L.marker([hub.coords[0], hub.coords[1]], { icon: hubIcon, zIndexOffset: 900 })
            .bindPopup(
              `<div class="p-2 text-xs space-y-1">
                 <p class="font-bold text-slate-900">${escapeHtml(hub.name)}</p>
                 <p class="text-slate-600">${escapeHtml(hub.label)}</p>
                 <p class="text-[10px] font-mono text-slate-500">${hub.coords[0].toFixed(6)}, ${hub.coords[1].toFixed(6)}</p>
                 ${
                   hub.mapsUrl
                     ? `<a href="${escapeHtml(hub.mapsUrl)}" target="_blank" rel="noreferrer" class="inline-block mt-1 text-[11px] font-medium text-sky-700 underline">Open in Google Maps</a>`
                     : ""
                 }
               </div>`
            )
            .addTo(layerGroup);
          allBounds.push([hub.coords[0], hub.coords[1]]);
        });

        await Promise.all(
          trips.map(async (t) => {
            if (isCancelled) return;
            const { originHub, destHub } = resolveTripEndpoints(t);
            const roadPoints = await fetchRoadGeometry(originHub.coords, destHub.coords);
            if (isCancelled) return;

            const roadLatLngs: L.LatLngExpression[] = roadPoints.map((p) => [p[0], p[1]]);
            allBounds.push(...roadLatLngs);
            drawHighwayRibbon(roadLatLngs, false);

            const mInfo = getMilestoneInfo(t.milestone);
            const pos = getPositionForMilestone(roadPoints, t.milestone);
            const bearingDeg = getPathBearingDegrees(roadPoints, mInfo.percentage / 100);
            const is3PL =
              t.haulier_type === "subcontractor" ||
              t.truck_plate.includes("Kandal") ||
              t.driver_name.includes("Bun Sopheak");

            const pinIcon = createPointerIcon(
              buildTruckPointerHtml({
                plate: t.truck_plate,
                is3PL,
                milestone: t.milestone,
                bearingDeg,
                compact: true,
              }),
              -38
            );

            L.marker([pos[0], pos[1]], { icon: pinIcon, zIndexOffset: 1200 })
              .on("click", () => {
                setUncontrolledTrip(t);
                onSelectTripRef.current?.(t);
              })
              .bindTooltip(
                `<b>${escapeHtml(t.trip_number)}</b> · ${escapeHtml(t.truck_plate)} (${escapeHtml(t.milestone.replace("_", " "))})`,
                {
                  direction: "top",
                  offset: [0, -38],
                }
              )
              .addTo(layerGroup);
          })
        );
      }

      if (allBounds.length > 0 && !isCancelled) {
        map.fitBounds(L.latLngBounds(allBounds), {
          padding: [60, 60],
          maxZoom: 13,
        });
      }
    }

    void renderLayers();

    return () => {
      isCancelled = true;
    };
  }, [currentTrip, trips, showOverseasLeg, overseasOrigin]);

  const handleNextMilestone = useCallback(
    async (nextKey: DispatchTrip["milestone"]) => {
      if (!currentTrip || !onUpdateMilestoneRef.current) return;
      setUpdatingTripId(currentTrip.id);
      try {
        await onUpdateMilestoneRef.current(currentTrip.id, nextKey);
        if (!trip && !selectedTripId) {
          setUncontrolledTrip((prev) =>
            prev ? { ...prev, milestone: nextKey } : { ...currentTrip, milestone: nextKey }
          );
        }
      } finally {
        setUpdatingTripId(null);
      }
    },
    [currentTrip, trip, selectedTripId]
  );

  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}>
      <div ref={mapContainerRef} style={{ height }} className="w-full z-0" />

      {currentTrip && !hideControls && (
        <div className="absolute top-3 left-3 right-3 sm:right-auto sm:max-w-md z-[1000] rounded-lg border border-border/80 bg-background/95 p-3.5 backdrop-blur shadow-md space-y-3">
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

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground font-medium">Inland Trucking Progress</span>
              <span className="font-mono text-xs font-semibold text-primary">
                {getMilestoneInfo(currentTrip.milestone).percentage}%
              </span>
            </div>

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
              Click any step above to update status in PostgreSQL immediately.
            </p>
          </div>
        </div>
      )}

      <div className="absolute bottom-3 right-3 z-[1000] flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="bg-background/90 backdrop-blur shadow-md text-xs gap-1.5"
          onClick={() => {
            const map = mapInstanceRef.current;
            if (map) {
              map.setView([11.502458, 104.837447], 9);
            }
          }}
        >
          <Compass className="h-3.5 w-3.5 text-primary" /> Recenter Map
        </Button>
      </div>
    </div>
  );
}
