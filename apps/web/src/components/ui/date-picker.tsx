"use client";

import { useMemo, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DateFormat = "DD/MM/YYYY" | "YYYY-MM-DD" | "DD-MMM-YYYY" | "MM/DD/YYYY";

const FORMAT_OPTIONS: { label: string; value: DateFormat; sample: string }[] = [
  { label: "DD/MM/YYYY", value: "DD/MM/YYYY", sample: "13/11/2026" },
  { label: "YYYY-MM-DD", value: "YYYY-MM-DD", sample: "2026-11-13" },
  { label: "DD-MMM-YYYY", value: "DD-MMM-YYYY", sample: "13-Nov-2026" },
  { label: "MM/DD/YYYY", value: "MM/DD/YYYY", sample: "11/13/2026" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function parseDateString(str: string): { date: Date; detectedFormat: DateFormat } | null {
  if (!str || !str.trim()) return null;
  const s = str.trim();

  // 1. Try ISO YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    const dt = new Date(y, m, d);
    if (!isNaN(dt.getTime()) && dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d) {
      return { date: dt, detectedFormat: "YYYY-MM-DD" };
    }
  }

  // 2. Try DD-MMM-YYYY or DD MMM YYYY (e.g., 13-Nov-2026)
  const mmmMatch = s.match(/^(\d{1,2})[- /]([A-Za-z]{3,})[- /](\d{4})$/);
  if (mmmMatch) {
    const d = parseInt(mmmMatch[1], 10);
    const mStr = mmmMatch[2].slice(0, 3).toLowerCase();
    const m = MONTH_SHORT.findIndex((name) => name.toLowerCase() === mStr);
    const y = parseInt(mmmMatch[3], 10);
    if (m >= 0) {
      const dt = new Date(y, m, d);
      if (!isNaN(dt.getTime())) return { date: dt, detectedFormat: "DD-MMM-YYYY" };
    }
  }

  // 3. Try DD/MM/YYYY vs MM/DD/YYYY
  const slashMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (slashMatch) {
    const part1 = parseInt(slashMatch[1], 10);
    const part2 = parseInt(slashMatch[2], 10);
    const y = parseInt(slashMatch[3], 10);

    if (part1 > 12 && part2 <= 12) {
      const dt = new Date(y, part2 - 1, part1);
      if (!isNaN(dt.getTime())) return { date: dt, detectedFormat: "DD/MM/YYYY" };
    }
    if (part2 > 12 && part1 <= 12) {
      const dt = new Date(y, part1 - 1, part2);
      if (!isNaN(dt.getTime())) return { date: dt, detectedFormat: "MM/DD/YYYY" };
    }
    // Default to DD/MM/YYYY for international shipping standards
    const dt = new Date(y, part2 - 1, part1);
    if (!isNaN(dt.getTime())) return { date: dt, detectedFormat: "DD/MM/YYYY" };
  }

  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) {
    return { date: fallback, detectedFormat: "DD/MM/YYYY" };
  }
  return null;
}

export function formatDate(dt: Date, format: DateFormat): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const mmm = MONTH_SHORT[dt.getMonth()];

  switch (format) {
    case "YYYY-MM-DD":
      return `${y}-${m}-${d}`;
    case "DD-MMM-YYYY":
      return `${d}-${mmm}-${y}`;
    case "MM/DD/YYYY":
      return `${m}/${d}/${y}`;
    case "DD/MM/YYYY":
    default:
      return `${d}/${m}/${y}`;
  }
}

export type DateSourceOption = {
  value: string;
  label: string;
  badge?: string;
};

