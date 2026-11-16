import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function NativeSelect({ className, containerClassName, ...props }: ComponentProps<"select"> & { containerClassName?: string }) {
  return <span className={cn("relative inline-grid min-w-0", containerClassName)}>
    <select className={cn("control w-full cursor-pointer appearance-none pr-7 motion-safe:transition-colors hover:bg-muted", className)} {...props} />
    <ChevronDown size={13} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" aria-hidden />
  </span>;
}
