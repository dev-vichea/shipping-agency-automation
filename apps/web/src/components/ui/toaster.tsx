"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { dismissToast, subscribeToasts, type ToastItem, type ToastType } from "@/lib/toast";
import { cn } from "@/lib/utils";

function ToastBadge({ type }: { type: ToastType }) {
  switch (type) {
    case "saved":
      return (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#22c55e] text-white shadow-xs"
          aria-hidden="true"
        >
          <Check className="size-3.5 stroke-[3]" />
        </span>
      );
    case "updated":
      return (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#0284c7] text-white shadow-xs"
          aria-hidden="true"
        >
          <Check className="size-3.5 stroke-[3]" />
        </span>
      );
    case "success":
      return (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#10b981] text-white shadow-xs"
          aria-hidden="true"
        >
          <Check className="size-3.5 stroke-[3]" />
        </span>
      );
    case "error":
      return (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#ef4444] text-white shadow-xs"
          aria-hidden="true"
        >
          <X className="size-3.5 stroke-[3]" />
        </span>
      );
    case "warning":
      return (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#f59e0b] text-white shadow-xs"
          aria-hidden="true"
        >
          <AlertTriangle className="size-3 stroke-[2.5]" />
        </span>
      );
    case "info":
    default:
      return (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#64748b] text-white shadow-xs"
          aria-hidden="true"
        >
          <Info className="size-3 stroke-[2.5]" />
        </span>
      );
  }
}

function ToastCard({ item }: { item: ToastItem }) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    if (item.duration <= 0) return;
    timerRef.current = setTimeout(() => {
      setExiting(true);
      setTimeout(() => dismissToast(item.id), 240);
    }, item.duration);
  }, [clearTimer, item.duration, item.id]);

  useEffect(() => {
    startTimer();
    return () => clearTimer();
  }, [startTimer, clearTimer]);

  const handleDismiss = () => {
    clearTimer();
    setExiting(true);
    setTimeout(() => dismissToast(item.id), 240);
  };

  return (
    <div
      role={item.type === "error" ? "alert" : "status"}
      aria-live="polite"
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
      onClick={handleDismiss}
      className={cn(
        "pointer-events-auto relative flex max-w-sm cursor-pointer items-center gap-2.5 rounded-2xl border border-border/80 bg-card/98 px-4 py-2.5 text-foreground shadow-lg backdrop-blur-xs transition-shadow select-none hover:shadow-xl dark:border-border dark:bg-[#161b22]",
        exiting ? "toast-exit" : "toast-enter"
      )}
    >
      <ToastBadge type={item.type} />
      <div className="flex min-w-0 flex-col pr-1">
        <span className="text-sm font-medium tracking-tight text-foreground leading-tight">
          {item.title}
        </span>
        {item.description && (
          <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground leading-normal">
            {item.description}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          handleDismiss();
        }}
        aria-label="Dismiss notification"
        className="ml-auto -mr-1 inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts(setItems);
  }, []);

  if (!items.length) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed top-4 right-4 z-[100] flex flex-col items-end gap-2 pointer-events-none"
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}
