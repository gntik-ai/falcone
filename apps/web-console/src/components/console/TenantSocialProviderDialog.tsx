import { useRef, useState, type FormEvent } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { describeConsoleError } from '@/lib/console-errors'
import { SOCIAL_PROVIDER_TEMPLATES, upsertTenantIdentityProvider, type TenantIdentityProvider } from '@/services/authConfigApi'

export function TenantSocialProviderDialog({ tenantId, provider, aliases, onClose, onSaved }: {
  tenantId: string
  provider: TenantIdentityProvider | null
  aliases: string[]
  onClose: () => void
  onSaved: (providers: TenantIdentityProvider[]) => void
}) {
  const [providerId, setProviderId] = useState(provider?.providerId ?? 'google')
  const [alias, setAlias] = useState(provider?.alias ?? 'google')
  const [displayName, setDisplayName] = useState(provider?.displayName ?? '')
  const [clientId, setClientId] = useState(provider?.clientId ?? '')
  const [defaultScope, setDefaultScope] = useState(provider?.defaultScope ?? '')
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Never put the secret in React state or browser storage; clear the input before awaiting.
  const secretRef = useRef<HTMLInputElement>(null)
  const duplicate = !provider && aliases.includes(alias)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || duplicate) return
    const clientSecret = secretRef.current?.value ?? ''
    if (secretRef.current) secretRef.current.value = ''
    setSaving(true)
    setError(null)
    try {
      const result = await upsertTenantIdentityProvider(tenantId, alias, {
        providerId, displayName, enabled,
        config: { clientId, defaultScope, ...(clientSecret ? { clientSecret } : {}) }
      })
      onSaved(result.identityProviders)
    } catch (cause) {
      setError(describeConsoleError(cause, 'No se pudo guardar el proveedor. Si introdujiste un secreto, vuelve a introducirlo.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }} closeOnEscape={!saving}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{provider ? 'Editar proveedor de identidad' : 'Crear proveedor de identidad'}</DialogTitle>
          <DialogDescription>Configura una plantilla social y registra su URL de callback en el proveedor.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          {duplicate ? <Alert variant="destructive">Ya existe un proveedor con este alias.</Alert> : null}
          <div><Label htmlFor="social-template">Plantilla</Label>
            <Select id="social-template" value={providerId} disabled={Boolean(provider) || saving} onChange={(event) => {
              setProviderId(event.target.value); setAlias(event.target.value)
            }}>
              {SOCIAL_PROVIDER_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
            </Select>
          </div>
          <div><Label htmlFor="social-alias">Alias</Label><Input id="social-alias" value={alias} required pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}" maxLength={64} disabled={Boolean(provider) || saving} onChange={(event) => setAlias(event.target.value)} /></div>
          <div><Label htmlFor="social-name">Nombre visible</Label><Input id="social-name" value={displayName} maxLength={256} disabled={saving} onChange={(event) => setDisplayName(event.target.value)} /></div>
          <div><Label htmlFor="social-client-id">Client ID</Label><Input id="social-client-id" value={clientId} required maxLength={4096} disabled={saving} onChange={(event) => setClientId(event.target.value)} /></div>
          <div><Label htmlFor="social-secret">Client secret</Label><Input id="social-secret" ref={secretRef} type="password" autoComplete="new-password" required={!provider} maxLength={4096} disabled={saving} aria-describedby="social-secret-help" />
            <p id="social-secret-help" className="text-sm text-muted-foreground">{provider?.clientSecretSet ? 'Secreto configurado. Déjalo vacío para conservarlo o introduce uno nuevo para reemplazarlo.' : 'Introduce el secreto del proveedor. Solo se envía al guardar y nunca se muestra de nuevo.'}</p>
          </div>
          <div><Label htmlFor="social-scope">Scope predeterminado</Label><Input id="social-scope" value={defaultScope} maxLength={4096} disabled={saving} onChange={(event) => setDefaultScope(event.target.value)} /></div>
          <div className="flex items-center gap-2"><Checkbox id="social-enabled" checked={enabled} disabled={saving} onChange={(event) => setEnabled(event.target.checked)} /><Label htmlFor="social-enabled">Habilitado</Label></div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={saving || duplicate}>{saving ? 'Guardando…' : 'Guardar proveedor'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
