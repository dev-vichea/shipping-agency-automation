"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogCloseButton,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface FormDialogProps {
  title: string;
  description?: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

export function FormDialog({
  title,
  description,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  children,
  className,
}: FormDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const onOpenChange = isControlled ? controlledOnOpenChange : setInternalOpen;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className={cn("max-w-xl p-0 overflow-hidden rounded-xl border bg-card shadow-lg", className)}>
        <div className="flex items-center justify-between border-b px-5 py-4 bg-muted/20">
          <div>
            <DialogTitle className="text-base font-semibold text-foreground">{title}</DialogTitle>
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <DialogCloseButton />
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
