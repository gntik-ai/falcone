import { useEffect, useMemo, useState } from 'react'
import { fetchDenials, type ScopeEnforcementDenial } from '@/lib/console-scope-enforcement'
import { ScopeEnforcementDenialsTable } from '@/components/console/ScopeEnforcementDenialsTable'
import { Card } from '@/components/ui/card'

function countByType(denials: ScopeEnforcementDenial[], type: string) {
  return denials.filter((item) => item.denial_type === type).length
}

export function ConsoleScopeEnforcementPage({ isSuperadmin = true }: { isSuperadmin?: boolean }) {
  const [denials, setDenials] = useState<ScopeEnforcementDenial[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [range, setRange] = useState(() => ({ from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), to: new Date().toISOString() }))

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchDenials({ from: range.from, to: range.to }).then((result) => {
      if (!active) return
      setDenials(result.denials)
      setNextCursor(result.nextCursor)
      setLoading(false)
    })
    return () => { active = false }
  }, [range.from, range.to, refreshTick])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => setRefreshTick((value) => value + 1), 30000)
    return () => clearInterval(timer)
  }, [autoRefresh])

  const summary = useMemo(() => ({
    SCOPE_INSUFFICIENT: countByType(denials, 'SCOPE_INSUFFICIENT'),
    PLAN_ENTITLEMENT_DENIED: countByType(denials, 'PLAN_ENTITLEMENT_DENIED'),
    WORKSPACE_SCOPE_MISMATCH: countByType(denials, 'WORKSPACE_SCOPE_MISMATCH'),
    CONFIG_ERROR: countByType(denials, 'CONFIG_ERROR')
  }), [denials])

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Cumplimiento de scopes — eventos denegados</h1>
          <p className="mt-2 text-sm text-muted-foreground">Solicitudes bloqueadas recientes por scopes de token, derechos del plan, aislamiento de área de trabajo o puntos de conexión sin declarar.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-xl border border-input px-3 py-2 text-sm text-foreground hover:bg-accent" onClick={() => setRefreshTick((value) => value + 1)}>Actualizar</button>
          <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />Autoactualizar</label>
        </div>
      </header>
      {isSuperadmin && summary.CONFIG_ERROR > 0 ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
          Puntos de conexión sin configurar detectados. Revisa la configuración de plataforma.
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
        {Object.entries(summary).map(([key, value]) => (
          <Card key={key} className="p-3 text-sm">
            <div className="text-muted-foreground">{key}</div>
            <div className="text-2xl font-semibold text-foreground">{value}</div>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="from-range" type="date" className="rounded-xl border border-input bg-background px-2 py-1 text-sm text-foreground" onChange={(event) => setRange((current) => ({ ...current, from: new Date(event.target.value).toISOString() }))} />
        <input aria-label="to-range" type="date" className="rounded-xl border border-input bg-background px-2 py-1 text-sm text-foreground" onChange={(event) => setRange((current) => ({ ...current, to: new Date(event.target.value).toISOString() }))} />
        <Card className="p-3 text-sm">Denegaciones totales en la ventana: {denials.length}</Card>
      </div>
      <ScopeEnforcementDenialsTable denials={denials} isLoading={loading} hasMore={Boolean(nextCursor)} isSuperadmin={isSuperadmin} />
    </section>
  )
}
