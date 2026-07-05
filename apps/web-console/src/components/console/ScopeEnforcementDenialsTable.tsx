// #744: converged onto the shared Card/Table/Badge primitives — this table previously rendered a
// hard-coded solid-white panel with a light-slate header, both invisible-on-dark escapes.
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { exportDenialsAsCsv, type ScopeEnforcementDenial } from '@/lib/console-scope-enforcement'

const badgeTones: Record<string, string> = {
  SCOPE_INSUFFICIENT: 'border-red-500/30 bg-red-500/10 text-red-300',
  PLAN_ENTITLEMENT_DENIED: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  WORKSPACE_SCOPE_MISMATCH: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  CONFIG_ERROR: 'border-border bg-muted/40 text-muted-foreground'
}

export function ScopeEnforcementDenialsTable({ denials, isLoading, onLoadMore, hasMore, isSuperadmin }: { denials: ScopeEnforcementDenial[]; isLoading: boolean; onLoadMore?: () => void; hasMore: boolean; isSuperadmin: boolean }) {
  const handleExport = () => {
    const blob = new Blob([exportDenialsAsCsv(denials)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'scope-enforcement-denials.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!isLoading && denials.length === 0) {
    return (
      <Card className="text-sm text-muted-foreground" data-testid="scope-enforcement-empty-state">
        No hay eventos denegados en este periodo
      </Card>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label="denial_type" className="rounded-xl border border-input bg-background px-2 py-1 text-sm text-foreground">
          <option value="">Todos los tipos de denegación</option>
        </select>
        <input aria-label="actor_id" className="rounded-xl border border-input bg-background px-2 py-1 text-sm text-foreground" placeholder="ID del actor" />
        <input aria-label="ID de área de trabajo" className="rounded-xl border border-input bg-background px-2 py-1 text-sm text-foreground" placeholder="ID del área de trabajo" />
        <input aria-label="from" type="date" className="rounded-xl border border-input bg-background px-2 py-1 text-sm text-foreground" />
        <input aria-label="to" type="date" className="rounded-xl border border-input bg-background px-2 py-1 text-sm text-foreground" />
        <button className="rounded-xl border border-input px-3 py-1 text-sm text-foreground hover:bg-accent" onClick={handleExport}>Exportar CSV</button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Marca temporal</TableHead>
            <TableHead scope="col">Tipo</TableHead>
            <TableHead scope="col">Actor</TableHead>
            <TableHead scope="col">Recurso</TableHead>
            <TableHead scope="col">Faltante</TableHead>
            {isSuperadmin ? <TableHead scope="col">Organización</TableHead> : null}
            <TableHead scope="col">IP de origen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {denials.map((denial) => (
            <TableRow key={`${denial.correlation_id}-${denial.denied_at}`}>
              <TableCell>{denial.denied_at}</TableCell>
              <TableCell>
                <Badge className={badgeTones[denial.denial_type] ?? badgeTones.CONFIG_ERROR}>{denial.denial_type}</Badge>
              </TableCell>
              <TableCell>
                {denial.actor_id} <span className="text-muted-foreground">({denial.actor_type})</span>
              </TableCell>
              <TableCell>{denial.http_method} {denial.request_path}</TableCell>
              <TableCell>{denial.missing_scopes?.join(', ') || denial.required_entitlement || '—'}</TableCell>
              {isSuperadmin ? <TableCell>{denial.tenant_id}</TableCell> : null}
              <TableCell>{denial.source_ip ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {hasMore ? (
        <button className="rounded-xl border border-input px-3 py-1 text-sm text-foreground hover:bg-accent" onClick={onLoadMore}>
          Cargar más
        </button>
      ) : null}
    </section>
  )
}
