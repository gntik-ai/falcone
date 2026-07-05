import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { OperationStatus } from '@/lib/console-operations'

interface OperationStatusBadgeProps {
  status: OperationStatus
  className?: string
}

const STATUS_LABELS: Record<OperationStatus, string> = {
  pending: 'Pendiente',
  running: 'En curso',
  completed: 'Completada',
  failed: 'Fallida',
  timed_out: 'Expirada',
  cancelled: 'Cancelada'
}

const STATUS_CLASSNAMES: Record<OperationStatus, string> = {
  pending: 'border-border bg-muted/40 text-muted-foreground',
  running: 'border-sky-500/30 bg-sky-500/10 text-sky-300 animate-pulse',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-300',
  timed_out: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  cancelled: 'border-border bg-muted/40 text-muted-foreground'
}

export function OperationStatusBadge({ status, className }: OperationStatusBadgeProps) {
  return (
    <Badge className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', STATUS_CLASSNAMES[status], className)}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

export default OperationStatusBadge
