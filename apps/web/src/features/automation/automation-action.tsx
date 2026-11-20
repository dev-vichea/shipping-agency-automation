"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-field";
import { write } from "@/lib/client-api";
import { toast } from "@/lib/toast";
import { useFormSubmission } from "@/lib/use-form-submission";

export function AutomationAction({ path, children }: { path: string; children: ReactNode }) {
  const router = useRouter();
  const { error, busy, submit } = useFormSubmission();
  return <div><Button variant="outline" size="sm" disabled={busy} onClick={() => void submit(async () => {
    await write(path);
    toast.updated("Queued run");
    router.refresh();
  })}>{busy ? "Queuing…" : children}</Button><FormError error={error} /></div>;
}
