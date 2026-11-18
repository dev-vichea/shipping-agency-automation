import type { Metadata } from "next";
import { IntakeQueue, type QueueParams } from "@/components/intake-queue";

export const metadata: Metadata = { title: "Import records" };

export default async function DraftsPage({ searchParams }: { searchParams: Promise<QueueParams> }) {
  return <IntakeQueue mode="imports" params={await searchParams} />;
}
