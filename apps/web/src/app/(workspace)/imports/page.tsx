import type { Metadata } from "next";
import { IntakeQueue, type QueueParams } from "@/features/intakes/intake-queue";

export const metadata: Metadata = { title: "Import records" };

export default async function ImportsPage({ searchParams }: {
  searchParams: Promise<QueueParams>;
}) {
  return <IntakeQueue mode="imports" params={await searchParams} />;
}
