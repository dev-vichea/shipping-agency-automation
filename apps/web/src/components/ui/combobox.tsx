"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Info } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ComboboxOption<T = unknown> {
  value: string;
  label?: string;
  description?: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "outline" | "success" | "warning";
  category?: string;
  icon?: React.ReactNode;
  data?: T;
}

export interface ComboboxProps<T = unknown> {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onSelectOption?: (option: ComboboxOption<T>) => void;
  onClearOption?: () => void;
  options?: ComboboxOption<T>[];

  // Presentation & Variants
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  compact?: boolean;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  numeric?: boolean;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];

  // Dropdown customization
  popoverWidth?: string;
  headerTitle?: string;
  emptyText?: string;
  helpNotice?: string;
  filterOptions?: boolean;
  filterFn?: (option: ComboboxOption<T>, query: string) => boolean;
  selectedOptionValue?: string;
  hasClearButton?: boolean;
  clearButtonText?: string;

  // Behavior
  autoOpenOnFocus?: boolean;
  showWhenEmpty?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;

  // Styling & Events
  className?: string;
  inputClassName?: string;
  error?: string;
  onFocus?: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onInspect?: () => void;
  rightAdornment?: React.ReactNode;
  ariaLabel?: string;
  regionAriaLabel?: string;
}

export interface ComboboxRef {
  focus: () => void;
  blur: () => void;
  element: HTMLInputElement | HTMLTextAreaElement | null;
}

