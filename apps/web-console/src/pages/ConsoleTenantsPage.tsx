import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { CreateTenantWizard } from '@/components/console/wizards/CreateTenantWizard'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getConsoleContextStatusBadgeClasses,
  getConsoleTenantStatusMeta,
  useConsoleContext,
  type ConsoleTenantOption
} from '@/lib/console-context'
import { hasPlatformInventoryAccess } from '@/lib/console-principal'
import { readConsoleShellSession } from '@/lib/console-session'
import { cn } from '@/lib/utils'

export function ConsoleTenantsPage() {
  const [wizardOpen, setWizardOpen] = useState(false)
  // Polite, screen-reader-only announcement fired when a row sets the active context. Navigating
  // to the plan page is its own feedback for superadmins; for the select-only action (platform
  // roles that cannot open the plan) this closes the "did my click do anything?" loop (#752).
  const [activationNotice, setActivationNotice] = useState('')
  const { tenants, tenantsLoading, tenantsError, tenantsPageInfo, activeTenantId, selectTenant, reloadTenants } =
    useConsoleContext()
  const navigate = useNavigate()
  const roles = readConsoleShellSession()?.principal?.platformRoles ?? []
  const canViewInventory = useMemo(() => hasPlatformInventoryAccess(roles), [roles])
  // The tenant plan destination is superadmin-gated at the route level (RequireSuperadminRoute in
  // router.tsx redirects non-superadmins to /console/my-plan). Gate the "Abrir plan" link on the
  // SAME predicate so platform_admin/platform_operator get an honest, useful "set active context"
  // action instead of a link that silently bounces them off their intended destination (#752).
  const canOpenTenantPlan = useMemo(() => roles.includes('superadmin'), [roles])
  const truncated = Boolean(tenantsPageInfo?.after)

  function activateTenant(tenant: ConsoleTenantOption) {
    selectTenant(tenant.tenantId)
    setActivationNotice(`«${tenant.label}» es ahora la organización activa.`)
  }

  return (
    <section className="space-y-6" aria-labelledby="tenant-management-heading">
      <header className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-5">
          <div className="min-w-0 space-y-2">
            <Badge variant="outline" className="uppercase tracking-[0.14em]">Gobierno de organizaciones</Badge>
            <div className="space-y-1.5">
              <h1 id="tenant-management-heading" className="text-2xl font-semibold tracking-tight text-foreground">Gestión de organizaciones</h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Alta guiada y gobierno inicial de organizaciones de plataforma.</p>
            </div>
          </div>
          <Button type="button" className="w-full shrink-0 sm:w-auto" onClick={() => setWizardOpen(true)}>Nueva organización</Button>
        </div>
      </header>

      <p className="sr-only" role="status" aria-live="polite">{activationNotice}</p>

      {!canViewInventory ? (
        <ConsolePageState
          kind="blocked"
          title="Inventario no disponible para tu rol"
          description="El inventario de organizaciones es una vista de plataforma (superadmin / platform_admin / platform_operator). Gestiona tu organización asignada desde “Mi plan”."
          actionLabel="Ir a Mi plan"
          onAction={() => navigate('/console/my-plan')}
        />
      ) : tenantsLoading ? (
        <ConsolePageState kind="loading" title="Cargando organizaciones" description="Consultando el inventario de organizaciones accesibles." />
      ) : tenantsError ? (
        <ConsolePageState
          kind="error"
          title="No se pudo cargar el inventario"
          description={tenantsError}
          actionLabel="Reintentar"
          onAction={() => void reloadTenants()}
        />
      ) : tenants.length === 0 ? (
        <ConsolePageState
          kind="empty"
          title="Sin organizaciones"
          description="Todavía no hay organizaciones registradas en la plataforma. Da de alta la primera para empezar a gobernarlas."
          actionLabel="Dar de alta la primera organización"
          onAction={() => setWizardOpen(true)}
        />
      ) : (
        <section className="overflow-hidden rounded-3xl border border-border bg-card/70 shadow-sm" aria-labelledby="tenant-inventory-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-5 py-4 sm:px-6">
            <h2 id="tenant-inventory-heading" className="text-lg font-semibold tracking-tight text-foreground">Inventario</h2>
            <p className="text-xs text-muted-foreground">
              {truncated
                ? `${tenants.length}+ organizaciones`
                : `${tenants.length} ${tenants.length === 1 ? 'organización' : 'organizaciones'}`}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">
                Inventario de organizaciones de la plataforma. La fila marcada como «Activa» es el contexto operativo en uso.
              </caption>
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="border-l-2 border-l-transparent px-4 py-3 font-medium">Organización</th>
                  <th scope="col" className="px-4 py-3 font-medium">Slug</th>
                  <th scope="col" className="px-4 py-3 font-medium">Estado</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {tenants.map((tenant) => {
                  const status = getConsoleTenantStatusMeta(tenant)
                  const isActive = tenant.tenantId === activeTenantId
                  return (
                    <tr
                      key={tenant.tenantId}
                      aria-current={isActive ? 'true' : undefined}
                      className={cn('transition-colors', isActive ? 'bg-primary/10' : 'hover:bg-muted/20')}
                    >
                      <th
                        scope="row"
                        className={cn(
                          'border-l-2 px-4 py-3 text-left font-medium text-foreground transition-colors',
                          isActive ? 'border-l-primary' : 'border-l-transparent'
                        )}
                      >
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {tenant.label}
                          {isActive ? (
                            <Badge variant="outline" className="border-primary/50 bg-primary/10 text-primary">Activa</Badge>
                          ) : null}
                        </span>
                      </th>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">{tenant.secondary}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge variant="outline" className={getConsoleContextStatusBadgeClasses(status.tone)}>{status.label}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {canOpenTenantPlan ? (
                          <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" asChild>
                            <Link
                              to={`/console/tenants/${tenant.tenantId}/plan`}
                              aria-label={`Abrir el plan de ${tenant.label}`}
                              onClick={() => activateTenant(tenant)}
                            >
                              Abrir plan
                              <ChevronRight className="-mr-1 h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="whitespace-nowrap"
                            disabled={isActive}
                            aria-label={
                              isActive
                                ? `${tenant.label} ya es la organización activa`
                                : `Usar ${tenant.label} como organización activa`
                            }
                            onClick={() => activateTenant(tenant)}
                          >
                            Usar como activa
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {truncated ? (
            <p className="border-t border-border bg-muted/20 px-5 py-3 text-xs leading-5 text-muted-foreground sm:px-6">
              Mostrando las primeras {tenants.length} organizaciones. Hay más organizaciones disponibles no incluidas en esta vista.
            </p>
          ) : null}
        </section>
      )}

      <CreateTenantWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={() => void reloadTenants()} />
    </section>
  )
}
