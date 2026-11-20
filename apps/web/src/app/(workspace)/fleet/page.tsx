import type { Metadata } from "next";
import { FleetVehiclesView } from "@/features/fleet/fleet-vehicles-view";

export const metadata: Metadata = {
  title: "Vehicles & Equipment · Fleet",
  description: "Monitor trucks, trailers, carrier fleets, and direct driver assignments.",
};

export default function FleetVehiclesPage() {
  return <FleetVehiclesView />;
}
