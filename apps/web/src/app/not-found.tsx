import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Brand } from "@/features/workspace/brand";

export default function NotFound() {
  return <main className="flex min-h-screen flex-col bg-background">
    <header className="border-b border-border bg-card px-page py-4 text-foreground lg:px-page-desktop"><Brand /></header>
    <div className="grid flex-1 place-items-center p-4">
      <section className="panel w-full max-w-sm space-y-3 p-4">
        <h1 className="text-headline-lg">Page unavailable</h1>
        <p className="text-body-md text-muted-foreground">Open the Inbox to find a shipment or start a new intake.</p>
        <Button asChild size="sm"><Link href="/inbox">Open Inbox</Link></Button>
      </section>
    </div>
  </main>;
}
