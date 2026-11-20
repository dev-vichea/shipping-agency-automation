"use client";

import type { ComponentProps } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

const Select = Primitive.Root;
const SelectValue = Primitive.Value;
const SelectItemText = Primitive.ItemText;

function SelectTrigger({ className, children, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger className={cn(
    "control inline-flex cursor-pointer items-center gap-2 text-left font-medium motion-safe:transition-colors hover:bg-muted [&_[data-slot=select-label]]:truncate [&_[data-slot=select-label]]:min-w-0",
    className,
  )} {...props}>
    {children}
    <Primitive.Icon asChild><ChevronDown size={14} className="ml-auto shrink-0 text-muted-foreground" aria-hidden /></Primitive.Icon>
  </Primitive.Trigger>;
}

function SelectContent({ className, children, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal>
    <Primitive.Content position="popper" sideOffset={6} className={cn(
      "ui-popup z-60 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-card p-1 text-foreground shadow-menu",
      className,
    )} {...props}>
      <Primitive.ScrollUpButton className="grid h-6 place-items-center"><ChevronUp size={14} aria-hidden /></Primitive.ScrollUpButton>
      <Primitive.Viewport>{children}</Primitive.Viewport>
      <Primitive.ScrollDownButton className="grid h-6 place-items-center"><ChevronDown size={14} aria-hidden /></Primitive.ScrollDownButton>
    </Primitive.Content>
  </Primitive.Portal>;
}

function SelectItem({
  className,
  children,
  hasCustomText = false,
  ...props
}: ComponentProps<typeof Primitive.Item> & { hasCustomText?: boolean }) {
  return <Primitive.Item className={cn(
    "relative flex min-h-8 cursor-pointer select-none items-center rounded-md py-1.5 pr-8 pl-2 outline-none data-highlighted:bg-accent data-disabled:opacity-50",
    className,
  )} {...props}>
    {hasCustomText ? children : <Primitive.ItemText>{children}</Primitive.ItemText>}
    <Primitive.ItemIndicator className="absolute right-2 text-primary"><Check size={14} aria-hidden /></Primitive.ItemIndicator>
  </Primitive.Item>;
}

export { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue };
