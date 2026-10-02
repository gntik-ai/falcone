import { useCallback, useEffect, useRef, useState } from 'react'

import { TenantSocialProviderDialog } from '@/components/console/TenantSocialProviderDialog'
import { useConsolePermissions } from '@/lib/console-permissions'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import { useDestructiveOp } from '@/components/console/hooks/useDestructiveOp'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useConsoleContext } from '@/lib/console-context'
import { describeConsoleError, getConsoleErrorStatus } from '@/lib/console-errors'
import { DESTRUCTIVE_OP_LEVELS } from '@/lib/destructive-ops'
import {
  deleteTenantIdentityProvider,
  getTenantAuthConfig,
  updateTenantAuthConfig,
  upsertTenantIdentityProvider,
  type TenantIdentityProvider,
  type TenantAuthConfig,
  type TenantAuthConfigBooleanKey,
  type TenantAuthConfigBooleanPatch
} from '@/services/authConfigApi'

const BOOLEAN_FIELDS: Array<{ key: TenantAuthConfigBooleanKey; label: string; helpText: string }> = [
  {
    key: 'registrationAllowed',
    label: 'Permitir el registro de usuarios',
    helpText: 'Los usuarios pueden crear su propia cuenta desde la pantalla de acceso.'
  },
  {
    key: 'loginWithEmailAllowed',
    label: 'Permitir inicio de sesión con correo electrónico',
    helpText: 'Los usuarios pueden iniciar sesión con su correo electrónico además de su nombre de usuario.'
  },
  {
    key: 'resetPasswordAllowed',
    label: 'Permitir recuperación de contraseña',
    helpText: 'Los usuarios pueden solicitar un enlace para restablecer su contraseña.'
  },
  {
    key: 'rememberMe',
    label: 'Permitir «recordar sesión»',
    helpText: 'Los usuarios pueden mantener la sesión iniciada entre visitas.'
  },
  {
    key: 'verifyEmail',
    label: 'Requerir verificación de correo electrónico',
    helpText: 'Los usuarios nuevos deben verificar su correo electrónico antes de poder acceder.'
  }
]

// Stable id so the checkbox cluster can be exposed to assistive tech as a single named group
// (role="group" + aria-labelledby) headed by the "Métodos de acceso" card title.
const METHODS_HEADING_ID = 'auth-config-methods-heading'

type BooleanDraft = Record<TenantAuthConfigBooleanKey, boolean>

type LoadState = {
  data: TenantAuthConfig | null
  loading: boolean
  error: string | null
  blocked: boolean
}

const EMPTY_STATE: LoadState = { data: null, loading: false, error: null, blocked: false }

function draftFromConfig(config: TenantAuthConfig): BooleanDraft {
  return {
    registrationAllowed: config.registrationAllowed,
    loginWithEmailAllowed: config.loginWithEmailAllowed,
    resetPasswordAllowed: config.resetPasswordAllowed,
    rememberMe: config.rememberMe,
    verifyEmail: config.verifyEmail
  }
}

