import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WizardShell } from '@/components/console/wizards/WizardShell'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useConsoleContext } from '@/lib/console-context'
import { createValidation, submitWizardRequest, useWizardPermissionCheck, type WizardStepProps } from '@/lib/console-wizards'

interface IamClientData { workspaceId: string; clientType: string; clientId: string; redirectUris: string; scopes: string[] }

const CLIENT_TYPE_LABELS: Record<string, string> = {
  public: 'Público',
  confidential: 'Confidencial',
  service_account: 'Cuenta de servicio'
}

function WorkspaceStep({ data }: WizardStepProps<IamClientData>) {
  return <div><Label>Área de trabajo</Label><p className="mt-2 text-sm">{data.workspaceId || 'Sin área de trabajo activa'}</p></div>
}

function TypeStep({ data, onChange, validation }: WizardStepProps<IamClientData>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="client-type">Tipo</Label>
        <Select id="client-type" value={data.clientType ?? ''} onChange={(e) => onChange({ clientType: e.target.value })}>
          <option value="">Selecciona</option>
          <option value="public">Público</option>
          <option value="confidential">Confidencial</option>
          <option value="service_account">Cuenta de servicio</option>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="client-id">ID del cliente</Label>
        <Input id="client-id" value={data.clientId ?? ''} onChange={(e) => onChange({ clientId: e.target.value })} />
        {validation.fieldErrors.clientId ? <p className="text-sm text-destructive">{validation.fieldErrors.clientId}</p> : null}
      </div>
    </div>
  )
}

function RedirectStep({ data, onChange, validation }: WizardStepProps<IamClientData>) {
  return (
    <div className="space-y-2">
      <Label htmlFor="redirect-uris">URIs de redirección</Label>
      <Input id="redirect-uris" value={data.redirectUris ?? ''} onChange={(e) => onChange({ redirectUris: e.target.value })} placeholder="https://app.example/callback" />
      {validation.fieldErrors.redirectUris ? <p className="text-sm text-destructive">{validation.fieldErrors.redirectUris}</p> : null}
    </div>
  )
}

function ScopeStep({ data, onChange }: WizardStepProps<IamClientData>) {
  const scopes = ['openid', 'profile', 'email']
  return (
    <div className="space-y-2">
      <Label>Alcances</Label>
      {scopes.map((scope) => (
        <label key={scope} className="flex items-center gap-2 text-sm">
          <Checkbox checked={(data.scopes ?? []).includes(scope)} onChange={(e) => onChange({ scopes: e.currentTarget.checked ? [...(data.scopes ?? []), scope] : (data.scopes ?? []).filter((item) => item !== scope) })} />
          {scope}
        </label>
      ))}
    </div>
  )
}

export function CreateIamClientWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
 const { activeWorkspaceId } = useConsoleContext(); const permission = useWizardPermissionCheck('manage_iam'); if (!permission.allowed) return open ? <ConsolePageState kind="blocked" title="Acceso bloqueado" description={permission.reason ?? 'No permitido.'} /> : null; return <WizardShell<IamClientData> open={open} onOpenChange={onOpenChange} title="Nuevo cliente IAM" description="Alta guiada de cliente IAM." context={{ tenantId: null, workspaceId: activeWorkspaceId, principalRoles: [] }} initialData={{ workspaceId: activeWorkspaceId ?? '', scopes: [] }} steps={[{ id: 'workspace', label: 'Área de trabajo', component: WorkspaceStep, validate: (data) => createValidation(!data.workspaceId ? { workspaceId: 'Selecciona un área de trabajo.' } : {}) },{ id: 'type', label: 'Tipo', component: TypeStep, validate: (data) => createValidation(!data.clientId?.trim() ? { clientId: 'El ID del cliente es obligatorio.' } : {}) },{ id: 'redirects', label: 'URIs de redirección', component: RedirectStep, validate: (data) => createValidation(data.clientType !== 'service_account' && !(data.redirectUris ?? '').includes('://') ? { redirectUris: 'Introduce al menos una URI válida.' } : {}) },{ id: 'scopes', label: 'Alcances', component: ScopeStep, validate: () => createValidation() }]} buildSummary={(data) => [{ label: 'Área de trabajo', value: data.workspaceId ?? '' },{ label: 'Tipo', value: CLIENT_TYPE_LABELS[data.clientType ?? ''] ?? data.clientType ?? '' },{ label: 'ID del cliente', value: data.clientId ?? '' },{ label: 'URIs de redirección', value: data.redirectUris ?? '' },{ label: 'Alcances', value: (data.scopes ?? []).join(', ') }]} onSubmit={async (data) => { const response = await submitWizardRequest<{ iamClientId: string }>(`/v1/workspaces/${data.workspaceId ?? activeWorkspaceId}/iam/clients`, { clientType: data.clientType ?? 'public', clientId: data.clientId ?? '', redirectUris: data.clientType === 'service_account' ? [] : String(data.redirectUris ?? '').split(',').map((item) => item.trim()).filter(Boolean), scopes: data.scopes ?? [], permissions: [] }); return { resourceId: response.iamClientId, resourceUrl: '/console/auth' } }} />
}