export interface DatePickerProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  error?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  sourceOptions?: DateSourceOption[];
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function DatePicker({
  id,
  name,
  value,
  onChange,
  disabled = false,
  readOnly = false,
  error,
  placeholder = "DD/MM/YYYY",
  ariaLabel = "Date picker",
  className,
  sourceOptions = [],
  onFocus,
  onBlur,
  onKeyDown,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [activeFormat, setActiveFormat] = useState<DateFormat>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("harborway:preferred-date-format") as DateFormat;
      if (saved && FORMAT_OPTIONS.some((f) => f.value === saved)) return saved;
    }
    const parsed = parseDateString(value);
    return parsed?.detectedFormat ?? "DD/MM/YYYY";
  });

  const parsed = useMemo(() => parseDateString(value), [value]);

  const [viewDate, setViewDate] = useState<Date>(() => parsed?.date ?? new Date());

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && parsed?.date) {
      setViewDate(parsed.date);
    }
    setOpen(nextOpen);
  };

  const handleFormatChange = (newFormat: DateFormat) => {
    setActiveFormat(newFormat);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("harborway:preferred-date-format", newFormat);
    }
    if (parsed?.date) {
      const formatted = formatDate(parsed.date, newFormat);
      onChange(formatted);
    }
  };

  const handleSelectDate = (date: Date) => {
    const formatted = formatDate(date, activeFormat);
    onChange(formatted);
    setOpen(false);
  };

  const handleClear = () => {
    onChange("");
    setOpen(false);
  };

  const handleToday = () => {
    const today = new Date();
    handleSelectDate(today);
  };

  // Calendar math
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const prevMonthDays = Array.from({ length: firstDayOfWeek }, (_, i) => ({
    day: daysInPrevMonth - firstDayOfWeek + i + 1,
    date: new Date(year, month - 1, daysInPrevMonth - firstDayOfWeek + i + 1),
    isCurrentMonth: false,
  }));

  const currentMonthDays = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    date: new Date(year, month, i + 1),
    isCurrentMonth: true,
  }));

  const totalGridCells = 42; // 6 rows * 7 days
  const remainingCells = totalGridCells - (prevMonthDays.length + currentMonthDays.length);
  const nextMonthDays = Array.from({ length: remainingCells }, (_, i) => ({
    day: i + 1,
    date: new Date(year, month + 1, i + 1),
    isCurrentMonth: false,
  }));

  const calendarDays = [...prevMonthDays, ...currentMonthDays, ...nextMonthDays];

  const isToday = (d: Date) => {
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };

  const isSelected = (d: Date) => {
    if (!parsed?.date) return false;
    return (
      d.getFullYear() === parsed.date.getFullYear() &&
      d.getMonth() === parsed.date.getMonth() &&
      d.getDate() === parsed.date.getDate()
    );
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        <div className={cn("relative flex items-center w-full min-w-0", className)}>
          <input
            id={id}
            name={name}
            type="text"
            aria-label={ariaLabel}
            value={value}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onFocus={(e) => {
              onFocus?.(e);
            }}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            className={cn(
              "h-8 w-full rounded-md border border-border/80 bg-white dark:bg-slate-900 shadow-2xs hover:border-primary/50 hover:shadow-xs focus:border-primary focus:ring-1 focus:ring-primary/40 focus:shadow-xs pl-2.5 pr-8 text-xs text-foreground outline-none transition-all duration-150 cursor-text font-mono tabular-nums",
              error && "border-destructive bg-destructive/5"
            )}
          />
          <button
            type="button"
            disabled={disabled || readOnly}
            tabIndex={-1}
            onClick={() => setOpen((prev) => !prev)}
            aria-label="Open calendar"
            className="absolute right-2 p-0.5 rounded text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
          >
            <CalendarIcon className="size-3.5" />
          </button>
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[300px] p-3 shadow-menu rounded-xl border border-border bg-card text-card-foreground"
      >
        <div className="space-y-3">
          {/* Format selector */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              <span>Date Format</span>
              <span className="font-mono text-primary font-bold">{activeFormat}</span>
            </div>
            <div className="grid grid-cols-2 gap-1 bg-muted/50 p-1 rounded-md">
              {FORMAT_OPTIONS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => handleFormatChange(f.value)}
                  className={cn(
                    "text-[10px] font-mono py-1 px-1.5 rounded transition-all text-center truncate",
                    activeFormat === f.value
                      ? "bg-background text-primary font-semibold shadow-2xs border border-border/70"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  )}
                  title={`Format: ${f.label} (${f.sample})`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Month & Year Navigation Header */}
          <div className="flex items-center justify-between border-t border-border/60 pt-2">
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setViewDate(new Date(year - 1, month, 1))}
                title="Previous year"
              >
                <ChevronsLeft className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setViewDate(new Date(year, month - 1, 1))}
                title="Previous month"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
            </div>

            <div className="text-xs font-semibold text-foreground select-none">
              {MONTH_NAMES[month]} {year}
            </div>

            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setViewDate(new Date(year, month + 1, 1))}
                title="Next month"
              >
                <ChevronRight className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setViewDate(new Date(year + 1, month, 1))}
                title="Next year"
              >
                <ChevronsRight className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Day of Week Labels */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {DAY_LABELS.map((day) => (
              <span key={day} className="text-[10px] font-semibold text-muted-foreground select-none">
                {day}
              </span>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((item, index) => {
              const selected = isSelected(item.date);
              const today = isToday(item.date);
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => handleSelectDate(item.date)}
                  className={cn(
                    "size-7 rounded-md text-xs font-mono transition-all flex items-center justify-center cursor-pointer select-none",
                    item.isCurrentMonth ? "text-foreground" : "text-muted-foreground/35",
                    today && !selected && "border border-primary/50 font-bold text-primary",
                    selected
                      ? "bg-primary text-primary-foreground font-bold shadow-xs hover:bg-primary/90"
                      : "hover:bg-muted/70 hover:text-foreground"
                  )}
                >
                  {item.day}
                </button>
              );
            })}
          </div>

          {/* Document Sources Suggestions (if available from other documents in the case) */}
          {sourceOptions.length > 0 && (
            <div className="border-t border-border/60 pt-2 space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Document Sources
              </span>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {sourceOptions.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      const p = parseDateString(opt.value);
                      if (p?.date) {
                        handleSelectDate(p.date);
                      } else {
                        onChange(opt.value);
                        setOpen(false);
                      }
                    }}
                    className="w-full flex items-center justify-between text-left p-1.5 rounded-md text-xs hover:bg-muted/60 transition-colors group"
                  >
                    <span className="font-mono font-medium text-foreground">{opt.value}</span>
                    <span className="text-[10px] text-muted-foreground group-hover:text-primary">
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick Actions Footer */}
          <div className="flex items-center justify-between border-t border-border/60 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleClear}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={handleToday}
              className="text-[11px] font-medium"
            >
              Today
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
