import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "control field-sizing-content h-auto min-h-16 w-full py-1.5 placeholder:text-ghost aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
