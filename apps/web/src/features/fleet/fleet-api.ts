import { apiRequest } from "@/lib/client-api";
import type { Vehicle, Driver, DispatchTrip } from "@/lib/contracts";

export async function fetchVehicles(params?: {
  q?: string;
  status?: string;
  haulier_type?: string;
}): Promise<Vehicle[]> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.status && params.status !== "all") search.set("status", params.status);
  if (params?.haulier_type && params.haulier_type !== "all") {
    search.set("haulier_type", params.haulier_type);
  }
  const query = search.toString();
  return apiRequest<Vehicle[]>(`/fleet/vehicles${query ? `?${query}` : ""}`);
}

export async function createVehicle(payload: Partial<Vehicle>): Promise<Vehicle> {
  return apiRequest<Vehicle>("/fleet/vehicles", "POST", payload);
}

export async function updateVehicle(id: string, updates: Partial<Vehicle>): Promise<Vehicle> {
  return apiRequest<Vehicle>(`/fleet/vehicles/${encodeURIComponent(id)}`, "PATCH", updates);
}

export async function removeVehicle(id: string): Promise<void> {
  return apiRequest<void>(`/fleet/vehicles/${encodeURIComponent(id)}`, "DELETE");
}

export async function fetchDrivers(params?: {
  q?: string;
  status?: string;
}): Promise<Driver[]> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.status && params.status !== "all") search.set("status", params.status);
  const query = search.toString();
  return apiRequest<Driver[]>(`/fleet/drivers${query ? `?${query}` : ""}`);
}

export async function createDriver(payload: Partial<Driver>): Promise<Driver> {
  return apiRequest<Driver>("/fleet/drivers", "POST", payload);
}

export async function updateDriver(id: string, updates: Partial<Driver>): Promise<Driver> {
  return apiRequest<Driver>(`/fleet/drivers/${encodeURIComponent(id)}`, "PATCH", updates);
}

export async function removeDriver(id: string): Promise<void> {
  return apiRequest<void>(`/fleet/drivers/${encodeURIComponent(id)}`, "DELETE");
}

export async function fetchDispatches(params?: {
  q?: string;
  direction?: string;
  milestone?: string;
}): Promise<DispatchTrip[]> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.direction && params.direction !== "all") search.set("direction", params.direction);
  if (params?.milestone && params.milestone !== "all") search.set("milestone", params.milestone);
  const query = search.toString();
  return apiRequest<DispatchTrip[]>(`/fleet/dispatches${query ? `?${query}` : ""}`);
}

export async function fetchFleetTracking(params?: {
  q?: string;
  shipment_ref?: string;
}): Promise<DispatchTrip[]> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.shipment_ref) search.set("shipment_ref", params.shipment_ref);
  const query = search.toString();
  return apiRequest<DispatchTrip[]>(`/fleet/tracking${query ? `?${query}` : ""}`);
}

export async function createDispatch(payload: Partial<DispatchTrip>): Promise<DispatchTrip> {
  return apiRequest<DispatchTrip>("/fleet/dispatches", "POST", payload);
}

export async function updateDispatch(
  id: string,
  updates: Partial<DispatchTrip>
): Promise<DispatchTrip> {
  return apiRequest<DispatchTrip>(`/fleet/dispatches/${encodeURIComponent(id)}`, "PATCH", updates);
}

export async function removeDispatch(id: string): Promise<void> {
  return apiRequest<void>(`/fleet/dispatches/${encodeURIComponent(id)}`, "DELETE");
}
