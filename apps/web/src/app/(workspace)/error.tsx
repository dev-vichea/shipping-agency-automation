"use client";

import { Button } from "@/components/ui/button";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <div className="panel mx-auto max-w-lg space-y-3 p-4">
    <h1 className="text-headline-lg">Workspace temporarily unavailable</h1>
    <p className="text-body-md text-muted-foreground">The server could not load this view.</p>
    <Button size="sm" onClick={reset}>Try again</Button>
  </div>;
}
