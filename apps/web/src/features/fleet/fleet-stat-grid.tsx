import React from "react";
import { cn } from "@/lib/utils";

export interface FleetStatItem {
  id?: string;
  label: string;
  value: number | string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconColor?: string;
  active?: boolean;
  onClick?: () => void;
}

export interface FleetStatGridProps {
  items: FleetStatItem[];
  className?: string;
}

export function FleetStatGrid({ items, className }: FleetStatGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 sm:grid-cols-4 rounded-lg border bg-card shadow-xs divide-y sm:divide-y-0 sm:divide-x divide-border gap-0 overflow-hidden",
        className
      )}
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        const isClickable = Boolean(item.onClick);

        return (
          <div
            key={item.id ?? item.label ?? index}
            role={isClickable ? "button" : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onClick={item.onClick}
            onKeyDown={
              isClickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      item.onClick?.();
                    }
                  }
                : undefined
            }
            className={cn(
              "flex flex-col justify-between p-3.5 sm:p-4 transition-colors select-none text-left",
              isClickable && "cursor-pointer hover:bg-muted/30 focus-visible:outline-none",
              item.active && "bg-muted/20"
            )}
          >
            <div className="flex items-center justify-between gap-2 text-muted-foreground">
              <span className="text-xs font-medium truncate">{item.label}</span>
              <Icon
                size={16}
                className={cn("shrink-0", item.iconColor ?? "text-muted-foreground/70")}
              />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-foreground">
              {item.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}
