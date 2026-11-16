import type { Metadata } from "next";
import { IntakeQueue, type QueueParams } from "@/components/intake-queue";

export const metadata: Metadata = { title: "AI Review Center" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<QueueParams> }) {
  return <IntakeQueue mode="review" params={await searchParams} />;
}
