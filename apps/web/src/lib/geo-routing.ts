export type LatLng = [number, number];

export interface GeoLocation {
  id: string;
  name: string;
  label: string;
  coords: LatLng;
  category: "port" | "factory" | "depot" | "overseas";
  city?: string;
  country: string;
  mapsUrl?: string;
}

// Major ports & industrial hubs in Cambodia
export const CAMBODIA_HUBS: Record<string, GeoLocation> = {
  xin_cai_fu: {
    id: "xin_cai_fu",
    name: "Xin Cai Fu Factory (Phnom Penh)",
    label: "Xin Cai Fu (Cambodia) Co., Ltd. · Santepheap 40M Rd, Prey Sar, Dangkao",
    coords: [11.502458, 104.837447],
    category: "factory",
    city: "Phnom Penh",
    country: "Cambodia",
    mapsUrl: "https://maps.app.goo.gl/dc3Zjc3qQEUyvQVbA",
  },
  pas: {
    id: "pas",
    name: "Sihanoukville Autonomous Port (PAS)",
    label: "PAS Container Terminal, Preah Sihanouk",
    coords: [10.645722, 103.508383],
    category: "port",
    city: "Sihanoukville",
    country: "Cambodia",
  },
  ppap_lm17: {
    id: "ppap_lm17",
    name: "Phnom Penh Autonomous Port (LM17)",
    label: "PPAP Container Terminal LM17, Kien Svay, Kandal",
    coords: [11.475764, 105.140036],
    category: "port",
    city: "Phnom Penh",
    country: "Cambodia",
  },
  ppap: {
    id: "ppap",
    name: "Phnom Penh Autonomous Port (PPAP)",
    label: "PPAP Old Terminal (KM6), Phnom Penh",
    coords: [11.583303, 104.921484],
    category: "port",
    city: "Phnom Penh",
    country: "Cambodia",
  },
  ppsez: {
    id: "ppsez",
    name: "Phnom Penh Special Economic Zone (PPSEZ)",
    label: "Phnom Penh SEZ (National Road 4)",
    coords: [11.523, 104.786],
    category: "factory",
    city: "Phnom Penh",
    country: "Cambodia",
  },
  bavet_manhattan: {
    id: "bavet_manhattan",
    name: "Manhattan Special Economic Zone (Bavet)",
    label: "Manhattan SEZ, Bavet, Svay Rieng",
    coords: [11.082, 106.142],
    category: "factory",
    city: "Bavet",
    country: "Cambodia",
  },
  bavet_border: {
    id: "bavet_border",
    name: "Bavet International Border Checkpoint",
    label: "Bavet Border Checkpoint, Svay Rieng",
    coords: [11.074, 106.174],
    category: "port",
    city: "Bavet",
    country: "Cambodia",
  },
  bavet_taiseng: {
    id: "bavet_taiseng",
    name: "Tai Seng Bavet SEZ",
    label: "Tai Seng SEZ, Bavet",
    coords: [11.076, 106.134],
    category: "factory",
    city: "Bavet",
    country: "Cambodia",
  },
  ssez: {
    id: "ssez",
    name: "Sihanoukville Special Economic Zone (SSEZ)",
    label: "SSEZ, Prey Nob, Preah Sihanouk",
    coords: [10.741, 103.628],
    category: "factory",
    city: "Sihanoukville",
    country: "Cambodia",
  },
  canadia: {
    id: "canadia",
    name: "Canadia Industrial Park",
    label: "Canadia Industrial Park, Veng Sreng, Phnom Penh",
    coords: [11.535, 104.862],
    category: "factory",
    city: "Phnom Penh",
    country: "Cambodia",
  },
  vattanac: {
    id: "vattanac",
    name: "Vattanac Industrial Park",
    label: "Vattanac Industrial Park, National Road 2",
    coords: [11.492, 104.928],
    category: "factory",
    city: "Phnom Penh",
    country: "Cambodia",
  },
};

