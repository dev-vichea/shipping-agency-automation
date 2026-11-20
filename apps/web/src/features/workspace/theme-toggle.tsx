"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): "light" | "dark" {
  try {
    return localStorage.getItem("harborway-theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function getServerSnapshot(): "light" | "dark" {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("harborway-theme", next);
    } catch {
      // Ignore storage errors in private browsing
    }
    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    window.dispatchEvent(new Event("storage"));
  }

  return (
    <Button
      size="icon-sm"
      variant="outline"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded-full border-border/80 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
    >
      {theme === "dark" ? (
        <Sun size={15} aria-hidden className="text-amber-400 hover:text-amber-300" />
      ) : (
        <Moon size={15} aria-hidden />
      )}
    </Button>
  );
}
