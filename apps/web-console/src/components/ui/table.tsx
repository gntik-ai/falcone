// Shared Table primitive (change: add-757-console-dataplane-design-system).
// One header style, one panel idiom for every data-plane grid: rounded-2xl bordered container +
// bg-muted/50 uppercase thead, matching the idiom the Postgres inventory page already established.
// `data-slot` attributes give tests a stable, style-independent hook.
import * as React from 'react'

import { cn } from '@/lib/utils'

const Table = React.forwardRef<HTMLTableElement, React.ComponentProps<'table'> & { containerClassName?: string }>(
  ({ className, containerClassName, ...props }, ref) => (
    <div data-slot="table-container" className={cn('overflow-x-auto rounded-2xl border border-border', containerClassName)}>
      <table ref={ref} data-slot="table" className={cn('min-w-full divide-y divide-border text-sm', className)} {...props} />
    </div>
  )
)
Table.displayName = 'Table'

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<'thead'>>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    data-slot="table-header"
    className={cn('bg-muted/50 text-left text-xs uppercase tracking-[0.2em] text-muted-foreground', className)}
    {...props}
  />
))
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef<HTMLTableSectionElement, React.ComponentProps<'tbody'>>(({ className, ...props }, ref) => (
  <tbody ref={ref} data-slot="table-body" className={cn('divide-y divide-border bg-background/40', className)} {...props} />
))
TableBody.displayName = 'TableBody'

const TableRow = React.forwardRef<HTMLTableRowElement, React.ComponentProps<'tr'>>(({ className, ...props }, ref) => (
  <tr ref={ref} data-slot="table-row" className={cn('transition-colors', className)} {...props} />
))
TableRow.displayName = 'TableRow'

const TableHead = React.forwardRef<HTMLTableCellElement, React.ComponentProps<'th'>>(({ className, ...props }, ref) => (
  <th ref={ref} data-slot="table-head" className={cn('px-4 py-3 font-medium', className)} {...props} />
))
TableHead.displayName = 'TableHead'

const TableCell = React.forwardRef<HTMLTableCellElement, React.ComponentProps<'td'>>(({ className, ...props }, ref) => (
  <td ref={ref} data-slot="table-cell" className={cn('px-4 py-3', className)} {...props} />
))
TableCell.displayName = 'TableCell'

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.ComponentProps<'caption'>>(({ className, ...props }, ref) => (
  <caption ref={ref} data-slot="table-caption" className={cn('sr-only', className)} {...props} />
))
TableCaption.displayName = 'TableCaption'

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption }
