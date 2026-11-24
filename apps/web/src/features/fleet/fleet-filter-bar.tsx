"use client";

import React, { useMemo } from "react";
import { ListFilter, SlidersHorizontal, ChevronDown, Check, X } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ColumnOption {
  id: string;
  label: string;
  visible: boolean;
}

export interface FilterOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  dotColor?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}

export interface FilterCategoryGroup<T extends string = string> {
  id: string;
  label: string;
  value: T;
  onToggle: (value: T) => void;
  options: FilterOption<T>[];
}

export interface FleetFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  categories: FilterCategoryGroup[];
  columns?: ColumnOption[];
  onToggleColumn?: (id: string) => void;
  onReset?: () => void;
  hasActiveFilters?: boolean;
  className?: string;
}

export function FleetFilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  categories,
  columns,
  onToggleColumn,
  onReset,
  hasActiveFilters = false,
  className,
}: FleetFilterBarProps) {
  // Count how many non-"all" filters are currently selected
  const activeCategoriesCount = useMemo(() => {
    return categories.filter((c) => c.value !== "all").length;
  }, [categories]);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2.5 py-1 bg-transparent",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
        {/* Search Bar: outside table, white background */}
        <SearchInput
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          containerClassName="w-full sm:w-64 md:w-72 shrink-0"
          className="h-8 text-xs bg-white dark:bg-card border-input hover:border-border focus:bg-white dark:focus:bg-card shadow-xs"
        />

        {/* 1. All-in-one Filter button (no bg, no border, dropdown with checkboxes) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground border-0 shadow-none bg-transparent hover:bg-muted/60 transition-colors",
                activeCategoriesCount > 0 && "text-foreground font-semibold"
              )}
            >
              <ListFilter size={13} className="shrink-0 text-muted-foreground" />
              <span>Filter</span>
              {activeCategoriesCount > 0 && (
                <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground font-semibold">
                  {activeCategoriesCount}
                </span>
              )}
              <ChevronDown size={11} className="opacity-60 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 p-1">
            {categories.map((cat, idx) => (
              <React.Fragment key={cat.id}>
                {idx > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider px-2 py-1">
                  {cat.label}
                </DropdownMenuLabel>
                {cat.options.map((opt) => {
                  const isChecked = cat.value === opt.value;
                  const Icon = opt.icon;

                  return (
                    <DropdownMenuItem
                      key={opt.value}
                      onClick={() => cat.onToggle(opt.value)}
                      className={cn(
                        "flex items-center justify-between text-xs px-2.5 py-1.5 cursor-pointer rounded-md transition-colors",
                        isChecked
                          ? "bg-accent/60 font-semibold text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        {opt.dotColor && (
                          <span
                            className={cn(
                              "size-1.5 rounded-full shrink-0",
                              opt.dotColor
                            )}
                          />
                        )}
                        {Icon && <Icon size={11} className="shrink-0" />}
                        <span className="truncate">{opt.label}</span>
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {opt.count !== undefined && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {opt.count}
                          </span>
                        )}
                        {isChecked && (
                          <Check size={13} className="text-primary shrink-0 stroke-[2.5]" />
                        )}
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </React.Fragment>
            ))}
            {hasActiveFilters && onReset && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onReset}
                  className="text-xs text-rose-600 dark:text-rose-400 font-medium justify-center"
                >
                  Clear all filters
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 2. Individual Category dropdowns (no bg, no border, modern dropdown - NO CHECKBOX) */}
        {categories.map((category) => {
          const selectedOption = category.options.find(
            (o) => o.value === category.value
          );
          const isFiltered = category.value !== "all";

          return (
            <DropdownMenu key={category.id}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground border-0 shadow-none bg-transparent hover:bg-muted/60 transition-colors",
                    isFiltered && "text-foreground font-semibold"
                  )}
                >
                  <span>
                    {category.label}
                    {isFiltered && selectedOption && (
                      <span className="text-primary font-medium ml-1">
                        : {selectedOption.label}
                      </span>
                    )}
                  </span>
                  <ChevronDown size={11} className="opacity-60 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48 p-1">
                <DropdownMenuLabel className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider px-2 py-1">
                  Filter by {category.label}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {category.options.map((opt) => {
                  const isChecked = category.value === opt.value;
                  const Icon = opt.icon;

                  return (
                    <DropdownMenuItem
                      key={opt.value}
                      onClick={() => category.onToggle(opt.value)}
                      className={cn(
                        "flex items-center justify-between text-xs px-2.5 py-1.5 cursor-pointer rounded-md transition-colors",
                        isChecked
                          ? "bg-accent/60 font-semibold text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        {opt.dotColor && (
                          <span
                            className={cn(
                              "size-1.5 rounded-full shrink-0",
                              opt.dotColor
                            )}
                          />
                        )}
                        {Icon && <Icon size={11} className="shrink-0" />}
                        <span className="truncate">{opt.label}</span>
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {opt.count !== undefined && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {opt.count}
                          </span>
                        )}
                        {isChecked && (
                          <Check size={13} className="text-primary shrink-0 stroke-[2.5]" />
                        )}
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}

        {/* 3. Customize button (no bg, no border, dropdown with checkboxes for visible columns) */}
        {columns && columns.length > 0 && onToggleColumn && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground border-0 shadow-none bg-transparent hover:bg-muted/60 transition-colors"
              >
                <SlidersHorizontal size={13} className="shrink-0 text-muted-foreground" />
                <span>Customize</span>
                <ChevronDown size={11} className="opacity-60 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52 p-1 max-h-72 overflow-y-auto">
              <DropdownMenuLabel className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider px-2 py-1">
                Visible Columns
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {columns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.visible}
                  onCheckedChange={() => onToggleColumn(col.id)}
                  className="text-xs"
                >
                  <span className="truncate">{col.label}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Reset button when filters are active */}
        {hasActiveFilters && onReset && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground border-0 shadow-none bg-transparent hover:bg-muted/60"
          >
            <X size={12} className="mr-1" />
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
