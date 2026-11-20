export type VehicleType =
  | "Prime Mover (Tractor)"
  | "40ft Flatbed Chassis"
  | "20ft Skeleton Chassis"
  | "45ft Goose-neck"
  | "Rigid Truck (5T)";

export type HaulierType = "in_house" | "subcontractor";
export type VehicleStatus = "available" | "on_trip" | "maintenance";
export type DriverStatus = "available" | "on_trip" | "off_duty";
export type TripMilestone =
  | "dispatched"
  | "gate_out"
  | "in_transit"
  | "at_factory"
  | "empty_returned"
  | "completed";

export interface Vehicle {
  id: string;
  plate_number: string;
  trailer_plate: string;
  vehicle_type: VehicleType;
  haulier_type: HaulierType;
  haulier_name: string;
  assigned_driver_name?: string;
  driver_phone?: string;
  status: VehicleStatus;
  capacity: string;
  notes?: string;
  updated_at: string;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  license_number: string;
  national_id: string;
  assigned_vehicle_plate?: string;
  status: DriverStatus;
  total_trips: number;
  safety_rating: string;
  notes?: string;
  created_at: string;
}

export interface DispatchTrip {
  id: string;
  trip_number: string;
  shipment_ref: string;
  company_name: string;
  direction: "inbound" | "outbound";
  truck_plate: string;
  trailer_plate?: string;
  driver_name: string;
  driver_phone: string;
  container_no: string;
  seal_no: string;
  origin: string;
  destination: string;
  milestone: TripMilestone;
  dispatched_at: string;
  eta: string;
  notes?: string;
}

const DEFAULT_VEHICLES: Vehicle[] = [
  {
    id: "veh-1",
    plate_number: "Phnom Penh 3E-1234",
    trailer_plate: "4A-8821",
    vehicle_type: "40ft Flatbed Chassis",
    haulier_type: "in_house",
    haulier_name: "Harborway Fleet",
    assigned_driver_name: "Seng Vichea",
    driver_phone: "012 889 912",
    status: "on_trip",
    capacity: "45 Tons",
    notes: "Assigned to Bavet Border cross-docking",
    updated_at: "2026-11-20T08:30:00Z",
  },
  {
    id: "veh-2",
    plate_number: "Phnom Penh 3F-5678",
    trailer_plate: "4A-9912",
    vehicle_type: "20ft Skeleton Chassis",
    haulier_type: "in_house",
    haulier_name: "Harborway Fleet",
    assigned_driver_name: "Chhorn Chantha",
    driver_phone: "098 765 432",
    status: "available",
    capacity: "35 Tons",
    notes: "Ready for Sihanoukville Autonomous Port (PAS) pickup",
    updated_at: "2026-11-20T07:15:00Z",
  },
  {
    id: "veh-3",
    plate_number: "Kandal 3B-9012",
    trailer_plate: "4B-1123",
    vehicle_type: "40ft Flatbed Chassis",
    haulier_type: "subcontractor",
    haulier_name: "So Nguon Transport",
    assigned_driver_name: "Bun Sopheak",
    driver_phone: "089 123 456",
    status: "on_trip",
    capacity: "45 Tons",
    notes: "Direct haul: Sihanoukville Port -> Xin Cai Fu Factory",
    updated_at: "2026-11-19T22:00:00Z",
  },
  {
    id: "veh-4",
    plate_number: "Phnom Penh 3D-4455",
    trailer_plate: "4A-3321",
    vehicle_type: "Prime Mover (Tractor)",
    haulier_type: "in_house",
    haulier_name: "Harborway Fleet",
    assigned_driver_name: "Kosal Ratanak",
    driver_phone: "077 554 433",
    status: "maintenance",
    capacity: "50 Tons",
    notes: "Scheduled brake and tire inspection in depot",
    updated_at: "2026-11-19T14:20:00Z",
  },
  {
    id: "veh-5",
    plate_number: "Preah Sihanouk 3A-7890",
    trailer_plate: "4A-6677",
    vehicle_type: "45ft Goose-neck",
    haulier_type: "subcontractor",
    haulier_name: "Mekong Express Logistics",
    assigned_driver_name: "Heng Dara",
    driver_phone: "010 332 211",
    status: "available",
    capacity: "48 Tons",
    notes: "Stationed at Sihanoukville Special Economic Zone",
    updated_at: "2026-11-20T06:00:00Z",
  },
];

