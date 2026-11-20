"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      title="Refresh"
      aria-label="Refresh"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RotateCw aria-hidden className={cn("size-4", pending && "animate-spin")} />
    </Button>
  );
}
