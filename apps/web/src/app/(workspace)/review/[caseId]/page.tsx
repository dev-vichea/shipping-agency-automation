import type { Metadata } from "next";
import { ReviewCase } from "@/features/review/review-case";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const { caseId } = await params;
  const sp = searchParams ? await searchParams : {};
  const isVerif = sp.tab === "verification";
  return { title: `Review ${caseId.slice(0, 8)}${isVerif ? " · Verification" : ""}` };
}

export default async function ReviewDetail({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ caseId }, query] = await Promise.all([params, searchParams]);
  return <ReviewCase caseId={caseId} initialTab={query?.tab === "verification" ? "verification" : "documents"} />;
}