const DEFAULT_DRIVERS: Driver[] = [
  {
    id: "drv-1",
    name: "Seng Vichea",
    phone: "012 889 912",
    license_number: "DL-KH-204918",
    national_id: "NID-01928374",
    assigned_vehicle_plate: "Phnom Penh 3E-1234",
    status: "on_trip",
    total_trips: 142,
    safety_rating: "4.9",
    notes: "Heavy container certified · Bavet border route specialist",
    created_at: "2025-01-10T08:00:00Z",
  },
  {
    id: "drv-2",
    name: "Chhorn Chantha",
    phone: "098 765 432",
    license_number: "DL-KH-198273",
    national_id: "NID-08273645",
    assigned_vehicle_plate: "Phnom Penh 3F-5678",
    status: "available",
    total_trips: 98,
    safety_rating: "4.8",
    notes: "Experienced with Sihanoukville Port container yard",
    created_at: "2025-03-15T09:30:00Z",
  },
  {
    id: "drv-3",
    name: "Bun Sopheak",
    phone: "089 123 456",
    license_number: "DL-KH-312984",
    national_id: "NID-03948572",
    assigned_vehicle_plate: "Kandal 3B-9012",
    status: "on_trip",
    total_trips: 215,
    safety_rating: "5.0",
    notes: "Senior driver at So Nguon Transport",
    created_at: "2024-06-20T10:00:00Z",
  },
  {
    id: "drv-4",
    name: "Kosal Ratanak",
    phone: "077 554 433",
    license_number: "DL-KH-441209",
    national_id: "NID-04481239",
    assigned_vehicle_plate: "Phnom Penh 3D-4455",
    status: "off_duty",
    total_trips: 87,
    safety_rating: "4.7",
    notes: "On maintenance duty at Phnom Penh depot",
    created_at: "2025-05-02T11:00:00Z",
  },
  {
    id: "drv-5",
    name: "Heng Dara",
    phone: "010 332 211",
    license_number: "DL-KH-509182",
    national_id: "NID-05829103",
    assigned_vehicle_plate: "Preah Sihanouk 3A-7890",
    status: "available",
    total_trips: 164,
    safety_rating: "4.9",
    notes: "Reefer & Dry container certified",
    created_at: "2024-11-12T07:45:00Z",
  },
];

const DEFAULT_DISPATCHES: DispatchTrip[] = [
  {
    id: "trip-1",
    trip_number: "TRIP-2026-081",
    shipment_ref: "RE2612049",
    company_name: "XIN CAI FU",
    direction: "inbound",
    truck_plate: "Phnom Penh 3E-1234",
    trailer_plate: "4A-8821",
    driver_name: "Seng Vichea",
    driver_phone: "012 889 912",
    container_no: "TGHU1234567",
    seal_no: "ML-KH84920",
    origin: "PAS (Sihanoukville Port)",
    destination: "Xin Cai Fu Factory, Phnom Penh SEZ",
    milestone: "in_transit",
    dispatched_at: "2026-11-20T06:30:00Z",
    eta: "2026-11-20T15:00:00Z",
    notes: "Cambodia Expressway route (E1) · High security bolt seal verified",
  },
  {
    id: "trip-2",
    trip_number: "TRIP-2026-080",
    shipment_ref: "SIH26110051",
    company_name: "XIN CAI FU",
    direction: "inbound",
    truck_plate: "Kandal 3B-9012",
    trailer_plate: "4B-1123",
    driver_name: "Bun Sopheak",
    driver_phone: "089 123 456",
    container_no: "TEMU7654321",
    seal_no: "COS-883921",
    origin: "Bavet Border Checkpoint",
    destination: "Xin Cai Fu Factory, Phnom Penh SEZ",
    milestone: "at_factory",
    dispatched_at: "2026-11-19T13:00:00Z",
    eta: "2026-11-19T20:30:00Z",
    notes: "Unloading raw fabric at factory bay 2",
  },
  {
    id: "trip-3",
    trip_number: "TRIP-2026-079",
    shipment_ref: "RCLY26113284",
    company_name: "XIN CAI FU",
    direction: "inbound",
    truck_plate: "Phnom Penh 3F-5678",
    trailer_plate: "4A-9912",
    driver_name: "Chhorn Chantha",
    driver_phone: "098 765 432",
    container_no: "SITU3928104",
    seal_no: "SL-019284",
    origin: "Phnom Penh Autonomous Port (LM17)",
    destination: "Xin Cai Fu Factory, Phnom Penh SEZ",
    milestone: "empty_returned",
    dispatched_at: "2026-11-18T09:00:00Z",
    eta: "2026-11-18T16:00:00Z",
    notes: "Empty container returned to SITC depot on time. No detention incurred.",
  },
  {
    id: "trip-4",
    trip_number: "TRIP-2026-082",
    shipment_ref: "EXP-2026-004",
    company_name: "XIN CAI FU",
    direction: "outbound",
    truck_plate: "Preah Sihanouk 3A-7890",
    trailer_plate: "4A-6677",
    driver_name: "Heng Dara",
    driver_phone: "010 332 211",
    container_no: "MRKU8829103",
    seal_no: "MSK-772910",
    origin: "Xin Cai Fu Factory, Phnom Penh SEZ",
    destination: "PAS (Sihanoukville Port Gate 2)",
    milestone: "gate_out",
    dispatched_at: "2026-11-20T09:00:00Z",
    eta: "2026-11-20T17:30:00Z",
    notes: "Finished garment export for US market · GDCE export clearance complete",
  },
];

