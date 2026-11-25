import type { Metadata } from "next";
import { FleetMonitorView } from "@/features/fleet/fleet-monitor-view";

export const metadata: Metadata = {
  title: "Fleet Radar · Live Operations",
  description: "Real-time multi-shipment dispatch monitor and delivery tracking across Cambodia.",
};

export default function FleetMapPage() {
  return <FleetMonitorView />;
}
