import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "inline-flex h-4.5 w-fit shrink-0 items-center justify-center whitespace-nowrap rounded-control border-0 px-2 font-mono text-code-badge font-medium leading-none transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary",
        secondary: "bg-muted text-muted-foreground",
        destructive: "bg-rose-100/80 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
        warning: "bg-amber-100/90 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
        success: "bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
        outline: "border border-border text-foreground",
        ghost: "text-muted-foreground",
        link: "text-primary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
