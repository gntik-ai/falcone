import * as React from 'react'

import { cn } from '@/lib/utils'

export function Checkbox({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type="checkbox"
      className={cn(
        // Brand checkbox idiom, centralized here to match the hand-rolled control on LoginPage:
        // `accent-primary` tints the checked box with the brand navy (instead of the UA blue),
        // `shrink-0` keeps it square inside flex setting-rows, and a token-based focus-visible ring
        // makes keyboard focus obvious on the dark theme. Call-site classes still win via `cn`.
        'h-4 w-4 shrink-0 rounded border border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
      {...props}
    />
  )
}
