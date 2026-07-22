import * as React from "react"

import { cn } from "@/lib/utils"

// forwardRef matters here, not just style — base-ui's `render` prop (used
// e.g. by TooltipTrigger to wrap a Textarea directly as its anchor element)
// needs a real ref to the underlying DOM node to attach its open/position
// logic to. Without it, the ref silently fails to attach and the
// tooltip/popover never opens — verified live: wrapping a plain
// (non-forwardRef) Textarea in a Tooltip rendered the trigger but the
// content never mounted at all, on hover or focus.
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
