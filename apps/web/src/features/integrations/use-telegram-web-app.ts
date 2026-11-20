"use client";

import { useEffect, useSyncExternalStore } from "react";

export type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  close: () => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  isExpanded?: boolean;
  initData?: string;
  initDataUnsafe?: {
    user?: {
      id?: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    [key: string]: unknown;
  };
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

const emptySubscribe = () => () => {};

function getTelegramSnapshot(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

function getServerSnapshot(): TelegramWebApp | null {
  return null;
}

export function useTelegramWebApp() {
  const app = useSyncExternalStore(emptySubscribe, getTelegramSnapshot, getServerSnapshot);

  useEffect(() => {
    if (app && typeof app.ready === "function") {
      try {
        app.ready();
        app.expand?.();
        app.enableClosingConfirmation?.();
      } catch {
        // Fallback gracefully if WebApp initialization fails in non-Telegram context
      }
    }
  }, [app]);

  const close = () => {
    try {
      app?.close?.();
    } catch {
      // Ignore if close is unavailable
    }
  };

  const hapticSuccess = () => {
    try {
      app?.HapticFeedback?.notificationOccurred("success");
    } catch {
      // Ignore
    }
  };

  const hapticError = () => {
    try {
      app?.HapticFeedback?.notificationOccurred("error");
    } catch {
      // Ignore
    }
  };

  return {
    isTelegram: Boolean(app),
    app,
    close,
    hapticSuccess,
    hapticError,
  };
}
