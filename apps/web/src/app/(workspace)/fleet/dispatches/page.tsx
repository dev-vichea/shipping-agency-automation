import type { Metadata } from "next";
import { FleetDispatchesView } from "@/components/fleet-dispatches-view";

export const metadata: Metadata = {
  title: "Active Trips · Fleet",
  description: "Track live container haulage, driver progress, and gate status.",
};

export default function FleetDispatchesPage() {
  return <FleetDispatchesView />;
}
