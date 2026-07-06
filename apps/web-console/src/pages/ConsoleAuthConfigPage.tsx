// Tenant realm auth-config console surface (change: add-console-auth-config-management, #782).
//
// The backend (`GET`/`PUT /v1/tenants/{tenantId}/auth-config`) has been owner-authorized and
// reconciled to Keycloak all along; this page is the first console surface that calls it. A tenant
// owner/admin (or superadmin) can view the realm's login settings — registration, email login,
// password reset, remember-me, email verification — toggle any of them, and Save (PUT only the
// changed booleans, per the server's partial-patch contract). Configured social identity providers
// are listed read-only, with a guarded delete (create/update of a provider is deferred — see the
// OpenSpec change's design notes).
import { useCallback, useEffect, useRef, useState } from 'react'

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
    if (!activeTenantId || !state.data || !draft) return

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
    if (!tenantId) return

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
                        disabled={saving}
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
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
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Proveedores de identidad</CardTitle>
                <CardDescription>Proveedores sociales configurados para este realm (solo lectura).</CardDescription>
              </div>
              <Badge variant="outline">{state.data.identityProviders.length} configurado(s)</Badge>
            </CardHeader>
            <CardContent>
              {state.data.identityProviders.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border/70 bg-background/40 px-4 py-6 text-center text-sm text-muted-foreground">
                  No hay proveedores de identidad configurados para este realm.
                </p>
              ) : (
                <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-background/40">
                  {state.data.identityProviders.map((provider) => {
                    const providerName = provider.displayName ?? provider.alias
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
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={provider.enabled ? 'secondary' : 'outline'}>
                            {provider.enabled ? 'Habilitado' : 'Deshabilitado'}
                          </Badge>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            aria-label={`Eliminar proveedor de identidad ${providerName}`}
                            onClick={() => openDeleteIdentityProviderDialog(provider.alias, providerName)}
                          >
                            Eliminar
                          </Button>
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
