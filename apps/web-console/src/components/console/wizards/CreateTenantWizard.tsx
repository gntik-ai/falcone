import { useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  return <div className="space-y-2"><Label htmlFor="tenant-name">Nombre del tenant</Label><Input id="tenant-name" value={data.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} />{validation.fieldErrors.name ? <p className="text-sm text-destructive">{validation.fieldErrors.name}</p> : null}</div>
}
function PlanStep({ data, onChange, validation, planCatalog }: WizardStepProps<TenantData> & { planCatalog: PlanCatalogState }) {
  const catalogBlocked = planCatalog.loading || Boolean(planCatalog.error) || planCatalog.items.length === 0
  const placeholder = planCatalog.loading
    ? 'Cargando planes activos'
    : planCatalog.error
      ? 'Catálogo no disponible'
      : planCatalog.items.length === 0
        ? 'No hay planes activos'
        : 'Selecciona un plan'

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="tenant-plan">Plan</Label>
        <Select id="tenant-plan" value={data.planId ?? ''} disabled={catalogBlocked} onChange={(e) => onChange({ planId: e.target.value })}>
          <option value="">{placeholder}</option>
          {planCatalog.items.map((plan) => (
            <option key={plan.id} value={plan.id}>{plan.displayName} ({plan.slug})</option>
          ))}
        </Select>
        {validation.fieldErrors.planId && !catalogBlocked ? <p className="text-sm text-destructive">{validation.fieldErrors.planId}</p> : null}
        {validation.blockingError && !catalogBlocked ? <p className="text-sm text-destructive">{validation.blockingError}</p> : null}
      </div>
      {planCatalog.loading ? (
        <p role="status" aria-live="polite" className="text-sm leading-6 text-muted-foreground">Cargando planes activos del catálogo.</p>
      ) : null}
      {planCatalog.error ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo cargar el catálogo de planes</AlertTitle>
          <AlertDescription>{planCatalog.error}</AlertDescription>
        </Alert>
      ) : null}
      {!planCatalog.loading && !planCatalog.error && planCatalog.items.length === 0 ? (
        <p role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">No hay planes activos en el catálogo. Activa un plan antes de crear tenants con asignación inicial.</p>
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

  useEffect(() => {
    if (!open || !permission.allowed) return
    let cancelled = false
    setPlanCatalog((current) => ({ ...current, loading: true, error: null }))
    listPlans({ status: 'active', page: 1, pageSize: 100 })
      .then((response) => {
        if (!cancelled) setPlanCatalog({ loading: false, error: null, items: response.items })
      })
      .catch((error) => {
        if (!cancelled) setPlanCatalog({ loading: false, error: error instanceof Error ? error.message : 'No se pudo cargar el catálogo de planes.', items: [] })
      })
    return () => { cancelled = true }
  }, [open, permission.allowed])

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
    title="Nuevo tenant"
    description="Alta guiada de tenant administrativo."
    context={{ tenantId: null, workspaceId: null, principalRoles: [] }}
    initialData={{ locale: 'es' }}
    steps={[
      { id: 'name', label: 'Nombre', component: NameStep, validate: (data) => createValidation(!data.name?.trim() ? { name: 'El nombre es obligatorio.' } : {}) },
      {
        id: 'plan',
        label: 'Plan',
        component: (props) => <PlanStep {...props} planCatalog={planCatalog} />,
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
      return { resourceId: response.tenantId, resourceUrl: '/console/tenants' }
    }}
  />
}
