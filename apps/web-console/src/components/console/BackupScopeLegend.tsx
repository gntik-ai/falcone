import { Badge } from '@/components/ui/badge'

const STATUS_BADGES: Array<{ key: string; label: string; className: string; description: string }> = [
  { key: 'platform-managed', label: 'Gestionado por la plataforma', className: 'bg-emerald-100 text-emerald-900', description: 'La plataforma gestiona el backup por completo' },
  { key: 'operator-managed', label: 'Gestionado por operador', className: 'bg-amber-100 text-amber-900', description: 'El operador debe configurar el backup' },
  { key: 'not-supported', label: 'No soportado', className: 'bg-red-100 text-red-900', description: 'El backup no está disponible para este componente en este perfil' },
  { key: 'unknown', label: 'Desconocido', className: 'bg-slate-100 text-slate-900', description: 'No se puede determinar el estado del backup' }
]

const OPERATIONAL_BADGES: Array<{ key: string; label: string; className: string }> = [
  { key: 'operational', label: 'Operativo', className: 'bg-emerald-100 text-emerald-900' },
  { key: 'degraded', label: 'Degradado', className: 'bg-amber-100 text-amber-900' },
  { key: 'unknown', label: 'Desconocido', className: 'bg-slate-100 text-slate-900' }
]

export function BackupScopeLegend() {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4" data-testid="backup-scope-legend">
      <div className="mb-3 text-sm font-semibold">Estado de cobertura</div>
      <div className="flex flex-wrap gap-3">
        {STATUS_BADGES.map((badge) => (
          <div key={badge.key} className="flex items-center gap-2">
            <Badge className={badge.className}>{badge.label}</Badge>
            <span className="text-xs text-muted-foreground">{badge.description}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 mb-3 text-sm font-semibold">Estado operativo</div>
      <div className="flex flex-wrap gap-3">
        {OPERATIONAL_BADGES.map((badge) => (
          <div key={badge.key} className="flex items-center gap-2">
            <Badge className={badge.className}>{badge.label}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

export function getCoverageBadgeClass(status: string): string {
  const badge = STATUS_BADGES.find((b) => b.key === status)
  return badge?.className ?? 'bg-slate-100 text-slate-900'
}
