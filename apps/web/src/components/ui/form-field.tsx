import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function FormError({ error }: { error: string }) {
  return error && <p role="alert" className="field-error">{error}</p>;
}

export function FormField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="space-y-1"><Label htmlFor={id}>{label}</Label>{children}</div>;
}