// Major overseas origin ports for Cambodian imports
export const OVERSEAS_PORTS: Record<string, GeoLocation> = {
  ningbo: {
    id: "ningbo",
    name: "Ningbo-Zhoushan Port",
    label: "Ningbo Port, China",
    coords: [29.868, 121.544],
    category: "overseas",
    city: "Ningbo",
    country: "China",
  },
  shanghai: {
    id: "shanghai",
    name: "Shanghai Port",
    label: "Port of Shanghai (Yangshan), China",
    coords: [30.63, 122.06],
    category: "overseas",
    city: "Shanghai",
    country: "China",
  },
  shenzhen: {
    id: "shenzhen",
    name: "Shenzhen Port (Yantian / Shekou)",
    label: "Shenzhen, Guangdong, China",
    coords: [22.543, 114.057],
    category: "overseas",
    city: "Shenzhen",
    country: "China",
  },
  guangzhou: {
    id: "guangzhou",
    name: "Guangzhou / Nansha Port",
    label: "Nansha Port, Guangzhou, China",
    coords: [22.766, 113.606],
    category: "overseas",
    city: "Guangzhou",
    country: "China",
  },
  catlai: {
    id: "catlai",
    name: "Cat Lai Port / Ho Chi Minh",
    label: "Cat Lai Port, Ho Chi Minh, Vietnam",
    coords: [10.762, 106.786],
    category: "overseas",
    city: "Ho Chi Minh",
    country: "Vietnam",
  },
  laemchabang: {
    id: "laemchabang",
    name: "Laem Chabang Port / Bangkok",
    label: "Laem Chabang, Chonburi, Thailand",
    coords: [13.082, 100.916],
    category: "overseas",
    city: "Laem Chabang",
    country: "Thailand",
  },
  singapore: {
    id: "singapore",
    name: "Port of Singapore",
    label: "PSA Singapore Port Terminal",
    coords: [1.29, 103.851],
    category: "overseas",
    city: "Singapore",
    country: "Singapore",
  },
};

const COORD_REGEX = /(-?\d{1,2}\.\d{4,})\s*,\s*\+?(-?\d{1,3}\.\d{4,})/;

/**
 * Intelligent location matching: resolves a free-text location string
 * (from B/L, Commercial Invoice, coordinates, or Fleet Dispatch) to a coordinate point.
 */
export function resolveLocation(raw: string | null | undefined, role: "origin" | "destination" = "destination"): GeoLocation {
  const text = (raw || "").trim().toLowerCase();

  if (!text) {
    return role === "origin" ? CAMBODIA_HUBS.pas : CAMBODIA_HUBS.xin_cai_fu;
  }

  // 0. Check explicit coordinates (e.g. "11.502458, 104.837447" or Google Maps URL)
  const coordMatch = text.match(COORD_REGEX);
  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lng = Number(coordMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return {
        id: `coords-${lat.toFixed(5)}-${lng.toFixed(5)}`,
        name: raw?.trim() || "Custom Coordinates",
        label: raw?.trim() || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        coords: [lat, lng],
        category: role === "origin" ? "port" : "factory",
        country: "Cambodia",
      };
    }
  }

  // 1. Check Xin Cai Fu Factory (exact real location in Prey Sar, Dangkao, Phnom Penh)
  if (
    text.includes("xin cai fu") ||
    text.includes("xincaifu") ||
    text.includes("prey sar") ||
    text.includes("dangkao") ||
    text.includes("dangkor") ||
    text.includes("santepheap") ||
    text.includes("dc3zjc3qqeuyvqvba")
  ) {
    return CAMBODIA_HUBS.xin_cai_fu;
  }

  // 2. Check overseas ports
  if (text.includes("ningbo")) return OVERSEAS_PORTS.ningbo;
  if (text.includes("shanghai")) return OVERSEAS_PORTS.shanghai;
  if (text.includes("shenzhen") || text.includes("shekou") || text.includes("yantian")) return OVERSEAS_PORTS.shenzhen;
  if (text.includes("guangzhou") || text.includes("nansha")) return OVERSEAS_PORTS.guangzhou;
  if (text.includes("ho chi minh") || text.includes("cat lai") || text.includes("saigon")) return OVERSEAS_PORTS.catlai;
  if (text.includes("bangkok") || text.includes("laem chabang") || text.includes("thailand")) return OVERSEAS_PORTS.laemchabang;
  if (text.includes("singapore")) return OVERSEAS_PORTS.singapore;

  // 3. Check Cambodian ports & hubs
  if (text.includes("sihanoukville") || text.includes("pas") || text.includes("kompong som") || text.includes("preah sihanouk")) {
    if (text.includes("sez") || text.includes("special economic")) return CAMBODIA_HUBS.ssez;
    return CAMBODIA_HUBS.pas;
  }
  if ((text.includes("lm17") || text.includes("kien svay")) && (text.includes("ppap") || text.includes("port") || text.includes("lm17"))) {
    return CAMBODIA_HUBS.ppap_lm17;
  }
  if (text.includes("ppap") || text.includes("km6") || text.includes("phnom penh port") || text.includes("phnom penh autonomous")) {
    return CAMBODIA_HUBS.ppap;
  }
  if (text.includes("bavet") || text.includes("manhattan") || text.includes("svay rieng")) {
    if (text.includes("border") || text.includes("checkpoint")) return CAMBODIA_HUBS.bavet_border;
    return CAMBODIA_HUBS.bavet_manhattan;
  }
  if (text.includes("tai seng") || text.includes("taiseng")) {
    return CAMBODIA_HUBS.bavet_taiseng;
  }
  if (text.includes("canadia") || text.includes("veng sreng")) {
    return CAMBODIA_HUBS.canadia;
  }
  if (text.includes("vattanac")) {
    return CAMBODIA_HUBS.vattanac;
  }
  if (text.includes("ppsez") || (text.includes("phnom penh") && text.includes("sez"))) {
    return CAMBODIA_HUBS.ppsez;
  }

  // Generic Phnom Penh fallbacks
  if (text.includes("phnom penh") || text.includes("kandal")) {
    return role === "origin" ? CAMBODIA_HUBS.ppap_lm17 : CAMBODIA_HUBS.xin_cai_fu;
  }

  // China generic fallback
  if (text.includes("china") || text.includes("cn")) {
    return OVERSEAS_PORTS.ningbo;
  }

  // Default fallback if unknown
  return {
    id: `custom-${text.replace(/\s+/g, "-")}`,
    name: raw?.trim() || (role === "origin" ? "Origin Port" : "Destination"),
    label: raw?.trim() || (role === "origin" ? "Origin Port" : "Destination"),
    coords: role === "origin" ? CAMBODIA_HUBS.pas.coords : CAMBODIA_HUBS.xin_cai_fu.coords,
    category: role === "origin" ? "port" : "factory",
    country: "Cambodia",
  };
}

