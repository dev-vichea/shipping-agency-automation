"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DialogCloseButton } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function RecordDialog({
  title,
  trigger,
  children,
  openInitially = false,
  outline = false,
  size = "default",
  buttonTitle,
}: {
  title: string;
  trigger: ReactNode;
  children: ReactNode;
  openInitially?: boolean;
  outline?: boolean;
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
  buttonTitle?: string;
}) {
  return <Sheet defaultOpen={openInitially}>
    <SheetTrigger asChild>
      <Button
        variant={outline ? "outline" : "default"}
        size={size}
        title={buttonTitle}
        aria-label={buttonTitle}
      >
        {trigger}
      </Button>
    </SheetTrigger>
    <SheetContent aria-describedby={undefined}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-5 py-4">
        <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
        <DialogCloseButton />
      </div>
      <div className="p-5">{children}</div>
    </SheetContent>
  </Sheet>;
}
