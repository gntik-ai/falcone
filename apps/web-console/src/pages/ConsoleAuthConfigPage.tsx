// Tenant realm auth-config console surface (change: add-console-auth-config-management, #782).
//
// The backend (`GET`/`PUT /v1/tenants/{tenantId}/auth-config`) has been owner-authorized and
// reconciled to Keycloak all along; this page is the first console surface that calls it. A tenant
// owner/admin (or superadmin) can view the realm's login settings — registration, email login,
// password reset, remember-me, email verification — toggle any of them, and Save (PUT only the
// changed booleans, per the server's partial-patch contract). Configured social identity providers
// are listed read-only, with a guarded delete (create/update of a provider is deferred — see the
// OpenSpec change's design notes).
import { useCallback, useEffect, useState } from 'react'

import { ConsolePageState } from '@/components/console/ConsolePageState'
import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import { useDestructiveOp } from '@/components/console/hooks/useDestructiveOp'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  const [idpActionError, setIdpActionError] = useState<string | null>(null)
  const destructiveOp = useDestructiveOp()

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
    setIdpActionError(null)

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
        setIdpActionError(null)
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
    <main className="space-y-6" data-testid="console-auth-config-page">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Autenticación de la organización</h1>
        <p className="text-sm text-muted-foreground">
          Ajustes de acceso del realm de {activeTenant?.label ?? 'la organización activa'}: registro, inicio de
          sesión, recuperación de contraseña, verificación de correo y proveedores de identidad configurados.
        </p>
      </section>

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
          <div aria-live="polite" role="status" className="empty:hidden">
            {successNotice ? (
              <p className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-emerald-100">
                {successNotice}
              </p>
            ) : null}
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Métodos de acceso</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Realm: {state.data.realm}</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void load(activeTenantId)} disabled={saving}>
                Recargar
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {saveError ? <Alert variant="destructive">{saveError}</Alert> : null}
              <div className="space-y-4">
                {BOOLEAN_FIELDS.map((field) => (
                  <div key={field.key} className="flex items-start gap-3">
                    <Checkbox
                      id={`auth-config-${field.key}`}
                      checked={draft[field.key]}
                      onChange={(event) =>
                        setDraft((current) => (current ? { ...current, [field.key]: event.target.checked } : current))
                      }
                      disabled={saving}
                    />
                    <div className="space-y-0.5">
                      <Label htmlFor={`auth-config-${field.key}`}>{field.label}</Label>
                      <p className="text-xs text-muted-foreground">{field.helpText}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button type="button" onClick={() => void handleSave()} disabled={!isDirty || saving} aria-busy={saving}>
                  {saving ? 'Guardando…' : 'Guardar cambios'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Proveedores de identidad</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Proveedores sociales configurados para este realm (solo lectura).</p>
              </div>
              <Badge variant="outline">{state.data.identityProviders.length} configurado(s)</Badge>
            </CardHeader>
            <CardContent>
              {idpActionError ? <Alert variant="destructive" className="mb-3">{idpActionError}</Alert> : null}
              {state.data.identityProviders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay proveedores de identidad configurados para este realm.</p>
              ) : (
                <ul className="space-y-2">
                  {state.data.identityProviders.map((provider) => (
                    <li
                      key={provider.alias}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{provider.displayName ?? provider.alias}</p>
                        <p className="text-xs text-muted-foreground">alias: {provider.alias} · tipo: {provider.providerId}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={provider.enabled ? 'default' : 'secondary'}>
                          {provider.enabled ? 'Habilitado' : 'Deshabilitado'}
                        </Badge>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => openDeleteIdentityProviderDialog(provider.alias, provider.displayName ?? provider.alias)}
                        >
                          Eliminar
                        </Button>
                      </div>
                    </li>
                  ))}
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
    </main>
  )
}