// In-memory cache for OSRM real road geometries
const roadGeometryCache = new Map<string, LatLng[]>();

/**
 * Generates an in-depth highway curve fallback when offline or OSRM is unreachable.
 * Follows the Phnom Penh - Sihanoukville Expressway (E4) and National Road 1 to Bavet.
 */
export function getHighwayFallbackWaypoints(origin: LatLng, dest: LatLng): LatLng[] {
  const isSihanoukvilleOrigin = Math.abs(origin[0] - 10.646) < 0.25;
  const isSihanoukvilleDest = Math.abs(dest[0] - 10.646) < 0.25;
  const isBavetDest = dest[1] > 105.8;

  if (isSihanoukvilleOrigin) {
    const expresswayPoints: LatLng[] = [
      [origin[0], origin[1]],
      [10.646, 103.524], // Port gate exit to National Road 4
      [10.685, 103.738], // Prey Nob Expressway entrance
      [10.792, 103.812], // Prey Nob curves
      [10.912, 103.854], // Cardamom mountain approach
      [11.023, 103.882], // Expressway mountain pass
      [11.145, 104.021], // Kirirom national park valley
      [11.232, 104.184], // Kampong Seila midpoint
      [11.334, 104.342], // Pich Nil pass
      [11.455, 104.524], // Kampong Speu interchange
      [11.498, 104.652], // Samraong Tong
      [11.523, 104.786], // Phnom Penh Toll / Chaom Chau
    ];

    if (isBavetDest) {
      expresswayPoints.push(
        [11.512, 104.894], // Ring Road 3 junction
        [11.482, 104.986], // South Phnom Penh interchange
        [11.425, 105.122], // National Road 1, Kandal
        [11.258, 105.281], // Neak Loeung Bridge (Mekong crossing)
        [11.176, 105.452], // Prey Veng corridor
        [11.112, 105.621], // Svay Chrum
        [11.087, 105.799], // Svay Rieng City
        [11.081, 105.972], // Chantrea turn
        [dest[0], dest[1]]  // Bavet
      );
    } else {
      expresswayPoints.push([11.503, 104.822], [dest[0], dest[1]]);
    }

    return expresswayPoints;
  }

  if (isSihanoukvilleDest) {
    return [
      [origin[0], origin[1]],
      [11.503, 104.822],
      [11.523, 104.786],
      [11.498, 104.652],
      [11.455, 104.524],
      [11.334, 104.342],
      [11.232, 104.184],
      [11.145, 104.021],
      [11.023, 103.882],
      [10.912, 103.854],
      [10.792, 103.812],
      [10.685, 103.738],
      [10.646, 103.524],
      [dest[0], dest[1]],
    ];
  }

  // PPAP or Bavet Border to Phnom Penh fallback
  const midLat = (origin[0] + dest[0]) / 2 + 0.02;
  const midLng = (origin[1] + dest[1]) / 2;
  return [origin, [midLat, midLng], dest];
}

