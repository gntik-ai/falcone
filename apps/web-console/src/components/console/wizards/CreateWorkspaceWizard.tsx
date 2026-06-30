import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WizardShell } from '@/components/console/wizards/WizardShell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useConsoleContext } from '@/lib/console-context'
import { MAX_FORM_INTEGER, parseRequiredIntegerField } from '@/lib/console-create-form-validation'
import { createValidation, submitWizardRequest, useWizardPermissionCheck, useWizardQuotaCheck, type WizardStepProps } from '@/lib/console-wizards'

interface WorkspaceData { tenantId: string; name: string; description: string; maxFunctions: string; maxDatabases: string }

function TenantStep({ data, context }: WizardStepProps<WorkspaceData>) { return <div><Label>Tenant de contexto</Label><p className="mt-2 text-sm">{data.tenantId || context.tenantId || 'Sin tenant activo'}</p></div> }
function NameStep({ data, onChange, validation }: WizardStepProps<WorkspaceData>) { return <div className="space-y-2"><Label htmlFor="workspace-name">Nombre del workspace</Label><Input id="workspace-name" value={data.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} />{validation.fieldErrors.name ? <p className="text-sm text-destructive">{validation.fieldErrors.name}</p> : null}{validation.blockingError ? <p className="text-sm text-destructive">{validation.blockingError}</p> : null}</div> }
function ConfigStep({ data, onChange, validation }: WizardStepProps<WorkspaceData>) { return <div className="grid gap-4"><div className="space-y-2"><Label htmlFor="workspace-description">Descripción</Label><Textarea id="workspace-description" value={data.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="workspace-max-functions">Máx. funciones</Label><Input id="workspace-max-functions" inputMode="numeric" aria-invalid={Boolean(validation.fieldErrors.maxFunctions)} aria-describedby={validation.fieldErrors.maxFunctions ? 'workspace-max-functions-error' : undefined} value={data.maxFunctions ?? ''} onChange={(e) => onChange({ maxFunctions: e.target.value })} />{validation.fieldErrors.maxFunctions ? <p id="workspace-max-functions-error" className="text-sm text-destructive">{validation.fieldErrors.maxFunctions}</p> : null}</div><div className="space-y-2"><Label htmlFor="workspace-max-databases">Máx. bases de datos</Label><Input id="workspace-max-databases" inputMode="numeric" aria-invalid={Boolean(validation.fieldErrors.maxDatabases)} aria-describedby={validation.fieldErrors.maxDatabases ? 'workspace-max-databases-error' : undefined} value={data.maxDatabases ?? ''} onChange={(e) => onChange({ maxDatabases: e.target.value })} />{validation.fieldErrors.maxDatabases ? <p id="workspace-max-databases-error" className="text-sm text-destructive">{validation.fieldErrors.maxDatabases}</p> : null}</div></div></div> }

function validateWorkspaceConfig(data: Partial<WorkspaceData>) {
  const maxFunctions = parseRequiredIntegerField(data.maxFunctions, { label: 'Máx. funciones', min: 1, max: MAX_FORM_INTEGER })
  const maxDatabases = parseRequiredIntegerField(data.maxDatabases, { label: 'Máx. bases de datos', min: 1, max: MAX_FORM_INTEGER })
  return createValidation({
    ...(maxFunctions.error ? { maxFunctions: maxFunctions.error } : {}),
    ...(maxDatabases.error ? { maxDatabases: maxDatabases.error } : {})
  })
}

function requireWorkspaceLimit(value: string | undefined, label: string) {
  const parsed = parseRequiredIntegerField(value, { label, min: 1, max: MAX_FORM_INTEGER })
  if (parsed.value == null) throw new Error(parsed.error ?? `${label} no es válido.`)
  return parsed.value
}

export function CreateWorkspaceWizard({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated?: () => void }) {
  const { activeTenantId } = useConsoleContext()
  const permission = useWizardPermissionCheck('create_workspace')
  const quota = useWizardQuotaCheck('workspaces.count', 'tenant', activeTenantId, null)
  if (!permission.allowed) return open ? <ConsolePageState kind="blocked" title="Acceso bloqueado" description={permission.reason ?? 'No permitido.'} /> : null
  return <WizardShell<WorkspaceData>
    open={open}
    onOpenChange={onOpenChange}
    title="Nuevo workspace"
    description="Alta guiada de workspace dentro del tenant activo."
    context={{ tenantId: activeTenantId, workspaceId: null, principalRoles: [] }}
    initialData={{ tenantId: activeTenantId ?? '', maxFunctions: '10', maxDatabases: '5' }}
    steps={[
      { id: 'tenant', label: 'Tenant', component: TenantStep, validate: (data) => createValidation(!data.tenantId ? { tenantId: 'Selecciona un tenant.' } : {}) },
      { id: 'name', label: 'Nombre', component: NameStep, validate: (data) => createValidation(!data.name?.trim() ? { name: 'El nombre es obligatorio.' } : {}, quota.available ? undefined : quota.reason ?? 'Sin cuota disponible.') },
      { id: 'config', label: 'Configuración', component: ConfigStep, validate: validateWorkspaceConfig }
    ]}
    buildSummary={(data) => [{ label: 'Tenant', value: data.tenantId ?? '' }, { label: 'Nombre', value: data.name ?? '' }, { label: 'Descripción', value: data.description ?? '' }, { label: 'Máx. funciones', value: data.maxFunctions ?? '' }, { label: 'Máx. bases de datos', value: data.maxDatabases ?? '' }]}
    onSubmit={async (data) => {
      const tenantId = data.tenantId ?? activeTenantId ?? ''
      const maxFunctions = requireWorkspaceLimit(data.maxFunctions, 'Máx. funciones')
      const maxDatabases = requireWorkspaceLimit(data.maxDatabases, 'Máx. bases de datos')
      const response = await submitWizardRequest<{ workspaceId: string }>(`/v1/tenants/${tenantId}/workspaces`, { name: data.name ?? '', description: data.description ?? '', initialLimits: { maxFunctions, maxDatabases } })
      onCreated?.()
      return { resourceId: response.workspaceId, resourceUrl: '/console/workspaces' }
    }}
  />
}
