import type { Metadata } from "next";
import { IntakeQueue, type QueueParams } from "@/features/intakes/intake-queue";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<QueueParams> }) {
  return <IntakeQueue mode="approvals" params={await searchParams} />;
}