/**
 * Fetches real snapped road coordinates from OpenStreetMap's OSRM routing engine.
 * Follows actual expressways, turns, bridges, and curves in Cambodia.
 * Caches results in memory for instant reuse.
 */
export async function fetchRoadGeometry(origin: LatLng, dest: LatLng): Promise<LatLng[]> {
  const cacheKey = `${origin[0].toFixed(5)},${origin[1].toFixed(5)}->${dest[0].toFixed(5)},${dest[1].toFixed(5)}`;
  const cached = roadGeometryCache.get(cacheKey);
  if (cached) return cached;

  const url = `https://router.project-osrm.org/route/v1/driving/${origin[1]},${origin[0]};${dest[1]},${dest[0]}?overview=full&geometries=geojson`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data.code === "Ok" && data.routes?.[0]?.geometry?.coordinates?.length) {
        // OSRM coordinates are [lng, lat], Leaflet needs [lat, lng]
        const coords: LatLng[] = data.routes[0].geometry.coordinates.map(
          (c: [number, number]) => [c[1], c[0]]
        );
        roadGeometryCache.set(cacheKey, coords);
        return coords;
      }
    }
  } catch (err) {
    // Network offline or timeout, fall back cleanly
    console.warn("OSRM routing unavailable, using highway fallback:", err);
  }

  const fallback = getHighwayFallbackWaypoints(origin, dest);
  roadGeometryCache.set(cacheKey, fallback);
  return fallback;
}

/**
 * Backwards compatibility alias for getHighwayFallbackWaypoints
 */
export function getHighwayWaypoints(origin: LatLng, dest: LatLng): LatLng[] {
  return getHighwayFallbackWaypoints(origin, dest);
}

/**
 * Calculates a Catmull-Rom spline curve between coordinate waypoints.
 * Produces smooth, non-jagged paths for maritime navigation corridors.
 */
