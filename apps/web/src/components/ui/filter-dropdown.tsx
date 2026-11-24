"use client";

import type { ComponentType } from "react";
import { ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface FilterDropdownOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  dotColor?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
}

export interface FilterDropdownProps<T extends string = string> {
  label?: string; // Optional label prefix (e.g. "Source", "Sort", "Status")
  value: T; // Currently selected value
  options: FilterDropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
  align?: "start" | "end" | "center";
}

/**
 * A modern, borderless, background-free single-select dropdown.
 * Uses clean menu items with a checkmark on the right for the active item.
 * Does NOT use square checkboxes because only one option is active at a time.
 */
export function FilterDropdown<T extends string = string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  className,
  align = "start",
}: FilterDropdownProps<T>) {
  const selectedOption = options.find((opt) => opt.value === value);
  const isFiltered = Boolean(value && value !== "" && value !== "all");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground border-0 shadow-none bg-transparent hover:bg-muted/60 transition-colors cursor-pointer",
            isFiltered && "text-foreground font-semibold",
            className
          )}
        >
          <span className="truncate max-w-56 text-left">
            {label ? (
              <>
                <span className="text-muted-foreground font-normal">{label}: </span>
                <span>{selectedOption?.label ?? placeholder ?? label}</span>
              </>
            ) : (
              <span>{selectedOption?.label ?? placeholder ?? "Select…"}</span>
            )}
          </span>
          <ChevronDown size={11} className="opacity-60 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-44 max-w-72 p-1">
        {label && (
          <>
            <DropdownMenuLabel className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider px-2 py-1">
              Filter by {label}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {options.map((opt) => {
          const isSelected = opt.value === value;
          const Icon = opt.icon;

          return (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex items-center justify-between text-xs px-2.5 py-1.5 cursor-pointer rounded-md transition-colors",
                isSelected
                  ? "bg-accent/60 font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-1.5 truncate">
                {opt.dotColor && (
                  <span className={cn("size-1.5 rounded-full shrink-0", opt.dotColor)} />
                )}
                {Icon && <Icon size={12} className="shrink-0" />}
                <span className="truncate">{opt.label}</span>
              </span>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {opt.count !== undefined && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {opt.count}
                  </span>
                )}
                {isSelected && (
                  <Check size={13} className="text-primary shrink-0 stroke-[2.5]" />
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
