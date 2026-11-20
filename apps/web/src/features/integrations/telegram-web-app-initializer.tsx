"use client";

import { useTelegramWebApp } from "@/features/integrations/use-telegram-web-app";

export function TelegramWebAppInitializer() {
  useTelegramWebApp();
  return null;
}
