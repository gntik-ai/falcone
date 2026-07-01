import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface StatusMeta {
  label: string
  className: string
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
}

const FLOW_STATUS_META: Record<string, StatusMeta> = {
  archived: { label: 'Archivado', variant: 'outline', className: 'border-slate-300 text-slate-500' },
  draft: { label: 'Borrador', variant: 'secondary', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  failed: { label: 'Fallido', variant: 'destructive', className: '' },
  published: { label: 'Publicado', variant: 'secondary', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
}

const RUN_STATUS_META: Record<string, StatusMeta> = {
  Canceled: { label: 'Cancelada', variant: 'outline', className: 'border-slate-300 text-slate-500' },
  Cancelled: { label: 'Cancelada', variant: 'outline', className: 'border-slate-300 text-slate-500' },
  Completed: { label: 'Completada', variant: 'secondary', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  Failed: { label: 'Fallida', variant: 'destructive', className: '' },
  Running: { label: 'En ejecución', variant: 'secondary', className: 'bg-sky-100 text-sky-800 border-sky-300' },
  Terminated: { label: 'Terminada', variant: 'outline', className: 'border-slate-300 text-slate-500' },
  TimedOut: { label: 'Expirada', variant: 'secondary', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  unknown: { label: 'Desconocido', variant: 'outline', className: 'border-slate-300 text-slate-600' }
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
  const meta = FLOW_STATUS_META[key] ?? { label: key, variant: 'outline', className: 'border-slate-300 text-slate-600' }

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
  const meta = RUN_STATUS_META[key] ?? { label: key, variant: 'outline', className: 'border-slate-300 text-slate-600' }

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
