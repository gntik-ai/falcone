import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WizardShell } from '@/components/console/wizards/WizardShell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useConsoleContext } from '@/lib/console-context'
import {
  FORM_FIELD_ERROR_CLASS_NAME,
  INVALID_FORM_CONTROL_CLASS_NAME,
  parseRequiredIntegerField
} from '@/lib/console-create-form-validation'
import { createValidation, submitWizardRequest, useWizardPermissionCheck, useWizardQuotaCheck, type WizardStepProps } from '@/lib/console-wizards'

interface FnData { workspaceId: string; name: string; description: string; runtime: string; memoryMb: string; timeoutMs: string; route: string }
const FUNCTION_MEMORY_MIN_MB = 128
const FUNCTION_MEMORY_MAX_MB = 2048
const FUNCTION_TIMEOUT_MIN_MS = 1
const FUNCTION_TIMEOUT_MAX_MS = 900000
function WorkspaceStep({ data }: WizardStepProps<FnData>) { return <div><Label>Workspace</Label><p className="mt-2 text-sm">{data.workspaceId || 'Sin workspace activo'}</p></div> }
function MetaStep({ data, onChange, validation }: WizardStepProps<FnData>) {
  return (
    <div className="grid gap-4">
      <div className="space-y-2">
        <Label htmlFor="fn-name">Nombre</Label>
        <Input
          id="fn-name"
          aria-invalid={Boolean(validation.fieldErrors.name) || undefined}
          className={validation.fieldErrors.name ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
          value={data.name ?? ''}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        {validation.fieldErrors.name ? <p className={FORM_FIELD_ERROR_CLASS_NAME}>{validation.fieldErrors.name}</p> : null}
        {validation.blockingError ? <p className={FORM_FIELD_ERROR_CLASS_NAME}>{validation.blockingError}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="fn-description">Descripción</Label>
        <Textarea id="fn-description" value={data.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} />
      </div>
    </div>
  )
}
function RuntimeStep({ data, onChange, validation }: WizardStepProps<FnData>) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="min-w-0 space-y-2">
        <Label htmlFor="fn-runtime">Runtime</Label>
        <Select
          id="fn-runtime"
          aria-invalid={Boolean(validation.fieldErrors.runtime) || undefined}
          aria-describedby={validation.fieldErrors.runtime ? 'fn-runtime-error' : undefined}
          className={validation.fieldErrors.runtime ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
          value={data.runtime ?? ''}
          onChange={(e) => onChange({ runtime: e.target.value })}
        >
          <option value="">Selecciona runtime</option>
          <option value="nodejs:18">nodejs:18</option>
          <option value="nodejs:20">nodejs:20</option>
        </Select>
        {validation.fieldErrors.runtime ? (
          <p id="fn-runtime-error" className={FORM_FIELD_ERROR_CLASS_NAME}>
            {validation.fieldErrors.runtime}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 space-y-2">
        <Label htmlFor="fn-memory">Memoria (MB)</Label>
        <Input
          id="fn-memory"
          inputMode="numeric"
          aria-invalid={Boolean(validation.fieldErrors.memoryMb) || undefined}
          aria-describedby={validation.fieldErrors.memoryMb ? 'fn-memory-error' : undefined}
          className={validation.fieldErrors.memoryMb ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
          value={data.memoryMb ?? '256'}
          onChange={(e) => onChange({ memoryMb: e.target.value })}
        />
        {validation.fieldErrors.memoryMb ? (
          <p id="fn-memory-error" className={FORM_FIELD_ERROR_CLASS_NAME}>
            {validation.fieldErrors.memoryMb}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 space-y-2">
        <Label htmlFor="fn-timeout">Timeout (ms)</Label>
        <Input
          id="fn-timeout"
          inputMode="numeric"
          aria-invalid={Boolean(validation.fieldErrors.timeoutMs) || undefined}
          aria-describedby={validation.fieldErrors.timeoutMs ? 'fn-timeout-error' : undefined}
          className={validation.fieldErrors.timeoutMs ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
          value={data.timeoutMs ?? '30000'}
          onChange={(e) => onChange({ timeoutMs: e.target.value })}
        />
        {validation.fieldErrors.timeoutMs ? (
          <p id="fn-timeout-error" className={FORM_FIELD_ERROR_CLASS_NAME}>
            {validation.fieldErrors.timeoutMs}
          </p>
        ) : null}
      </div>
    </div>
  )
}
function TriggerStep({ data, onChange, validation }: WizardStepProps<FnData>) {
  return (
    <div className="space-y-2">
      <Label htmlFor="fn-route">Ruta HTTP</Label>
      <Input
        id="fn-route"
        aria-invalid={Boolean(validation.fieldErrors.route) || undefined}
        className={validation.fieldErrors.route ? INVALID_FORM_CONTROL_CLASS_NAME : undefined}
        value={data.route ?? ''}
        onChange={(e) => onChange({ route: e.target.value })}
        placeholder="/fn/hello"
      />
      {validation.fieldErrors.route ? <p className={FORM_FIELD_ERROR_CLASS_NAME}>{validation.fieldErrors.route}</p> : null}
    </div>
  )
}

function validateRuntimeStep(data: Partial<FnData>) {
  const memoryMb = parseRequiredIntegerField(data.memoryMb, { label: 'Memoria', min: FUNCTION_MEMORY_MIN_MB, max: FUNCTION_MEMORY_MAX_MB })
  const timeoutMs = parseRequiredIntegerField(data.timeoutMs, { label: 'Timeout', min: FUNCTION_TIMEOUT_MIN_MS, max: FUNCTION_TIMEOUT_MAX_MS })
  return createValidation({
    ...(!data.runtime ? { runtime: 'Selecciona un runtime.' } : {}),
    ...(memoryMb.error ? { memoryMb: memoryMb.error } : {}),
    ...(timeoutMs.error ? { timeoutMs: timeoutMs.error } : {})
  })
}

function requireFunctionLimit(value: string | undefined, label: string, min: number, max: number) {
  const parsed = parseRequiredIntegerField(value, { label, min, max })
  if (parsed.value == null) throw new Error(parsed.error ?? `${label} no es válido.`)
  return parsed.value
}

export function PublishFunctionWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) { const { activeTenantId, activeWorkspaceId } = useConsoleContext(); const permission = useWizardPermissionCheck('publish_function'); const quota = useWizardQuotaCheck('functions.count', 'workspace', activeTenantId, activeWorkspaceId); if (!permission.allowed) return open ? <ConsolePageState kind="blocked" title="Acceso bloqueado" description={permission.reason ?? 'No permitido.'} /> : null; return <WizardShell<FnData> open={open} onOpenChange={onOpenChange} title="Publicar función" description="Publicación guiada de función serverless." context={{ tenantId: activeTenantId, workspaceId: activeWorkspaceId, principalRoles: [] }} initialData={{ workspaceId: activeWorkspaceId ?? '', memoryMb: '256', timeoutMs: '30000', route: '/fn/new' }} steps={[{ id: 'workspace', label: 'Workspace', component: WorkspaceStep, validate: (data) => createValidation(!data.workspaceId ? { workspaceId: 'Selecciona un workspace.' } : {}) },{ id: 'meta', label: 'Metadatos', component: MetaStep, validate: (data) => createValidation(!data.name?.trim() ? { name: 'El nombre es obligatorio.' } : {}, quota.available ? undefined : quota.reason ?? 'Sin cuota disponible.') },{ id: 'runtime', label: 'Runtime', component: RuntimeStep, validate: validateRuntimeStep },{ id: 'trigger', label: 'Trigger', component: TriggerStep, validate: (data) => createValidation(!(data.route ?? '').startsWith('/') ? { route: 'La ruta debe empezar por /.' } : {}) }]} buildSummary={(data) => [{ label: 'Workspace', value: data.workspaceId ?? '' },{ label: 'Nombre', value: data.name ?? '' },{ label: 'Descripción', value: data.description ?? '' },{ label: 'Runtime', value: data.runtime ?? '' },{ label: 'Memoria', value: data.memoryMb ?? '' },{ label: 'Timeout', value: data.timeoutMs ?? '' },{ label: 'Ruta', value: data.route ?? '' }]} onSubmit={async (data) => { const memoryMb = requireFunctionLimit(data.memoryMb, 'Memoria', FUNCTION_MEMORY_MIN_MB, FUNCTION_MEMORY_MAX_MB); const timeoutMs = requireFunctionLimit(data.timeoutMs, 'Timeout', FUNCTION_TIMEOUT_MIN_MS, FUNCTION_TIMEOUT_MAX_MS); const response = await submitWizardRequest<{ functionId: string }>(`/v1/workspaces/${data.workspaceId ?? activeWorkspaceId}/functions`, { name: data.name ?? '', description: data.description ?? '', runtime: data.runtime ?? '', limits: { memoryMb, timeoutMs }, trigger: { kind: 'http', route: data.route ?? '/fn/new' } }); return { resourceId: response.functionId, resourceUrl: '/console/functions' } }} /> }
