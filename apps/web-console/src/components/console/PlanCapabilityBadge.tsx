import { Badge } from '@/components/ui/badge'

export function PlanCapabilityBadge({ enabled, label }: { enabled: boolean; label?: string }) {
  return (
    <Badge
      aria-label={`${label ?? 'Capacidad'} ${enabled ? 'habilitada' : 'deshabilitada'}`}
      className={enabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-border bg-muted/40 text-muted-foreground'}
    >
      {enabled ? 'Habilitada' : 'Deshabilitada'}
    </Badge>
  )
}