export const Combobox = forwardRef<ComboboxRef, ComboboxProps<unknown>>(
  function Combobox<T = unknown>(
    {
      id,
      name,
      value,
      onChange,
      onSelectOption,
      onClearOption,
      options = [],
      placeholder,
      disabled = false,
      readOnly = false,
      compact = false,
      multiline = false,
      rows = 1,
      maxLength,
      numeric = false,
      type = "text",
      inputMode,
      popoverWidth = "w-[360px]",
      headerTitle,
      emptyText = "No matching options found",
      helpNotice,
      filterOptions = true,
      filterFn,
      selectedOptionValue,
      hasClearButton = false,
      clearButtonText = "Clear selection",
      autoOpenOnFocus = true,
      showWhenEmpty = true,
      open: controlledOpen,
      onOpenChange: setControlledOpen,
      className,
      inputClassName,
      error,
      onFocus,
      onBlur,
      onKeyDown,
      onInspect,
      rightAdornment,
      ariaLabel,
      regionAriaLabel,
    }: ComboboxProps<T>,
    ref: React.Ref<ComboboxRef>
  ) {
    const inputId = useId();
    const effectiveId = id || inputId;
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const isOpen = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
    const setOpen = useCallback(
      (nextOpen: boolean) => {
        if (controlledOpen === undefined) {
          setUncontrolledOpen(nextOpen);
        }
        setControlledOpen?.(nextOpen);
      },
      [controlledOpen, setControlledOpen]
    );

    const [activeIndex, setActiveIndex] = useState<number>(-1);
    const optionsContainerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      element: inputRef.current,
    }));

    // Auto-resize for multiline
    useEffect(() => {
      if (multiline && inputRef.current) {
        inputRef.current.style.height = "auto";
        inputRef.current.style.height = `${Math.max(compact ? 28 : 30, inputRef.current.scrollHeight)}px`;
      }
    }, [value, multiline, compact]);

    // Filtered options based on current value
    const filteredOptions = useMemo(() => {
      if (!filterOptions || !value || !value.trim()) {
        return options;
      }
      const query = (value || "").toLowerCase().trim();
      if (filterFn) {
        return options.filter((opt) => filterFn(opt, query));
      }
      return options.filter((opt) => {
        const valMatch = (opt.value || "").toLowerCase().includes(query);
        const labelMatch = opt.label?.toLowerCase().includes(query);
        const descMatch = opt.description?.toLowerCase().includes(query);
        return valMatch || labelMatch || descMatch;
      });
    }, [options, value, filterOptions, filterFn]);

    // Group options by category if any category exists
    const groupedOptions = useMemo(() => {
      const groups = new Map<string, ComboboxOption<T>[]>();
      for (const opt of filteredOptions) {
        const cat = opt.category || "";
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat)!.push(opt);
      }
      return Array.from(groups.entries()).map(([category, items]) => ({
        category,
        items,
      }));
    }, [filteredOptions]);

    // Reset active index when filtered options change
    useEffect(() => {
      setActiveIndex(-1);
    }, [filteredOptions]);

    // Scroll active item into view
    useEffect(() => {
      if (activeIndex >= 0 && optionsContainerRef.current) {
        const activeEl = optionsContainerRef.current.querySelector(
          `[data-combobox-index="${activeIndex}"]`
        ) as HTMLElement | null;
        if (activeEl) {
          activeEl.scrollIntoView({ block: "nearest" });
        }
      }
    }, [activeIndex]);

    const handleSelect = useCallback(
      (opt: ComboboxOption<T>) => {
        onChange(opt.value);
        onSelectOption?.(opt);
        setOpen(false);
        setActiveIndex(-1);
      },
      [onChange, onSelectOption, setOpen]
    );

    const handleClear = useCallback(() => {
      onClearOption?.();
      setOpen(false);
      setActiveIndex(-1);
    }, [onClearOption, setOpen]);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onFocus?.(e);
      onInspect?.();
      if (autoOpenOnFocus && !disabled && !readOnly) {
        if (options.length > 0 || helpNotice || showWhenEmpty) {
          setOpen(true);
        }
      }
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onBlur?.(e);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onKeyDown?.(e);

      if (disabled || readOnly) return;

      if (!isOpen) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (options.length > 0 || helpNotice || showWhenEmpty) {
            setOpen(true);
          }
          return;
        }
      }

      if (isOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((prev) =>
            prev < filteredOptions.length - 1 ? prev + 1 : 0
          );
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((prev) =>
            prev > 0 ? prev - 1 : filteredOptions.length - 1
          );
        } else if (e.key === "Enter" && activeIndex >= 0 && activeIndex < filteredOptions.length) {
          e.preventDefault();
          handleSelect(filteredOptions[activeIndex]);
        } else if (e.key === "Escape") {
          e.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
        }
      }
    };

    const shouldShowPopover =
      isOpen &&
      (options.length > 0 || !!helpNotice || showWhenEmpty);

    // Flattened index tracker for keyboard navigation across categories
    let globalIndex = -1;

    return (
      <Popover open={shouldShowPopover} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            data-combobox-anchor={effectiveId}
            className={cn("relative flex items-center w-full min-w-0", className)}
          >
            {multiline ? (
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                id={effectiveId}
                name={name}
                role="combobox"
                aria-label={ariaLabel}
                aria-expanded={isOpen}
                aria-controls={`${effectiveId}-listbox`}
                aria-haspopup="listbox"
                value={value}
                readOnly={readOnly}
                disabled={disabled}
                rows={rows}
                maxLength={maxLength}
                placeholder={value ? undefined : placeholder || "—"}
                style={{ fieldSizing: "content" } as React.CSSProperties}
                className={cn(
                  compact
                    ? "min-h-[28px] flex-1 min-w-0 resize-none overflow-hidden rounded border border-transparent bg-transparent hover:border-border/60 hover:bg-background/40 hover:shadow-2xs focus:border-primary focus:bg-background focus:ring-1 focus:ring-primary/40 focus:shadow-xs px-1.5 py-1 text-xs text-foreground outline-none transition-all duration-150 cursor-text leading-snug whitespace-pre-wrap break-words"
                    : "w-full min-h-[30px] resize-none overflow-hidden rounded-md border border-border/80 bg-white dark:bg-slate-900 shadow-2xs hover:border-primary/50 hover:shadow-xs focus:border-primary focus:ring-1 focus:ring-primary/40 focus:shadow-xs px-2.5 py-1.5 text-xs text-foreground outline-none transition-all duration-150 cursor-text leading-snug whitespace-pre-wrap break-words",
                  error && "border-destructive bg-destructive/5",
                  inputClassName
                )}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                onChange={(e) => {
                  onChange(e.target.value);
                  if (!isOpen && (options.length > 0 || helpNotice || showWhenEmpty)) {
                    setOpen(true);
                  }
                }}
              />
            ) : (
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                id={effectiveId}
                name={name}
                role="combobox"
                aria-label={ariaLabel}
                aria-expanded={isOpen}
                aria-controls={`${effectiveId}-listbox`}
                aria-haspopup="listbox"
                type={type}
                inputMode={inputMode}
                value={value}
                readOnly={readOnly}
                disabled={disabled}
                maxLength={maxLength}
                placeholder={value ? undefined : placeholder || "—"}
                className={cn(
                  compact
                    ? "h-7 flex-1 min-w-0 rounded border border-transparent bg-transparent hover:border-border/60 hover:bg-background/40 hover:shadow-2xs focus:border-primary focus:bg-background focus:ring-1 focus:ring-primary/40 focus:shadow-xs px-1.5 text-xs text-foreground outline-none transition-all duration-150 cursor-text"
                    : "h-8 w-full rounded-md border border-border/80 bg-white dark:bg-slate-900 shadow-2xs hover:border-primary/50 hover:shadow-xs focus:border-primary focus:ring-1 focus:ring-primary/40 focus:shadow-xs px-2.5 text-xs text-foreground outline-none transition-all duration-150 cursor-text",
                  numeric ? "font-mono tabular-nums text-right" : "text-left",
                  error && "border-destructive bg-destructive/5",
                  inputClassName
                )}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                onChange={(e) => {
                  onChange(e.target.value);
                  if (!isOpen && (options.length > 0 || helpNotice || showWhenEmpty)) {
                    setOpen(true);
                  }
                }}
              />
            )}

            {rightAdornment}
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={4}
          role="region"
          aria-label={regionAriaLabel || (headerTitle ? `${headerTitle} options` : "Combobox suggestions")}
          className={cn(
            "p-0 shadow-xl border border-border/80 bg-card rounded-lg text-xs z-60",
            popoverWidth
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest?.(`[data-combobox-anchor="${effectiveId}"]`)) {
              e.preventDefault();
            }
          }}
        >
          {headerTitle && (
            <div className="p-2.5 border-b border-border/50 bg-muted/15 flex items-center justify-between">
              <span className="font-semibold text-xs text-foreground">{headerTitle}</span>
              {filteredOptions.length > 0 && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  {filteredOptions.length} available
                </span>
              )}
            </div>
          )}

          {helpNotice && (
            <div className="p-2 border-b border-border/40 bg-amber-500/5 text-amber-700 dark:text-amber-400 text-[10px] leading-relaxed flex items-start gap-1.5">
              <Info className="size-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>{helpNotice}</span>
            </div>
          )}

          <div
            ref={optionsContainerRef}
            id={`${effectiveId}-listbox`}
            className="max-h-56 overflow-y-auto p-1.5 space-y-1"
            role="listbox"
          >
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground space-y-1">
                <p>{emptyText}</p>
                <p className="text-[10px] text-muted-foreground/80">
                  You can type freely to keep custom value.
                </p>
              </div>
            ) : (
              groupedOptions.map((group, groupIdx) => (
                <div key={group.category || groupIdx} className="space-y-0.5">
                  {group.category && (
                    <div className="px-2 py-1 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground bg-muted/20 rounded">
                      {group.category}
                    </div>
                  )}

                  {group.items.map((entry) => {
                    globalIndex++;
                    const currIndex = globalIndex;
                    const isSelected = selectedOptionValue
                      ? selectedOptionValue === entry.value
                      : value === entry.value;
                    const isActive = activeIndex === currIndex;

                    return (
                      <button
                        key={`${entry.value}-${currIndex}`}
                        type="button"
                        data-combobox-index={currIndex}
                        role="option"
                        aria-selected={isSelected}
                        disabled={disabled}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelect(entry)}
                        onMouseEnter={() => setActiveIndex(currIndex)}
                        className={cn(
                          "w-full flex items-start gap-2 p-2 rounded-md text-left transition-colors cursor-pointer outline-none",
                          isActive && "bg-muted/80 ring-1 ring-primary/30",
                          isSelected
                            ? "bg-primary/10 text-primary border border-primary/30"
                            : "hover:bg-muted/60 text-foreground border border-transparent"
                        )}
                      >
                        {entry.icon && (
                          <div className="mt-0.5 shrink-0 text-muted-foreground">
                            {entry.icon}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="font-medium text-[11px] truncate">
                              {entry.label || entry.value}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {entry.badge && (
                                <span
                                  className={cn(
                                    "px-1.5 py-0.2 rounded text-[9px] font-mono font-medium",
                                    entry.badgeVariant === "success"
                                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                      : entry.badgeVariant === "warning"
                                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                      : "bg-muted text-muted-foreground"
                                  )}
                                >
                                  {entry.badge}
                                </span>
                              )}
                              {isSelected && (
                                <Check className="size-3.5 text-primary shrink-0" />
                              )}
                            </div>
                          </div>
                          {entry.description && (
                            <span className="block text-[10px] text-muted-foreground mt-0.5 truncate">
                              {entry.description}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="p-1.5 border-t border-border/40 bg-muted/10 flex items-center justify-between text-[9px] text-muted-foreground">
            <span className="select-none">↑↓ navigate · ↵ select · esc close</span>
            {hasClearButton && selectedOptionValue && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={disabled}
                className="text-[10px] h-5 px-1.5 text-muted-foreground hover:text-destructive"
                onClick={handleClear}
              >
                {clearButtonText}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }
);
Combobox.displayName = "Combobox";
