import type { Metadata } from "next";
import ReviewDetail from "../page";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ caseId: string }>;
}): Promise<Metadata> {
  const { caseId } = await params;
  return { title: `Review ${caseId.slice(0, 8)} · Verification` };
}

export default async function VerificationRoute({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return ReviewDetail({
    params,
    searchParams,
    defaultTab: "verification",
  });
}
