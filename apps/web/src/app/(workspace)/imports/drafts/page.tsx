import type { Metadata } from "next";
import { IntakeQueue, type QueueParams } from "@/components/intake-queue";

export const metadata: Metadata = { title: "Draft import records" };

export default async function DraftsPage({ searchParams }: { searchParams: Promise<QueueParams> }) {
  return <IntakeQueue mode="drafts" params={await searchParams} />;
}
