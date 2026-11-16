import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "control block w-full selection:bg-primary selection:text-primary-foreground placeholder:text-ghost",
        "file:mr-2 file:h-6 file:rounded-control file:border-0 file:bg-muted file:px-2 file:text-label-sm file:text-foreground file:cursor-pointer",
        "aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  )
}

export { Input }
