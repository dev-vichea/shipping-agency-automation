"use client";

import type { ComponentProps } from "react";
import { Dialog as Primitive } from "radix-ui";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const Sheet = Primitive.Root;
const SheetTrigger = Primitive.Trigger;
const SheetTitle = Primitive.Title;

function SheetContent({ side = "right", children, className, ...props }: ComponentProps<typeof Primitive.Content> & { side?: "left" | "right" }) {
  return <DialogPortal>
    <DialogOverlay />
    <Primitive.Content data-side={side} className={cn(
      "ui-sheet fixed inset-y-0 z-50 max-h-dvh w-full max-w-lg overflow-y-auto bg-card text-foreground shadow-inspector",
      side === "left" ? "left-0 border-r" : "right-0 border-l",
      className,
    )} {...props}>
      {children}
    </Primitive.Content>
  </DialogPortal>;
}

export { Sheet, SheetContent, SheetTitle, SheetTrigger };
