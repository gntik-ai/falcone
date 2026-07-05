// Real product landing for the authenticated console (change: add-console-descaffold-dark-theme,
// issue #744). Replaces the former generic `ConsolePlaceholderPage` — the tenant/workspace context
// card it used to render here duplicated `ConsoleContextStatusPanel` (already shown by
// `ConsoleShellLayout` above every non-platform-global route), and its "Consola base" panel narrated
// dev/iteration status ("Esta vista sigue siendo una pantalla temporal…") instead of product copy.
// This page keeps the genuinely useful parts (quota + inventory summaries for the active
// organization) and adds a real quick-access section.
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConsoleContext } from '@/lib/console-context'

const QUICK_LINKS = [
  { to: '/console/workspaces', label: 'Áreas de trabajo', description: 'Inventario y estado de aprovisionamiento.' },
  { to: '/console/members', label: 'Miembros', description: 'Gestiona quién tiene acceso a la organización.' },
  { to: '/console/flows', label: 'Flujos / workflows', description: 'Automatizaciones y su historial de ejecución.' },
  { to: '/console/my-plan', label: 'Mi plan', description: 'Límites y consumo del plan contratado.' }
] as const

export function ConsoleOverviewPage() {
  const { activeTenant } = useConsoleContext()
  const quotaSummary = activeTenant?.quotaSummary ?? null
  const inventorySummary = activeTenant?.inventorySummary ?? null

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <Badge variant="secondary">Vista general</Badge>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Vista general de la consola</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Estado operativo y accesos rápidos a la administración de tu organización en la plataforma BaaS.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Accesos rápidos</CardTitle>
            <CardDescription>Destinos más usados para administrar la organización activa.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="rounded-2xl border border-border/70 bg-background/50 p-4 transition-colors hover:border-border hover:bg-accent/40"
            >
              <p className="text-sm font-medium text-foreground">{link.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{link.description}</p>
            </Link>
          ))}
        </CardContent>
      </Card>

      {quotaSummary ? (
        <Card data-testid="console-tenant-quota-summary">
          <CardHeader>
            <div>
              <CardTitle>Estado de cuotas de la organización activa</CardTitle>
              <CardDescription>Resumen de consumo frente a los límites del plan contratado.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Nominal: {quotaSummary.totals.nominal}</Badge>
              <Badge variant="outline">Advertencia: {quotaSummary.totals.warning}</Badge>
              <Badge variant="outline">Bloqueadas: {quotaSummary.totals.blocked}</Badge>
            </div>
          </CardHeader>

          <CardContent>
            {quotaSummary.items.length > 0 ? (
              <details className="rounded-2xl border border-border/70 bg-background/60 p-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground">Ver detalle de cuotas</summary>
                <div className="mt-4 space-y-3">
                  {quotaSummary.items.map((item) => (
                    <div key={`${item.scope}-${item.metricKey}`} className="rounded-2xl border border-border/60 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{item.metricKey}</p>
                          <p className="text-xs text-muted-foreground">Ámbito: {item.scope}</p>
                        </div>
                        <Badge variant="secondary">{item.severity}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Uso {formatCount(item.used)} / {formatCount(item.limit)} · restante {formatCount(item.remaining)} · utilización{' '}
                        {item.utilizationPercent}%{item.unit ? ` · ${item.unit}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">No hay alertas de cuota visibles para la organización activa.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {inventorySummary ? (
        <Card data-testid="console-tenant-inventory-summary">
          <CardHeader>
            <div>
              <CardTitle>Composición de la organización activa</CardTitle>
              <CardDescription>Inventario de áreas de trabajo, aplicaciones y recursos gestionados.</CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <InventoryStat label="Áreas de trabajo" value={inventorySummary.workspaceCount} />
              <InventoryStat label="Aplicaciones" value={inventorySummary.applicationCount} />
              <InventoryStat label="Recursos gestionados" value={inventorySummary.managedResourceCount} />
              <InventoryStat label="Cuentas de servicio" value={inventorySummary.serviceAccountCount} />
            </div>

            {inventorySummary.workspaces.length > 0 ? (
              <details className="rounded-2xl border border-border/70 bg-background/60 p-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground">Ver desglose por área de trabajo</summary>
                <div className="mt-4 space-y-3">
                  {inventorySummary.workspaces.map((workspace) => (
                    <div key={workspace.workspaceId} className="rounded-2xl border border-border/60 px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{workspace.workspaceSlug}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Aplicaciones {formatCount(workspace.applicationCount)} · Cuentas de servicio{' '}
                        {formatCount(workspace.serviceAccountCount)} · Recursos {formatCount(workspace.managedResourceCount)}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}

function InventoryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/60 px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatCount(value)}</p>
    </div>
  )
}

function formatCount(value: number) {
  return new Intl.NumberFormat('es-ES').format(value)
}
