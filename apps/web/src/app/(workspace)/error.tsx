"use client";

import { Button } from "@/components/ui/button";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-xl space-y-4 p-8">
    <h1 className="text-2xl font-semibold">Workspace temporarily unavailable</h1>
    <p className="text-muted-foreground">The server could not load this view.</p>
    <Button onClick={reset}>Try again</Button>
  </main>;
}
