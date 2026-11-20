import type { Metadata } from "next";
import { ReviewCase } from "@/features/review/review-case";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ caseId: string }>;
}): Promise<Metadata> {
  const { caseId } = await params;
  return { title: `Review ${caseId.slice(0, 8)} · Verification` };
}

export default async function VerificationRoute({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <ReviewCase caseId={caseId} initialTab="verification" />;
}
