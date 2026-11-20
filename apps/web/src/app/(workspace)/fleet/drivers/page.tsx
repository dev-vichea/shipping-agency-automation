import type { Metadata } from "next";
import { FleetDriversView } from "@/features/fleet/fleet-drivers-view";

export const metadata: Metadata = {
  title: "Drivers Directory · Fleet",
  description: "Manage registered drivers, contact numbers, and vehicle assignments.",
};

export default function FleetDriversPage() {
  return <FleetDriversView />;
}
