import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading, Section } from "@/components/workspace";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage() {
  return <>
    <PageHeading title="Review" description="Open an intake from the Inbox to inspect source messages and download originals." />
    <Section title="Review workspace">
      <div className="space-y-4 p-5 text-sm">
        <p className="text-muted-foreground">Extracted fields, comparison findings, and approval actions will appear here when those workflows are available.</p>
        <Link className="font-medium text-primary hover:underline" href="/inbox">Open Inbox</Link>
      </div>
    </Section>
  </>;
}
