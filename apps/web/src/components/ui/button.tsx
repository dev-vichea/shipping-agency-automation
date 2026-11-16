import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-control border border-transparent text-label-lg outline-none motion-safe:transition-[background-color,border-color,color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        destructive: "border-danger-border bg-card text-danger hover:bg-danger-fill",
        outline: "border-border bg-transparent text-foreground hover:bg-muted",
        secondary: "bg-muted text-foreground hover:bg-border",
        ghost: "text-ghost hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        chrome: "border-chrome-border bg-transparent text-chrome-foreground hover:bg-chrome-panel",
      },
      size: {
        default: "h-9 px-3",
        xs: "h-6 gap-1 px-1.5 text-label-sm [&_svg]:size-3",
        sm: "h-8 px-2.5",
        lg: "h-9 px-4",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
