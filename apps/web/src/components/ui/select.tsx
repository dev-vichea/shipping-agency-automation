"use client";

import type { ComponentProps } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

const Select = Primitive.Root;
const SelectGroup = Primitive.Group;
const SelectValue = Primitive.Value;
const SelectItemText = Primitive.ItemText;

function SelectTrigger({ className, children, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={cn(
        "control inline-flex cursor-pointer items-center justify-between gap-2 text-left font-normal motion-safe:transition-colors hover:bg-muted [&_[data-slot=select-label]]:truncate [&_[data-slot=select-label]]:min-w-0",
        className
      )}
      {...props}
    >
      {children}
      <Primitive.Icon asChild>
        <ChevronDown size={14} className="ml-auto shrink-0 text-muted-foreground opacity-70" aria-hidden />
      </Primitive.Icon>
    </Primitive.Trigger>
  );
}

function SelectScrollUpButton({ className, ...props }: ComponentProps<typeof Primitive.ScrollUpButton>) {
  return (
    <Primitive.ScrollUpButton className={cn("grid h-6 place-items-center cursor-default", className)} {...props}>
      <ChevronUp size={14} aria-hidden />
    </Primitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({ className, ...props }: ComponentProps<typeof Primitive.ScrollDownButton>) {
  return (
    <Primitive.ScrollDownButton className={cn("grid h-6 place-items-center cursor-default", className)} {...props}>
      <ChevronDown size={14} aria-hidden />
    </Primitive.ScrollDownButton>
  );
}

function SelectContent({ className, children, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        position="popper"
        sideOffset={6}
        className={cn(
          "ui-popup z-60 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-card p-1 text-foreground shadow-menu",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <Primitive.Viewport className="p-1">{children}</Primitive.Viewport>
        <SelectScrollDownButton />
      </Primitive.Content>
    </Primitive.Portal>
  );
}

function SelectLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn("px-2 py-1.5 text-xs font-semibold text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectSeparator({ className, ...props }: ComponentProps<typeof Primitive.Separator>) {
  return (
    <Primitive.Separator
      className={cn("-mx-1 my-1 h-px bg-muted", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  hasCustomText = false,
  ...props
}: ComponentProps<typeof Primitive.Item> & { hasCustomText?: boolean }) {
  return (
    <Primitive.Item
      className={cn(
        "relative flex min-h-8 cursor-pointer select-none items-center rounded-md py-1.5 pr-8 pl-2 text-xs outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {hasCustomText ? children : <Primitive.ItemText>{children}</Primitive.ItemText>}
      <Primitive.ItemIndicator className="absolute right-2 text-primary">
        <Check size={14} aria-hidden />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectItemText,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