export function ConsoleAuthConfigPage() {
  const { activeTenantId, activeTenant } = useConsoleContext()
  const canManage = useConsolePermissions().can('tenant.auth-config.manage')
  const [providerDialog, setProviderDialog] = useState<{ tenantId: string; provider: TenantIdentityProvider | null } | null>(null)
  const currentTenantRef = useRef(activeTenantId)
  currentTenantRef.current = activeTenantId
  const [state, setState] = useState<LoadState>(EMPTY_STATE)
  const [draft, setDraft] = useState<BooleanDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [successNotice, setSuccessNotice] = useState<string | null>(null)
  const destructiveOp = useDestructiveOp()
  const successRegionRef = useRef<HTMLDivElement | null>(null)
  const shouldFocusSuccessRef = useRef(false)

  // After a successful Save the primary control (Guardar cambios) disables itself, so keyboard
  // focus would otherwise fall to <body>. Move it to the confirmation region — which also carries
  // the aria-live announcement — so keyboard and screen-reader users stay oriented. Only the Save
  // path arms this flag; IdP deletion returns focus via the confirmation dialog's own focus trap.
  useEffect(() => {
    if (successNotice && shouldFocusSuccessRef.current) {
      shouldFocusSuccessRef.current = false
      successRegionRef.current?.focus()
    }
  }, [successNotice])

  const load = useCallback(async (tenantId: string, signal?: AbortSignal) => {
    setState((current) => ({ ...current, loading: true, error: null, blocked: false }))
    try {
      const data = await getTenantAuthConfig(tenantId)
      if (signal?.aborted) return
      setState({ data, loading: false, error: null, blocked: false })
      setDraft(draftFromConfig(data))
    } catch (error) {
      if (signal?.aborted) return
      const status = getConsoleErrorStatus(error)
      setState({
        data: null,
        loading: false,
        blocked: status === 403,
        error: describeConsoleError(error, 'No se pudo cargar la configuración de autenticación de la organización.')
      })
      setDraft(null)
    }
  }, [])

  useEffect(() => {
    setProviderDialog(null)
    setState(EMPTY_STATE)
    setDraft(null)
    setSaveError(null)
    setSuccessNotice(null)

    if (!activeTenantId) {
      return undefined
    }

    const controller = new AbortController()
    void load(activeTenantId, controller.signal)
    return () => controller.abort()
  }, [activeTenantId, load])

  const isDirty = Boolean(
    state.data && draft && BOOLEAN_FIELDS.some((field) => draft[field.key] !== state.data![field.key])
  )

  function toggleField(key: TenantAuthConfigBooleanKey, checked: boolean) {
    // Editing invalidates the previous save's outcome: clear the success banner (so a stale
    // "actualizada" message never lingers above unsaved changes) and any prior save error.
    setDraft((current) => (current ? { ...current, [key]: checked } : current))
    setSuccessNotice(null)
    setSaveError(null)
  }

  function handleDiscard() {
    // Revert local edits to the last-loaded config without a network round-trip (distinct from
    // "Recargar", which re-fetches from the server).
    if (!state.data) return
    setDraft(draftFromConfig(state.data))
    setSuccessNotice(null)
    setSaveError(null)
  }

  async function handleSave() {
    if (!canManage || !activeTenantId || !state.data || !draft) return

    const patch: TenantAuthConfigBooleanPatch = {}
    for (const field of BOOLEAN_FIELDS) {
      if (draft[field.key] !== state.data[field.key]) {
        patch[field.key] = draft[field.key]
      }
    }
    if (Object.keys(patch).length === 0) return

    setSaving(true)
    setSaveError(null)
    setSuccessNotice(null)
    try {
      const updated = await updateTenantAuthConfig(activeTenantId, patch)
      setState({ data: updated, loading: false, error: null, blocked: false })
      setDraft(draftFromConfig(updated))
      shouldFocusSuccessRef.current = true
      setSuccessNotice('Configuración de autenticación actualizada.')
    } catch (error) {
      setSaveError(describeConsoleError(error, 'No se pudo guardar la configuración de autenticación.'))
    } finally {
      setSaving(false)
    }
  }

  function openDeleteIdentityProviderDialog(alias: string, displayName: string) {
    const tenantId = activeTenantId
    if (!canManage || !tenantId) return

    destructiveOp.openDialog({
      level: DESTRUCTIVE_OP_LEVELS['delete-identity-provider'],
      operationId: 'delete-identity-provider',
      resourceName: displayName || alias,
      resourceType: 'proveedor de identidad',
      impactDescription: 'Los usuarios ya no podrán iniciar sesión con este proveedor social. Esta acción no se puede deshacer desde la consola.',
      onConfirm: async () => {
        await deleteTenantIdentityProvider(tenantId, alias)
      },
      onSuccess: () => {
        // Failures surface inside the confirmation dialog (it stays open on error); success is
        // announced here via the page-level aria-live region.
        setSuccessNotice(`Proveedor "${displayName || alias}" eliminado.`)
        void load(tenantId)
      }
    })
  }

  function providersSaved(tenantId: string, providers: TenantIdentityProvider[]) {
    if (currentTenantRef.current !== tenantId) return
    setState((current) => ({ ...current, data: current.data ? { ...current.data, identityProviders: providers } : null }))
    setProviderDialog(null)
    setSuccessNotice('Proveedor de identidad actualizado.')
  }

  async function toggleProvider(provider: TenantIdentityProvider) {
    if (!canManage || !activeTenantId) return
    const tenantId = activeTenantId
    setSaving(true)
    setSaveError(null)
    try {
      const result = await upsertTenantIdentityProvider(tenantId, provider.alias, { providerId: provider.providerId, enabled: !provider.enabled })
      providersSaved(tenantId, result.identityProviders)
    } catch (error) {
      if (currentTenantRef.current === tenantId) setSaveError(describeConsoleError(error, 'No se pudo actualizar el proveedor.'))
    } finally {
      setSaving(false)
    }
  }

  async function copyCallback(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setSuccessNotice('URL de callback copiada.')
    } catch {
      setSaveError('No se pudo copiar la URL. Selecciona y copia el texto manualmente.')
    }
  }

  if (!activeTenantId) {
    return (
      <ConsolePageState
        kind="empty"
        title="Selecciona una organización"
        description="Elige una organización activa para ver y editar la configuración de autenticación de su realm."
      />
    )
  }

  return (
    <section className="space-y-6" aria-label="Autenticación de la organización" data-testid="console-auth-config-page">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline">Autenticación</Badge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Autenticación de la organización</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Ajustes de acceso del realm de {activeTenant?.label ?? 'la organización activa'}: registro, inicio de
                sesión, recuperación de contraseña, verificación de correo y proveedores de identidad configurados.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Organización: {activeTenant?.label ?? activeTenantId}</Badge>
            {state.data ? <Badge variant="secondary">Realm: {state.data.realm}</Badge> : null}
          </div>
        </div>
      </header>

      {state.loading ? (
        <ConsolePageState kind="loading" title="Cargando configuración" description="Consultando el realm de la organización activa." />
      ) : null}

      {!state.loading && state.blocked ? (
        <ConsolePageState
          kind="blocked"
          title="Sin permiso para esta organización"
          description={state.error ?? 'No tienes permiso para ver este recurso.'}
        />
      ) : null}

      {!state.loading && !state.blocked && state.error ? (
        <ConsolePageState
          kind="error"
          title="No se pudo cargar la configuración"
          description={state.error}
          actionLabel="Reintentar"
          onAction={() => void load(activeTenantId)}
        />
      ) : null}

      {!state.loading && !state.blocked && !state.error && state.data && draft ? (
        <>
          <div
            ref={successRegionRef}
            tabIndex={-1}
            aria-live="polite"
            className="rounded-2xl outline-none empty:hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {successNotice ? <Alert variant="success">{successNotice}</Alert> : null}
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle id={METHODS_HEADING_ID}>Métodos de acceso</CardTitle>
                <CardDescription>Elige cómo pueden acceder los usuarios al realm de tu organización.</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void load(activeTenantId)} disabled={saving}>
                Recargar
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {saveError ? <Alert variant="destructive">{saveError}</Alert> : null}
              <div
                role="group"
                aria-labelledby={METHODS_HEADING_ID}
                className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-background/40"
              >
                {BOOLEAN_FIELDS.map((field) => {
                  const fieldId = `auth-config-${field.key}`
                  const helpId = `${fieldId}-help`
                  return (
                    <div key={field.key} className="flex items-start gap-3 p-4 transition-colors hover:bg-muted/20">
                      <Checkbox
                        id={fieldId}
                        aria-describedby={helpId}
                        checked={draft[field.key]}
                        onChange={(event) => toggleField(field.key, event.target.checked)}
                        disabled={saving || !canManage}
                        className="mt-0.5"
                      />
                      <div className="space-y-1">
                        <Label htmlFor={fieldId} className="cursor-pointer">{field.label}</Label>
                        <p id={helpId} className="text-xs leading-5 text-muted-foreground">{field.helpText}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
              {canManage ? <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
                <Button type="button" onClick={() => void handleSave()} disabled={!isDirty || saving} aria-busy={saving}>
                  {saving ? 'Guardando…' : 'Guardar cambios'}
                </Button>
                {isDirty && !saving ? (
                  <Button type="button" variant="ghost" onClick={handleDiscard}>
                    Descartar cambios
                  </Button>
                ) : null}
                {isDirty && !saving ? (
                  <span className="text-xs text-muted-foreground">Tienes cambios sin guardar.</span>
                ) : null}
              </div> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Proveedores de identidad</CardTitle>
                <CardDescription>{canManage ? 'Crea y administra los proveedores sociales de este realm.' : 'Proveedores sociales configurados para este realm (solo lectura).'}</CardDescription>
              </div>
              <Badge variant="outline">{state.data.identityProviders.length} configurado(s)</Badge>
              {canManage ? <Button type="button" disabled={saving} onClick={() => setProviderDialog({ tenantId: activeTenantId, provider: null })}>Crear proveedor</Button> : null}
            </CardHeader>
            <CardContent>
              {state.data.identityProviders.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border/70 bg-background/40 px-4 py-6 text-center text-sm text-muted-foreground">
                  No hay proveedores de identidad configurados para este realm.
                </p>
              ) : (
                <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-background/40">
                  {state.data.identityProviders.map((provider) => {
                    const providerName = provider.displayName || provider.alias
                    return (
                      <li
                        key={provider.alias}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 transition-colors hover:bg-muted/20"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{providerName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            alias <span className="font-mono text-foreground">{provider.alias}</span>
                            <span aria-hidden="true" className="px-1.5 text-muted-foreground/60">·</span>
                            tipo <span className="font-mono text-foreground">{provider.providerId}</span>
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">{provider.clientSecretSet ? 'Secreto configurado' : 'Sin secreto configurado'}</p>
                          {provider.callbackUrl ? <div className="mt-2 space-y-1">
                            <p className="text-xs">URL de callback: <code className="break-all">{provider.callbackUrl}</code></p>
                            <Button type="button" size="sm" variant="outline" aria-label={`Copiar URL de callback de ${providerName}`} onClick={() => void copyCallback(provider.callbackUrl!)}>Copiar URL</Button>
                          </div> : <p className="mt-2 text-xs text-muted-foreground">URL pública no configurada. Usa la base pública de Keycloak seguida de <code className="break-all">/realms/{encodeURIComponent(state.data!.realm)}/broker/{encodeURIComponent(provider.alias)}/endpoint</code>.</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={provider.enabled ? 'secondary' : 'outline'}>
                            {provider.enabled ? 'Habilitado' : 'Deshabilitado'}
                          </Badge>
                          {canManage ? <>
                          <Button type="button" size="sm" variant="outline" disabled={saving} aria-label={`Editar proveedor de identidad ${providerName}`} onClick={() => setProviderDialog({ tenantId: activeTenantId, provider })}>Editar</Button>
                          <Button type="button" size="sm" variant="outline" disabled={saving} aria-label={`${provider.enabled ? 'Deshabilitar' : 'Habilitar'} proveedor de identidad ${providerName}`} onClick={() => void toggleProvider(provider)}>{provider.enabled ? 'Deshabilitar' : 'Habilitar'}</Button>
                          <Button
                            type="button"
                            disabled={saving}
                            variant="destructive"
                            size="sm"
                            aria-label={`Eliminar proveedor de identidad ${providerName}`}
                            onClick={() => openDeleteIdentityProviderDialog(provider.alias, providerName)}
                          >
                            Eliminar
                          </Button>
                          </> : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {canManage && providerDialog && providerDialog.tenantId === activeTenantId && state.data ? (
        <TenantSocialProviderDialog key={`${activeTenantId}:${providerDialog.provider?.alias ?? 'new'}`} tenantId={activeTenantId}
          provider={providerDialog.provider} aliases={state.data.identityProviders.map((p) => p.alias)}
          onClose={() => setProviderDialog(null)} onSaved={(providers) => providersSaved(activeTenantId, providers)} />
      ) : null}

      <DestructiveConfirmationDialog
        open={destructiveOp.isOpen}
        config={destructiveOp.config}
        opState={destructiveOp.opState}
        confirmError={destructiveOp.confirmError}
        onConfirm={() => void destructiveOp.handleConfirm()}
        onCancel={destructiveOp.handleCancel}
      />
    </section>
  )
}
