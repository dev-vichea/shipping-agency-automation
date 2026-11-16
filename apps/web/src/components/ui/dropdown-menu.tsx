"use client";

import type { ComponentProps } from "react";
import { DropdownMenu as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

const DropdownMenu = Primitive.Root;
const DropdownMenuTrigger = Primitive.Trigger;
const DropdownMenuLabel = Primitive.Label;

function DropdownMenuContent({ className, align = "end", sideOffset = 7, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal>
    <Primitive.Content align={align} sideOffset={sideOffset} className={cn(
      "ui-popup z-60 min-w-42 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-card p-1 text-foreground shadow-menu",
      className,
    )} {...props} />
  </Primitive.Portal>;
}

function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item className={cn(
    "flex min-h-9 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-label-lg outline-none data-highlighted:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
    className,
  )} {...props} />;
}

function DropdownMenuSeparator(props: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className="my-1 h-px bg-border" {...props} />;
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger };
