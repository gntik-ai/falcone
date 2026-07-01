import { Badge } from '@/components/ui/badge'

export function PlanCapabilityBadge({ enabled, label }: { enabled: boolean; label?: string }) {
  return <Badge aria-label={`${label ?? 'Capacidad'} ${enabled ? 'habilitada' : 'deshabilitada'}`} className={enabled ? 'bg-green-100 text-green-900' : 'bg-slate-100 text-slate-900'}>{enabled ? 'Habilitada' : 'Deshabilitada'}</Badge>
}
