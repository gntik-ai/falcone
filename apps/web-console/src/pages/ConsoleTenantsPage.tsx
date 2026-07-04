import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { CreateTenantWizard } from '@/components/console/wizards/CreateTenantWizard'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getConsoleContextStatusBadgeClasses,
  getConsoleTenantStatusMeta,
  useConsoleContext
} from '@/lib/console-context'
import { readConsoleShellSession } from '@/lib/console-session'

// Platform roles that can call the superadmin tenant collection endpoint (GET /v1/tenants)
// without a 403 — mirrors console-context.tsx's own `isTenantOperator` predicate (#569).
// A tenant_owner/tenant_admin can still land on this route (it is not superadmin-gated),
// but cannot see a cross-tenant inventory nor reach the superadmin-gated
// /console/tenants/{id}/plan destination, so the page shows an honest, non-crashing state
// instead of an empty or partially-broken table (#752).
function hasPlatformInventoryAccess(roles: string[]): boolean {
  return roles.includes('superadmin') || roles.includes('platform_admin') || roles.includes('platform_operator')
}

export function ConsoleTenantsPage() {
  const [wizardOpen, setWizardOpen] = useState(false)
  const { tenants, tenantsLoading, tenantsError, tenantsPageInfo, selectTenant, reloadTenants } = useConsoleContext()
  const navigate = useNavigate()
  const roles = readConsoleShellSession()?.principal?.platformRoles ?? []
  const canViewInventory = useMemo(() => hasPlatformInventoryAccess(roles), [roles])

  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline">Gobierno de organizaciones</Badge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Gestión de organizaciones</h1>
              <p className="mt-2 text-sm text-muted-foreground">Alta guiada y gobierno inicial de organizaciones de plataforma.</p>
            </div>
          </div>
          <Button type="button" onClick={() => setWizardOpen(true)}>Nueva organización</Button>
        </div>
      </header>

      <section className="overflow-hidden rounded-3xl border border-border bg-card/70 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-5 py-4 sm:px-6">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Inventario</h2>
          {canViewInventory && !tenantsLoading && !tenantsError ? (
            <p className="text-xs text-muted-foreground">{tenants.length} {tenants.length === 1 ? 'organización' : 'organizaciones'}</p>
          ) : null}
        </div>

        {!canViewInventory ? (
          <div className="p-5 sm:p-6">
            <ConsolePageState
              kind="blocked"
              title="Inventario no disponible para tu rol"
              description="El inventario de organizaciones es una vista de plataforma (superadmin / platform_admin / platform_operator). Gestiona tu organización asignada desde “Mi plan”."
              actionLabel="Ir a Mi plan"
              onAction={() => navigate('/console/my-plan')}
            />
          </div>
        ) : tenantsLoading ? (
          <div className="p-5 sm:p-6">
            <ConsolePageState kind="loading" title="Cargando organizaciones" description="Consultando el inventario de organizaciones accesibles." />
          </div>
        ) : tenantsError ? (
          <div className="p-5 sm:p-6">
            <ConsolePageState
              kind="error"
              title="No se pudo cargar el inventario"
              description={tenantsError}
              actionLabel="Reintentar"
              onAction={() => void reloadTenants()}
            />
          </div>
        ) : tenants.length === 0 ? (
          <div className="p-5 sm:p-6">
            <ConsolePageState
              kind="empty"
              title="Sin organizaciones"
              description="Todavía no hay organizaciones registradas en la plataforma. Usa “Nueva organización” para dar de alta la primera."
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Inventario de organizaciones de la plataforma</caption>
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-4 py-3 font-medium">Organización</th>
                    <th scope="col" className="px-4 py-3 font-medium">Slug</th>
                    <th scope="col" className="px-4 py-3 font-medium">Estado</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {tenants.map((tenant) => {
                    const status = getConsoleTenantStatusMeta(tenant)
                    return (
                      <tr key={tenant.tenantId} className="transition-colors hover:bg-muted/20">
                        <th scope="row" className="px-4 py-3 text-left font-medium text-foreground">{tenant.label}</th>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">{tenant.secondary}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Badge variant="outline" className={getConsoleContextStatusBadgeClasses(status.tone)}>{status.label}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <Button type="button" variant="outline" size="sm" asChild>
                            <Link
                              to={`/console/tenants/${tenant.tenantId}/plan`}
                              aria-label={`Abrir el plan de ${tenant.label}`}
                              onClick={() => selectTenant(tenant.tenantId)}
                            >
                              Abrir plan
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {tenantsPageInfo?.after ? (
              <p className="border-t border-border/70 px-5 py-3 text-xs text-muted-foreground sm:px-6" role="status">
                Mostrando las primeras {tenants.length} organizaciones. Hay más organizaciones disponibles no incluidas en esta vista.
              </p>
            ) : null}
          </>
        )}
      </section>

      <CreateTenantWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={() => void reloadTenants()} />
    </main>
  )
}
