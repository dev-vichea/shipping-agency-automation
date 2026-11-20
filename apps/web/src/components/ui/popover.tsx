"use client";

import type { ComponentProps } from "react";
import { Popover as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

const Popover = Primitive.Root;
const PopoverTrigger = Primitive.Trigger;
const PopoverAnchor = Primitive.Anchor;
const PopoverClose = Primitive.Close;

function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "ui-popup z-60 min-w-72 max-w-[calc(100vw-1rem)] rounded-lg border bg-card p-3 text-foreground shadow-menu outline-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverClose };
