import type { Metadata } from "next";
import { IntakeQueue, type QueueParams } from "@/features/intakes/intake-queue";

export const metadata: Metadata = { title: "Smart Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<QueueParams> }) {
  return <IntakeQueue mode="inbox" params={await searchParams} />;
}
