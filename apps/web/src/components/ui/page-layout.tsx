import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { label } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PageHeading({ title, description, action, code = false }: {
  title: string; description?: string; action?: ReactNode; code?: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 pb-1">
      <div className="min-w-0">
        <h1 className={cn("break-words text-headline-xl", code && "font-mono")}>{title}</h1>
        {description && <p className="text-body-md text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </header>
  );
}

const statusStyle: Record<string, string> = {
  success: "bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  warning: "bg-amber-100/90 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  danger: "bg-rose-100/80 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
  pending: "bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  neutral: "bg-slate-100 text-slate-600 dark:bg-slate-800/70 dark:text-slate-400",
  intelligence: "bg-purple-100/80 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300",
};

const statusTone: Record<string, keyof typeof statusStyle> = {
  pass: "success", succeeded: "success", ready: "success", extracted: "intelligence",
  warning: "warning", uncertain: "warning", needs_review: "warning", partial: "warning",
  awaiting_updated_document: "warning", manual_matching: "warning",
  approved: "success", ready_for_approval: "success", reviewed: "success", authorized: "success",
  rejected: "danger",
  mismatch: "danger", failed: "danger", invalid_output: "danger",
  queued: "pending", running: "intelligence", processing: "intelligence", pending: "pending",
};

const singleWordLabel: Record<string, string> = {
  needs_review: "Review",
  uncertain: "Uncertain",
  warning: "Warning",
  partial: "Partial",
  pass: "Pass",
  succeeded: "Succeeded",
  ready: "Ready",
  ready_for_approval: "Ready",
  awaiting_updated_document: "Awaiting Doc",
  manual_matching: "Manual Match",
  approved: "Approved",
  reviewed: "Reviewed",
  authorized: "Authorized",
  rejected: "Rejected",
  failed: "Failed",
  mismatch: "Mismatch",
  invalid_output: "Invalid",
  queued: "Queued",
  running: "Running",
  processing: "Processing",
  pending: "Pending",
  extracted: "Extracted",
  previous_analysis: "Previous",
  unsubmitted: "Draft",
  simulated: "Simulated",
};

export function Status({ value }: { value: string }) {
  const key = value.toLowerCase();
  const color = statusStyle[statusTone[key] ?? "neutral"];
  const text = singleWordLabel[key] ?? label(key).trim().split(/\s+/)[0] ?? key;
  return <Badge className={cn("border-0", color)}>
    {text}
  </Badge>;
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-24 place-items-center bg-background px-4 py-5 text-center text-body-sm text-muted-foreground">
      <div className="grid justify-items-center gap-2">
        <FileText aria-hidden size={18} className="text-ghost" />
        <div className="max-w-sm">{children}</div>
      </div>
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-heading">
        <h2 className="text-headline-sm">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
