// Shared Card primitive (change: add-757-console-dataplane-design-system).
// One panel idiom for every console screen: rounded-3xl bg-card/70 shadow-sm, matching the
// idiom the Postgres/Mongo inventory pages already established. `data-slot` attributes give
// tests (and future refactors) a stable, style-independent hook.
import * as React from 'react'

import { cn } from '@/lib/utils'

const Card = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="card"
    className={cn('rounded-3xl border border-border bg-card/70 p-6 shadow-sm', className)}
    {...props}
  />
))
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(({ className, ...props }, ref) => (
  <div ref={ref} data-slot="card-header" className={cn('flex flex-wrap items-start justify-between gap-4', className)} {...props} />
))
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLHeadingElement, React.ComponentProps<'h2'>>(({ className, ...props }, ref) => (
  <h2 ref={ref} data-slot="card-title" className={cn('text-lg font-semibold text-foreground', className)} {...props} />
))
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<HTMLParagraphElement, React.ComponentProps<'p'>>(({ className, ...props }, ref) => (
  <p ref={ref} data-slot="card-description" className={cn('mt-1 text-sm text-muted-foreground', className)} {...props} />
))
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(({ className, ...props }, ref) => (
  <div ref={ref} data-slot="card-content" className={cn('mt-4', className)} {...props} />
))
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(({ className, ...props }, ref) => (
  <div ref={ref} data-slot="card-footer" className={cn('mt-6 flex flex-wrap items-center gap-2', className)} {...props} />
))
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