function splinePoints(points: LatLng[], samplesPerSegment = 6): LatLng[] {
  if (points.length < 3) return points;
  const result: LatLng[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    for (let t = 0; t < samplesPerSegment; t++) {
      const u = t / samplesPerSegment;
      const u2 = u * u;
      const u3 = u2 * u;

      // Catmull-Rom basis functions
      const f1 = -0.5 * u3 + u2 - 0.5 * u;
      const f2 = 1.5 * u3 - 2.5 * u2 + 1.0;
      const f3 = -1.5 * u3 + 2.0 * u2 + 0.5 * u;
      const f4 = 0.5 * u3 - 0.5 * u2;

      const lat = p0[0] * f1 + p1[0] * f2 + p2[0] * f3 + p3[0] * f4;
      const lng = p0[1] * f1 + p1[1] * f2 + p2[1] * f3 + p3[1] * f4;

      result.push([lat, lng]);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

/**
 * Calculates realistic maritime shipping lanes from overseas origin ports
 * (Ningbo, Shanghai, Shenzhen, Singapore, etc.) to Sihanoukville Port (PAS).
 * Navigates safely around the southern tip of Indochina (Cape Ca Mau) without crossing land.
 */
export function getSeaWaypoints(origin: LatLng, dischargePort: LatLng): LatLng[] {
  const isSouthChinaSeaOrigin = origin[0] > 15; // China / HK / Taiwan ports
  const isSingaporeOrMalacca = origin[0] < 5; // Singapore

  const controlPoints: LatLng[] = [];
  controlPoints.push(origin);

  if (isSouthChinaSeaOrigin) {
    // East China Sea to Taiwan Strait
    if (origin[0] > 26) {
      controlPoints.push([26.8, 121.5]); // East China Sea navigation channel
      controlPoints.push([24.2, 119.8]); // Taiwan Strait deep water
    }
    // South China Sea international channel
    controlPoints.push([21.2, 115.5]); // South of Hong Kong
    controlPoints.push([16.0, 112.5]); // East of Paracel Islands / central Vietnam
    controlPoints.push([11.8, 110.8]); // Open sea off Cam Ranh / Nha Trang
    controlPoints.push([9.2, 107.8]);  // Deep water south-east of Mekong Delta
    controlPoints.push([8.3, 104.8]);  // Rounding Cape Ca Mau in open sea (well south of land)
    controlPoints.push([9.2, 103.7]);  // Entering Gulf of Thailand
    controlPoints.push([10.22, 103.22]); // West of Koh Rong Sanloem outer channel
    controlPoints.push([10.58, 103.42]); // Bay of Kompong Som approach
    controlPoints.push([10.643, 103.485]); // Open deep-water channel north of Koh Pos
  } else if (isSingaporeOrMalacca) {
    // Up from Singapore through Gulf of Thailand
    controlPoints.push([2.8, 104.5]);
    controlPoints.push([5.5, 104.2]);
    controlPoints.push([8.0, 103.8]);
    controlPoints.push([9.8, 103.35]);
    controlPoints.push([10.58, 103.42]);
    controlPoints.push([10.643, 103.485]);
  } else {
    // Generic approach
    controlPoints.push([(origin[0] + 8.5) / 2, (origin[1] + 106) / 2]);
    controlPoints.push([8.4, 104.9]);
    controlPoints.push([9.6, 103.5]);
    controlPoints.push([10.58, 103.42]);
    controlPoints.push([10.643, 103.485]);
  }

  controlPoints.push(dischargePort);

  // Smooth the maritime path with Catmull-Rom spline
  return splinePoints(controlPoints, 5);
}

export type MilestoneKey = "dispatched" | "gate_out" | "in_transit" | "at_factory" | "empty_returned";

export interface MilestoneProgressInfo {
  key: MilestoneKey;
  label: string;
  description: string;
  percentage: number;
  waypointIndex: number;
}

export const MILESTONE_SEQUENCE: MilestoneProgressInfo[] = [
  {
    key: "dispatched",
    label: "Dispatched",
    description: "Truck assigned, heading to port terminal",
    percentage: 5,
    waypointIndex: 0,
  },
  {
    key: "gate_out",
    label: "Port Gate-Out",
    description: "Container released and exited port gate",
    percentage: 20,
    waypointIndex: 1,
  },
  {
    key: "in_transit",
    label: "In Transit",
    description: "En route on expressway / national highway",
    percentage: 65,
    waypointIndex: 3,
  },
  {
    key: "at_factory",
    label: "At Factory",
    description: "Arrived at customer factory / SEZ for unloading",
    percentage: 92,
    waypointIndex: 4,
  },
  {
    key: "empty_returned",
    label: "Empty Returned",
    description: "Empty container safely returned to depot (Done)",
    percentage: 100,
    waypointIndex: 5,
  },
];

export function getMilestoneInfo(milestone: string): MilestoneProgressInfo {
  return (
    MILESTONE_SEQUENCE.find((m) => m.key === milestone) || {
      key: "dispatched",
      label: "Dispatched",
      description: "Truck assigned",
      percentage: 5,
      waypointIndex: 0,
    }
  );
}

/**
 * Calculates distance between two coordinates in meters (Haversine formula).
 */
function haversineDistance(p1: LatLng, p2: LatLng): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((p2[0] - p1[0]) * Math.PI) / 180;
  const dLng = ((p2[1] - p1[1]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1[0] * Math.PI) / 180) *
      Math.cos((p2[0] * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Interpolates an exact coordinate along a polyline at a given distance fraction (0.0 to 1.0).
 */
export function getPositionAlongPath(path: LatLng[], fraction: number): LatLng {
  if (!path.length) return [11.5564, 104.9282];
  if (path.length === 1) return path[0];

  const clampedFraction = Math.max(0, Math.min(1, fraction));
  if (clampedFraction <= 0) return path[0];
  if (clampedFraction >= 1) return path[path.length - 1];

  // Calculate cumulative segment distances
  const distances: number[] = [0];
  let totalDistance = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const dist = haversineDistance(path[i], path[i + 1]);
    totalDistance += dist;
    distances.push(totalDistance);
  }

  if (totalDistance === 0) return path[0];

  const targetDist = clampedFraction * totalDistance;

  // Find the segment containing the target distance
  for (let i = 0; i < distances.length - 1; i++) {
    if (targetDist >= distances[i] && targetDist <= distances[i + 1]) {
      const segLen = distances[i + 1] - distances[i];
      const segT = segLen > 0 ? (targetDist - distances[i]) / segLen : 0;
      const lat = path[i][0] + (path[i + 1][0] - path[i][0]) * segT;
      const lng = path[i][1] + (path[i + 1][1] - path[i][1]) * segT;
      return [lat, lng];
    }
  }

  return path[path.length - 1];
}

/**
 * Returns the position of the truck along the real road path given its current milestone.
 */
export function getPositionForMilestone(waypoints: LatLng[], milestone: string): LatLng {
  const info = getMilestoneInfo(milestone);
  return getPositionAlongPath(waypoints, info.percentage / 100);
}

/**
 * Returns the vessel position along the nautical sea path.
 * progressPct is 0 to 100 (e.g. 75% across the sea journey).
 */
export function getVesselPosition(seaPath: LatLng[], progressPct = 75): LatLng {
  return getPositionAlongPath(seaPath, progressPct / 100);
}
