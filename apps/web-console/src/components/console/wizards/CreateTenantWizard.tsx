import { useCallback, useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WizardShell } from '@/components/console/wizards/WizardShell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useWizardPermissionCheck, useWizardQuotaCheck, createValidation, submitWizardRequest, type WizardStepProps } from '@/lib/console-wizards'
import { listPlans, type PlanRecord } from '@/services/planManagementApi'

interface TenantData { name: string; planId: string; region: string; locale: string }
interface PlanCatalogState { loading: boolean; error: string | null; items: PlanRecord[] }

function NameStep({ data, onChange, validation }: WizardStepProps<TenantData>) {
  return <div className="space-y-2"><Label htmlFor="tenant-name">Nombre de la organización</Label><Input id="tenant-name" value={data.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} />{validation.fieldErrors.name ? <p className="text-sm text-destructive">{validation.fieldErrors.name}</p> : null}</div>
}
function PlanStep({ data, onChange, validation, planCatalog, onRetry }: WizardStepProps<TenantData> & { planCatalog: PlanCatalogState; onRetry: () => void }) {
  const catalogBlocked = planCatalog.loading || Boolean(planCatalog.error) || planCatalog.items.length === 0
  const placeholder = planCatalog.loading
    ? 'Cargando planes activos'
    : planCatalog.error
      ? 'Catálogo no disponible'
      : planCatalog.items.length === 0
        ? 'No hay planes activos'
        : 'Selecciona un plan'
  const fieldErrorVisible = Boolean(validation.fieldErrors.planId) && !catalogBlocked
  const blockingErrorVisible = Boolean(validation.blockingError) && !catalogBlocked
  const describedBy = [
    planCatalog.loading ? 'tenant-plan-catalog-loading' : null,
    planCatalog.error ? 'tenant-plan-catalog-error' : null,
    !planCatalog.loading && !planCatalog.error && planCatalog.items.length === 0 ? 'tenant-plan-catalog-empty' : null,
    fieldErrorVisible ? 'tenant-plan-field-error' : null,
    blockingErrorVisible ? 'tenant-plan-blocking-error' : null
  ].filter(Boolean).join(' ') || undefined

  return (
    <div className="space-y-3">
      <div className="max-w-lg space-y-2">
        <Label htmlFor="tenant-plan">Plan</Label>
        <Select
          id="tenant-plan"
          value={data.planId ?? ''}
          disabled={catalogBlocked}
          aria-describedby={describedBy}
          aria-invalid={fieldErrorVisible || blockingErrorVisible || undefined}
          onChange={(e) => onChange({ planId: e.target.value })}
        >
          <option value="">{placeholder}</option>
          {planCatalog.items.map((plan) => (
            <option key={plan.id} value={plan.id}>{plan.displayName} ({plan.slug})</option>
          ))}
        </Select>
        {fieldErrorVisible ? <p id="tenant-plan-field-error" className="text-sm text-destructive">{validation.fieldErrors.planId}</p> : null}
        {blockingErrorVisible ? <p id="tenant-plan-blocking-error" className="text-sm text-destructive">{validation.blockingError}</p> : null}
      </div>
      {planCatalog.loading ? (
        <p id="tenant-plan-catalog-loading" role="status" aria-live="polite" className="max-w-lg text-sm leading-6 text-muted-foreground">Cargando planes activos del catálogo.</p>
      ) : null}
      {planCatalog.error ? (
        <Alert id="tenant-plan-catalog-error" variant="destructive" className="max-w-lg">
          <AlertTitle>No se pudo cargar el catálogo de planes</AlertTitle>
          <AlertDescription>{planCatalog.error}</AlertDescription>
          <Button type="button" variant="outline" size="sm" className="mt-3 text-foreground" onClick={onRetry}>
            Reintentar
          </Button>
        </Alert>
      ) : null}
      {!planCatalog.loading && !planCatalog.error && planCatalog.items.length === 0 ? (
        <p id="tenant-plan-catalog-empty" role="status" className="max-w-lg rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">No hay planes activos en el catálogo. Activa un plan antes de crear organizaciones con asignación inicial.</p>
      ) : null}
    </div>
  )
}
function RegionStep({ data, onChange, validation }: WizardStepProps<TenantData>) {
  return <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="tenant-region">Región</Label><Select id="tenant-region" value={data.region ?? ''} onChange={(e) => onChange({ region: e.target.value })}><option value="">Selecciona una región</option><option value="eu-west">EU West</option><option value="us-east">US East</option></Select>{validation.fieldErrors.region ? <p className="text-sm text-destructive">{validation.fieldErrors.region}</p> : null}</div><div className="space-y-2"><Label htmlFor="tenant-locale">Locale</Label><Select id="tenant-locale" value={data.locale ?? 'es'} onChange={(e) => onChange({ locale: e.target.value })}><option value="es">es</option><option value="en">en</option></Select></div></div>
}