const VEHICLES_KEY = "shipping_fleet_vehicles_v1";
const DRIVERS_KEY = "shipping_fleet_drivers_v1";
const DISPATCHES_KEY = "shipping_fleet_dispatches_v1";

export function loadVehicles(): Vehicle[] {
  if (typeof window === "undefined") return DEFAULT_VEHICLES;
  try {
    const raw = localStorage.getItem(VEHICLES_KEY);
    if (raw) return JSON.parse(raw);
    localStorage.setItem(VEHICLES_KEY, JSON.stringify(DEFAULT_VEHICLES));
  } catch {}
  return DEFAULT_VEHICLES;
}

export function saveVehicle(vehicle: Vehicle): Vehicle[] {
  const current = loadVehicles();
  const index = current.findIndex((v) => v.id === vehicle.id);
  const next = index >= 0
    ? current.map((v) => (v.id === vehicle.id ? vehicle : v))
    : [vehicle, ...current];
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(VEHICLES_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
  return next;
}

export function deleteVehicle(id: string): Vehicle[] {
  const current = loadVehicles();
  const next = current.filter((v) => v.id !== id);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(VEHICLES_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
  return next;
}

export function loadDrivers(): Driver[] {
  if (typeof window === "undefined") return DEFAULT_DRIVERS;
  try {
    const raw = localStorage.getItem(DRIVERS_KEY);
    if (raw) return JSON.parse(raw);
    localStorage.setItem(DRIVERS_KEY, JSON.stringify(DEFAULT_DRIVERS));
  } catch {}
  return DEFAULT_DRIVERS;
}

export function saveDriver(driver: Driver): Driver[] {
  const current = loadDrivers();
  const index = current.findIndex((d) => d.id === driver.id);
  const next = index >= 0
    ? current.map((d) => (d.id === driver.id ? driver : d))
    : [driver, ...current];
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(DRIVERS_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
  return next;
}

export function deleteDriver(id: string): Driver[] {
  const current = loadDrivers();
  const next = current.filter((d) => d.id !== id);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(DRIVERS_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
  return next;
}

export function loadDispatches(): DispatchTrip[] {
  if (typeof window === "undefined") return DEFAULT_DISPATCHES;
  try {
    const raw = localStorage.getItem(DISPATCHES_KEY);
    if (raw) return JSON.parse(raw);
    localStorage.setItem(DISPATCHES_KEY, JSON.stringify(DEFAULT_DISPATCHES));
  } catch {}
  return DEFAULT_DISPATCHES;
}

export function saveDispatch(trip: DispatchTrip): DispatchTrip[] {
  const current = loadDispatches();
  const index = current.findIndex((t) => t.id === trip.id);
  const next = index >= 0
    ? current.map((t) => (t.id === trip.id ? trip : t))
    : [trip, ...current];
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(DISPATCHES_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
  return next;
}

export function updateDispatchMilestone(
  id: string,
  milestone: TripMilestone
): DispatchTrip[] {
  const current = loadDispatches();
  const next = current.map((t) => (t.id === id ? { ...t, milestone } : t));
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(DISPATCHES_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
  return next;
}
