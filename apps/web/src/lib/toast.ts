export type ToastType = "saved" | "updated" | "success" | "error" | "info" | "warning";

export interface ToastOptions {
  id?: string;
  type?: ToastType;
  title?: string;
  description?: string;
  duration?: number;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration: number;
  createdAt: number;
}

type ToastListener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<ToastListener>();

function notify() {
  const current = [...toasts];
  listeners.forEach((listener) => listener(current));
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissToast(id?: string): void {
  if (id) {
    toasts = toasts.filter((t) => t.id !== id);
  } else {
    toasts = [];
  }
  notify();
}

function createToast(type: ToastType, defaultTitle: string, input?: string | ToastOptions): string {
  const options = typeof input === "string" ? { title: input } : (input ?? {});
  const id = options.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const title = options.title ?? defaultTitle;
  const duration = options.duration ?? 3000;

  const item: ToastItem = {
    id,
    type: options.type ?? type,
    title,
    description: options.description,
    duration,
    createdAt: Date.now(),
  };

  // Keep a maximum of 4 active toasts in stack
  toasts = [item, ...toasts.filter((t) => t.id !== id)].slice(0, 4);
  notify();
  return id;
}

export const toast = Object.assign(
  (options: ToastOptions) => createToast(options.type ?? "saved", "Saved!", options),
  {
    saved: (input?: string | ToastOptions) => createToast("saved", "Saved!", input),
    updated: (input?: string | ToastOptions) => createToast("updated", "Updated!", input),
    success: (input?: string | ToastOptions) => createToast("success", "Success!", input),
    error: (input?: string | ToastOptions) => createToast("error", "Error!", input),
    info: (input?: string | ToastOptions) => createToast("info", "Info", input),
    warning: (input?: string | ToastOptions) => createToast("warning", "Warning!", input),
    dismiss: dismissToast,
  }
);

if (typeof window !== "undefined") {
  (window as unknown as { toast?: typeof toast }).toast = toast;
}
