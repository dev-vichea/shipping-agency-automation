import type { ComponentProps } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SearchInput({ containerClassName, className, submitLabel, ...props }: Omit<ComponentProps<typeof Input>, "type"> & { containerClassName?: string; submitLabel?: string }) {
  return <div className={cn("relative min-w-0", containerClassName)}>
    {submitLabel
      ? <Button type="submit" size="icon-xs" variant="ghost" aria-label={submitLabel} className="absolute top-1/2 left-1 -translate-y-1/2"><Search aria-hidden /></Button>
      : <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" aria-hidden />}
    <Input type="search" className={cn("pl-8 motion-safe:transition-[border-color,box-shadow]", className)} {...props} />
  </div>;
}
