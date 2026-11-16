"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DialogCloseButton } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function RecordDialog({ title, trigger, children, openInitially = false, outline = false }: {
  title: string; trigger: ReactNode; children: ReactNode; openInitially?: boolean; outline?: boolean;
}) {
  return <Sheet defaultOpen={openInitially}>
    <SheetTrigger asChild><Button variant={outline ? "outline" : "default"}>{trigger}</Button></SheetTrigger>
    <SheetContent aria-describedby={undefined}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-5 py-4">
        <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
        <DialogCloseButton />
      </div>
      <div className="p-5">{children}</div>
    </SheetContent>
  </Sheet>;
}
