import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { BackupScopeEntry } from '@/lib/backupScopeApi'
import { getCoverageBadgeClass } from './BackupScopeLegend'

function formatRange(range: { min: number; max: number } | null): string {
  if (!range) return '—'
  if (range.min === range.max) return `${range.min} min`
  return `${range.min}–${range.max} min`
}

function OperationalChip({ status }: { status: string }) {
  if (status === 'unknown') return null
  const className =
    status === 'operational' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  return <Badge className={className}>{status}</Badge>
}

export function BackupScopeMatrix({ entries, isLoading }: { entries: BackupScopeEntry[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div data-testid="matrix-loading" className="space-y-2">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return <div data-testid="matrix-empty" className="text-muted-foreground">No se encontraron entradas de alcance de backup.</div>
  }

  return (
    <Table data-testid="backup-scope-matrix">
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="sticky left-0 bg-muted">Componente</TableHead>
          <TableHead scope="col">Perfil</TableHead>
          <TableHead scope="col">Cobertura</TableHead>
          <TableHead scope="col">Granularidad</TableHead>
          <TableHead scope="col">RPO</TableHead>
          <TableHead scope="col">RTO</TableHead>
          <TableHead scope="col">Límites</TableHead>
          <TableHead scope="col">Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={`${entry.componentKey}-${entry.profileKey}`} data-testid={`matrix-row-${entry.componentKey}`}>
            <TableCell className="sticky left-0 bg-background font-medium text-foreground">{entry.componentKey}</TableCell>
            <TableCell className="text-muted-foreground">{entry.profileKey}</TableCell>
            <TableCell>
              <Badge className={getCoverageBadgeClass(entry.coverageStatus)}>{entry.coverageStatus}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{entry.backupGranularity}</TableCell>
            <TableCell className="text-muted-foreground" title={entry.rpoRangeMinutes ? `RPO: ${entry.rpoRangeMinutes.min}–${entry.rpoRangeMinutes.max} minutes` : undefined}>
              {formatRange(entry.rpoRangeMinutes)}
            </TableCell>
            <TableCell className="text-muted-foreground" title={entry.rtoRangeMinutes ? `RTO: ${entry.rtoRangeMinutes.min}–${entry.rtoRangeMinutes.max} minutes` : undefined}>
              {formatRange(entry.rtoRangeMinutes)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {entry.maxRetentionDays != null && <span className="text-xs">Ret: {entry.maxRetentionDays}d</span>}
              {entry.maxConcurrentJobs != null && <span className="ml-2 text-xs">Jobs: {entry.maxConcurrentJobs}</span>}
              {entry.maxBackupSizeGb != null && <span className="ml-2 text-xs">Max: {entry.maxBackupSizeGb}GB</span>}
            </TableCell>
            <TableCell>
              <OperationalChip status={entry.operationalStatus} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
