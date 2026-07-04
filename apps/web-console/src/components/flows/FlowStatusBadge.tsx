import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface StatusMeta {
  label: string
  className: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

const FLOW_STATUS_META: Record<string, StatusMeta> = {
  archived: { label: 'Archivado', variant: 'outline', className: 'border-border bg-muted/40 text-muted-foreground' },
  draft: { label: 'Borrador', variant: 'outline', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  failed: { label: 'Fallido', variant: 'destructive', className: '' },
  published: { label: 'Publicado', variant: 'outline', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' }
}

const RUN_STATUS_META: Record<string, StatusMeta> = {
  Canceled: { label: 'Cancelada', variant: 'outline', className: 'border-border bg-muted/40 text-muted-foreground' },
  Cancelled: { label: 'Cancelada', variant: 'outline', className: 'border-border bg-muted/40 text-muted-foreground' },
  Completed: { label: 'Completada', variant: 'outline', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  Failed: { label: 'Fallida', variant: 'destructive', className: '' },
  Running: { label: 'En ejecución', variant: 'outline', className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  Terminated: { label: 'Terminada', variant: 'outline', className: 'border-border bg-muted/40 text-muted-foreground' },
  TimedOut: { label: 'Expirada', variant: 'outline', className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  unknown: { label: 'Desconocido', variant: 'outline', className: 'border-border bg-muted/40 text-muted-foreground' }
}

function normalizeStatus(value?: string | null): string {
  return value?.trim() || 'draft'
}

export function isPublishedFlowStatus(status?: string | null): boolean {
  return normalizeStatus(status).toLowerCase() === 'published'
}

export function FlowStatusBadge({
  status,
  className
}: {
  status?: string | null
  className?: string
}) {
  const key = normalizeStatus(status)
  const meta = FLOW_STATUS_META[key] ?? { label: key, variant: 'outline', className: 'border-border bg-muted/40 text-muted-foreground' }

  return (
    <Badge
      variant={meta.variant}
      data-testid="flow-status-badge"
      data-status={key}
      className={cn('text-xs', meta.className, className)}
    >
      {meta.label}
    </Badge>
  )
}

export function RunStatusBadge({
  status,
  className
}: {
  status?: string | null
  className?: string
}) {
  const key = status?.trim() || 'unknown'
  const meta = RUN_STATUS_META[key] ?? { label: key, variant: 'outline', className: 'border-border bg-muted/40 text-muted-foreground' }

  return (
    <Badge
      variant={meta.variant}
      data-testid="run-status-badge"
      data-status={key}
      className={cn('text-xs', meta.className, className)}
    >
      {meta.label}
    </Badge>
  )
}
