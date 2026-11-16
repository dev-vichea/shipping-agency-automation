"use client";

import type { ComponentProps } from "react";
import { X } from "lucide-react";
import { Dialog as Primitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const Dialog = Primitive.Root;
const DialogTrigger = Primitive.Trigger;
const DialogClose = Primitive.Close;
const DialogPortal = Primitive.Portal;
const DialogTitle = Primitive.Title;

function DialogOverlay({ className, ...props }: ComponentProps<typeof Primitive.Overlay>) {
  return <Primitive.Overlay className={cn("ui-overlay fixed inset-0 z-40 bg-foreground/35", className)} {...props} />;
}

function DialogContent({ className, children, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <DialogPortal>
    <DialogOverlay />
    <Primitive.Content className={cn("ui-dialog fixed top-1/2 left-1/2 z-50 max-h-[92dvh] w-[calc(100%_-_2rem)] max-w-lg -translate-1/2 overflow-auto rounded-xl border bg-card shadow-inspector", className)} {...props}>
      {children}
    </Primitive.Content>
  </DialogPortal>;
}

function DialogCloseButton({ label = "Close", className }: { label?: string; className?: string }) {
  return <DialogClose asChild>
    <Button type="button" size="icon-sm" variant="ghost" aria-label={label} className={className}><X aria-hidden /></Button>
  </DialogClose>;
}

export { Dialog, DialogClose, DialogCloseButton, DialogContent, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger };
