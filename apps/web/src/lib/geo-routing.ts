export type LatLng = [number, number];

export interface GeoLocation {
  id: string;
  name: string;
  label: string;
  coords: LatLng;
  category: "port" | "factory" | "depot" | "overseas";
  city?: string;
  country: string;
}

// Major ports & industrial hubs in Cambodia
export const CAMBODIA_HUBS: Record<string, GeoLocation> = {
  pas: {
    id: "pas",
    name: "Sihanoukville Autonomous Port (PAS)",
    label: "PAS Terminal, Sihanoukville",
    coords: [10.627, 103.522],
    category: "port",
    city: "Sihanoukville",
    country: "Cambodia",
  },
  ppap: {
    id: "ppap",
    name: "Phnom Penh Autonomous Port (PPAP)",
    label: "PPAP Container Terminal (LM17 / KM6)",
    coords: [11.583, 104.917],
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
    coords: [31.23, 121.473],
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

/**
 * Intelligent location matching: resolves a free-text location string
 * (from B/L, Commercial Invoice, or Fleet Dispatch) to a coordinate point.
 */
export function resolveLocation(raw: string | null | undefined, role: "origin" | "destination" = "destination"): GeoLocation {
  const text = (raw || "").trim().toLowerCase();

  if (!text) {
    return role === "origin" ? CAMBODIA_HUBS.pas : CAMBODIA_HUBS.ppsez;
  }

  // 1. Check overseas ports
  if (text.includes("ningbo")) return OVERSEAS_PORTS.ningbo;
  if (text.includes("shanghai")) return OVERSEAS_PORTS.shanghai;
  if (text.includes("shenzhen") || text.includes("shekou") || text.includes("yantian")) return OVERSEAS_PORTS.shenzhen;
  if (text.includes("guangzhou") || text.includes("nansha")) return OVERSEAS_PORTS.guangzhou;
  if (text.includes("ho chi minh") || text.includes("cat lai") || text.includes("saigon")) return OVERSEAS_PORTS.catlai;
  if (text.includes("bangkok") || text.includes("laem chabang") || text.includes("thailand")) return OVERSEAS_PORTS.laemchabang;
  if (text.includes("singapore")) return OVERSEAS_PORTS.singapore;

  // 2. Check Cambodian ports & hubs
  if (text.includes("sihanoukville") || text.includes("pas") || text.includes("kompong som") || text.includes("preah sihanouk")) {
    if (text.includes("sez") || text.includes("special economic")) return CAMBODIA_HUBS.ssez;
    return CAMBODIA_HUBS.pas;
  }
  if (text.includes("ppap") || text.includes("km6") || text.includes("lm17") || text.includes("phnom penh port")) {
    return CAMBODIA_HUBS.ppap;
  }
  if (text.includes("bavet") || text.includes("manhattan") || text.includes("svay rieng")) {
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
    return role === "origin" ? CAMBODIA_HUBS.ppap : CAMBODIA_HUBS.ppsez;
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
    coords: role === "origin" ? [10.627, 103.522] : [11.523, 104.786],
    category: role === "origin" ? "port" : "factory",
    country: "Cambodia",
  };
}

/**
 * Generates delivery waypoints between an origin and destination in Cambodia
 * following major highway corridors (Expressway / National Road 4 / National Road 1).
 */
export function getHighwayWaypoints(origin: LatLng, dest: LatLng): LatLng[] {
  // If origin is near Sihanoukville and destination is near Phnom Penh/PPSEZ
  const isSihanoukvilleOrigin = Math.abs(origin[0] - 10.627) < 0.2;
  const isBavetDest = dest[1] > 105.8; // East near Vietnam border

  if (isSihanoukvilleOrigin) {
    const expresswayPoints: LatLng[] = [
      [origin[0], origin[1]],
      [10.685, 103.738], // Prey Nob Expressway entrance
      [11.02, 103.88],   // Expressway mountain pass
      [11.23, 104.18],   // Kampong Seila midpoint
      [11.455, 104.52],  // Kampong Speu interchange
      [11.523, 104.786], // Phnom Penh Toll / PPSEZ
    ];

    if (isBavetDest) {
      // Extended leg to Bavet along National Road 1
      expresswayPoints.push(
        [11.48, 104.98],   // South Phnom Penh Ring Road
        [11.258, 105.281], // Neak Loeung Bridge
        [11.087, 105.799], // Svay Rieng City
        [dest[0], dest[1]] // Bavet SEZ
      );
    } else {
      expresswayPoints.push([dest[0], dest[1]]);
    }

    return expresswayPoints;
  }

  // Fallback linear interpolation for other routes with a slight curve
  const midLat = (origin[0] + dest[0]) / 2 + 0.05;
  const midLng = (origin[1] + dest[1]) / 2;
  return [origin, [midLat, midLng], dest];
}

/**
 * Calculates marine passage waypoints between overseas origin port and Cambodian discharge port
 */
export function getSeaWaypoints(origin: LatLng, dischargePort: LatLng): LatLng[] {
  // Approximate maritime shipping lane waypoints in South China Sea & Gulf of Thailand
  return [
    origin,
    [(origin[0] + 15) / 2, (origin[1] + 115) / 2], // South China Sea passage
    [9.5, 105.0],                                  // Tip of Ca Mau Peninsula (turning into Gulf of Thailand)
    [10.1, 103.8],                                  // Gulf of Thailand approach
    dischargePort,
  ];
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
    percentage: 15,
    waypointIndex: 0,
  },
  {
    key: "gate_out",
    label: "Port Gate-Out",
    description: "Container released and exited port gate",
    percentage: 35,
    waypointIndex: 1,
  },
  {
    key: "in_transit",
    label: "In Transit",
    description: "En route on highway / expressway",
    percentage: 65,
    waypointIndex: 3,
  },
  {
    key: "at_factory",
    label: "At Factory",
    description: "Arrived at customer factory / SEZ for unloading",
    percentage: 90,
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
      percentage: 15,
      waypointIndex: 0,
    }
  );
}

/**
 * Given waypoints and a milestone, returns the approximate current coordinate along the route.
 */
export function getPositionForMilestone(waypoints: LatLng[], milestone: string): LatLng {
  if (!waypoints.length) return [11.5564, 104.9282];
  if (waypoints.length === 1) return waypoints[0];

  const info = getMilestoneInfo(milestone);
  const ratio = info.percentage / 100;
  const targetIndex = Math.min(
    waypoints.length - 1,
    Math.max(0, Math.round(ratio * (waypoints.length - 1)))
  );

  return waypoints[targetIndex];
}
