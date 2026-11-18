"use client";

import { useEffect, useState } from "react";
import {
  dismissToast,
  subscribeToasts,
  toast,
  type ToastItem,
  type ToastOptions,
  type ToastType,
} from "@/lib/toast";

export function useToast() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts(setItems);
  }, []);

  return { toasts: items, toast, dismiss: dismissToast };
}

export { Toaster } from "@/components/ui/toaster";
export { toast, dismissToast };
export type { ToastItem, ToastOptions, ToastType };