export function CreateTenantWizard({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: () => void }) {
  const permission = useWizardPermissionCheck('create_tenant')
  const quota = useWizardQuotaCheck('tenants.count', 'tenant', 'platform', null)
  const [openBlocked, setOpenBlocked] = useState(false)
  const [planCatalog, setPlanCatalog] = useState<PlanCatalogState>({ loading: false, error: null, items: [] })

  const loadPlanCatalog = useCallback((isCancelled: () => boolean = () => false) => {
    setPlanCatalog({ loading: true, error: null, items: [] })
    listPlans({ status: 'active', page: 1, pageSize: 100 })
      .then((response) => {
        if (!isCancelled()) setPlanCatalog({ loading: false, error: null, items: response.items })
      })
      .catch((error) => {
        if (!isCancelled()) setPlanCatalog({ loading: false, error: error instanceof Error ? error.message : 'No se pudo cargar el catálogo de planes.', items: [] })
      })
  }, [])

  useEffect(() => {
    if (!open || !permission.allowed) return
    let cancelled = false
    loadPlanCatalog(() => cancelled)
    return () => { cancelled = true }
  }, [loadPlanCatalog, open, permission.allowed])

  const selectedPlan = (planId?: string) => planCatalog.items.find((plan) => plan.id === planId)
  const planCatalogBlockingError = planCatalog.loading
    ? 'El catálogo de planes todavía se está cargando.'
    : planCatalog.error
      ? 'No se pudo cargar el catálogo de planes.'
      : planCatalog.items.length === 0
        ? 'No hay planes activos disponibles.'
        : undefined

  if (!permission.allowed && (open || openBlocked)) return <ConsolePageState kind="blocked" title="Acceso bloqueado" description={permission.reason ?? 'No permitido.'} actionLabel="Cerrar" onAction={() => { setOpenBlocked(false); onOpenChange(false) }} />
  return <WizardShell<TenantData>
    open={open}
    onOpenChange={onOpenChange}
    title="Nueva organización"
    description="Alta guiada de organización administrativa."
    context={{ tenantId: null, workspaceId: null, principalRoles: [] }}
    initialData={{ locale: 'es' }}
    steps={[
      { id: 'name', label: 'Nombre', component: NameStep, validate: (data) => createValidation(!data.name?.trim() ? { name: 'El nombre es obligatorio.' } : {}) },
      {
        id: 'plan',
        label: 'Plan',
        component: (props) => <PlanStep {...props} planCatalog={planCatalog} onRetry={() => loadPlanCatalog()} />,
        validate: (data) => createValidation(
          !data.planId || !selectedPlan(data.planId) ? { planId: 'Selecciona un plan activo del catálogo.' } : {},
          planCatalogBlockingError ?? (quota.available ? undefined : quota.reason ?? 'Sin cuota disponible.')
        )
      },
      { id: 'region', label: 'Región', component: RegionStep, validate: (data) => createValidation(!data.region ? { region: 'Selecciona una región.' } : {}) }
    ]}
    buildSummary={(data) => [
      { label: 'Nombre', value: data.name ?? '' },
      { label: 'Plan', value: selectedPlan(data.planId)?.displayName ?? data.planId ?? '' },
      { label: 'Región', value: data.region ?? '' },
      { label: 'Locale', value: data.locale ?? 'es' }
    ]}
    onSubmit={async (data) => {
      // The published catalog + runtime expose tenant creation at POST /v1/tenants; the old
      // /v1/admin/tenants path is not routed (404 NO_ROUTE) — fix-console-tenant-create-path (#504).
      const response = await submitWizardRequest<{ tenantId: string; tenantSlug?: string }>('/v1/tenants', { name: data.name ?? '', planId: data.planId ?? '', region: data.region ?? '', preferences: { locale: data.locale ?? 'es' } })
      onCreated?.()
      // #752: link straight into the created tenant's plan page instead of the generic
      // /console/tenants list — the wizard success step must be navigable to the actual
      // new resource, not a static placeholder.
      return { resourceId: response.tenantId, resourceUrl: `/console/tenants/${response.tenantId}/plan` }
    }}
  />
}
