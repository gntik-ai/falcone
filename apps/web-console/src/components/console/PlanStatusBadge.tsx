import { Badge } from '@/components/ui/badge'
import type { PlanStatus } from '@/services/planManagementApi'

const classNames: Record<PlanStatus, string> = {
  draft: 'border-border bg-muted/40 text-muted-foreground',
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  deprecated: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  archived: 'border-border bg-muted/60 text-muted-foreground'
}

const statusLabels: Record<PlanStatus, string> = {
  draft: 'Borrador',
  active: 'Activo',
  deprecated: 'Obsoleto',
  archived: 'Archivado'
}

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  return <Badge className={classNames[status]}>{statusLabels[status]}</Badge>
}
