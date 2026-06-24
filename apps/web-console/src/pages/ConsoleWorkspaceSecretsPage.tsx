import { useCallback, useEffect, useMemo, useState } from 'react'

import { ConsolePageState } from '@/components/console/ConsolePageState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import type { ApiError } from '@/lib/http'
import {
  createSecret,
  deleteSecret,
  listSecrets,
  readSecretName,
  secretEnvVarName,
  updateSecret,
  type WorkspaceSecret
} from '@/services/secretsApi'

// Client-side validation mirrors the server contract (FunctionWorkspaceSecret*).
const SECRET_NAME_RE = /^[a-z][a-z0-9_-]{0,62}$/
const VALUE_MAX = 65535

function isApiError(error: unknown): error is ApiError {
  return Boolean(error) && typeof error === 'object' && 'status' in (error as Record<string, unknown>)
}

// Map a server outcome to a distinct, NON-LEAKY operator message. 404 WORKSPACE_NOT_FOUND is
// rendered as a generic "not available" so a cross-tenant/cross-workspace probe never leaks
// existence; 501 SECRETS_BACKEND_DISABLED is surfaced as a first-class informational state by the
// caller (not via this helper). Always defers to the server for mutate authority (403 → clean auth
// error). The X-Correlation-Id (when present) is offered for support.
function describeSecretError(error: unknown, context: 'list' | 'mutate'): string {
  if (!isApiError(error)) {
    return 'Ocurrió un error inesperado. Inténtalo de nuevo.'
  }
  const corr = error.correlationId ? ` (correlación ${error.correlationId})` : ''
  switch (error.status) {
    case 400:
      return `La solicitud no es válida: revisa el nombre y el valor del secreto.${corr}`
    case 403:
      return `No tienes permisos para esta acción en este workspace. La autorización la decide el servidor.${corr}`
    case 404:
      // Could be SECRET_NOT_FOUND or WORKSPACE_NOT_FOUND — render generically (no existence leak).
      return context === 'mutate' && error.code === 'SECRET_NOT_FOUND'
        ? `El secreto ya no existe.${corr}`
        : `El recurso no está disponible para este contexto.${corr}`
    case 409:
      return `Ya existe un secreto con ese nombre. Usa "Reemplazar" para cambiar su valor.${corr}`
    case 413:
      return `El valor del secreto es demasiado grande (máximo ${VALUE_MAX} caracteres).${corr}`
    case 429:
      return `Has superado el límite de operaciones. Espera un momento y reintenta.${corr}`
    case 501:
      return 'El backend de secretos no está disponible en esta instalación.'
    case 502:
      return `El backend de secretos falló al procesar la operación. Reintenta más tarde.${corr}`
    default:
      return `${error.message || 'La operación falló.'}${corr}`
  }
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString()
}

function validateName(name: string): string | null {
  if (!name) {
    return 'El nombre del secreto es obligatorio.'
  }
  if (!SECRET_NAME_RE.test(name)) {
    return 'El nombre debe coincidir con ^[a-z][a-z0-9_-]{0,62}$ (minúsculas, empieza por letra).'
  }
  return null
}

function validateValue(value: string): string | null {
  if (value.length === 0) {
    return 'El valor del secreto es obligatorio.'
  }
  if (value.length > VALUE_MAX) {
    return `El valor no puede superar ${VALUE_MAX} caracteres.`
  }
  return null
}

export function ConsoleWorkspaceSecretsPage() {
  const { activeTenant, activeWorkspace, activeWorkspaceId } = useConsoleContext()

  const [secrets, setSecrets] = useState<WorkspaceSecret[]>([])
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<ApiError | null>(null)

  // Create form. The value is WRITE-ONLY: masked, never pre-filled, cleared after a successful submit.
  const [createName, setCreateName] = useState('')
  const [createValue, setCreateValue] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createValidation, setCreateValidation] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)

  // Replace dialog (value masked, NEVER pre-populated from any read).
  const [replaceTarget, setReplaceTarget] = useState<WorkspaceSecret | null>(null)
  const [replaceValue, setReplaceValue] = useState('')
  const [replaceDescription, setReplaceDescription] = useState('')
  const [replaceValidation, setReplaceValidation] = useState<string | null>(null)
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const [replaceBusy, setReplaceBusy] = useState(false)

  // Delete confirmation (with reference-safety warning).
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceSecret | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [feedback, setFeedback] = useState<string | null>(null)

  const environment = activeWorkspace?.environment ?? null
  const isProduction = environment === 'production' || environment === 'prod'

  const reload = useCallback(async () => {
    if (!activeWorkspaceId) {
      return
    }
    setLoading(true)
    setListError(null)
    try {
      const collection = await listSecrets(activeWorkspaceId)
      setSecrets(Array.isArray(collection.items) ? collection.items : [])
    } catch (error) {
      setListError(isApiError(error) ? error : { status: 0, code: 'UNKNOWN', message: String(error) })
      setSecrets([])
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    // Reset transient form/dialog state whenever the active workspace changes (write-only: never
    // carry a value across a context switch).
    setCreateName('')
    setCreateValue('')
    setCreateDescription('')
    setCreateValidation(null)
    setCreateError(null)
    setReplaceTarget(null)
    setReplaceValue('')
    setReplaceDescription('')
    setDeleteTarget(null)
    setDeleteError(null)
    setFeedback(null)
    if (activeWorkspaceId) {
      void reload()
    } else {
      setSecrets([])
      setListError(null)
    }
  }, [activeWorkspaceId, reload])

  const isEmpty = !loading && !listError && secrets.length === 0

  const header = useMemo(
    () => [activeTenant?.label, activeWorkspace?.label].filter(Boolean).join(' · '),
    [activeTenant?.label, activeWorkspace?.label]
  )

  // No workspace selected → explicit empty state; issue NO request (handled by reload guard).
  if (!activeWorkspaceId) {
    return (
      <ConsolePageState
        kind="blocked"
        title="Selecciona un workspace"
        description="Elige un workspace activo para gestionar sus secretos de función. Cada secreto pertenece a un único workspace."
      />
    )
  }

  // 501 — the secrets backend is off by default; render a first-class informational state (not a
  // repeating error toast). The list read is the authoritative backend-availability signal.
  const backendDisabled = listError?.status === 501

  if (backendDisabled) {
    return (
      <section className="space-y-6" data-testid="workspace-secrets-backend-disabled">
        <header className="rounded-3xl border border-border bg-card/70 p-6">
          <p className="text-sm text-muted-foreground">{header || 'Workspace activo'}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Workspace Secrets</h1>
        </header>
        <ConsolePageState
          kind="blocked"
          title="Backend de secretos no disponible"
          description="El backend de secretos (OpenBao) no está habilitado en esta instalación. Los secretos de workspace estarán disponibles cuando un operador de plataforma lo habilite."
        />
      </section>
    )
  }

  const workspaceId = activeWorkspaceId

  async function handleCreate() {
    setCreateError(null)
    const nameError = validateName(createName)
    const valueError = validateValue(createValue)
    setCreateValidation(nameError ?? valueError)
    if (nameError || valueError) {
      return
    }
    setCreateBusy(true)
    try {
      await createSecret(workspaceId, {
        secretName: createName,
        secretValue: createValue,
        ...(createDescription.trim() ? { description: createDescription.trim() } : {})
      })
      // Write-only: clear the value from component state immediately after a successful create.
      setCreateValue('')
      setCreateName('')
      setCreateDescription('')
      setCreateValidation(null)
      setFeedback(`Secreto "${createName}" creado.`)
      await reload()
    } catch (error) {
      setCreateError(describeSecretError(error, 'mutate'))
    } finally {
      setCreateBusy(false)
    }
  }

  function openReplace(secret: WorkspaceSecret) {
    setReplaceTarget(secret)
    setReplaceValue('') // NEVER pre-fill from any read
    setReplaceDescription(secret.description ?? '')
    setReplaceValidation(null)
    setReplaceError(null)
  }

  async function handleReplace() {
    if (!replaceTarget) {
      return
    }
    setReplaceError(null)
    const valueError = validateValue(replaceValue)
    setReplaceValidation(valueError)
    if (valueError) {
      return
    }
    const name = readSecretName(replaceTarget)
    setReplaceBusy(true)
    try {
      await updateSecret(workspaceId, name, {
        secretValue: replaceValue,
        ...(replaceDescription.trim() ? { description: replaceDescription.trim() } : {})
      })
      // Write-only: clear the value from component state immediately after a successful replace.
      setReplaceValue('')
      setReplaceTarget(null)
      setFeedback(`Secreto "${name}" reemplazado.`)
      await reload()
    } catch (error) {
      setReplaceError(describeSecretError(error, 'mutate'))
    } finally {
      setReplaceBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) {
      return
    }
    setDeleteError(null)
    const name = readSecretName(deleteTarget)
    setDeleteBusy(true)
    try {
      await deleteSecret(workspaceId, name)
      setDeleteTarget(null)
      setFeedback(`Secreto "${name}" eliminado.`)
      await reload()
    } catch (error) {
      setDeleteError(describeSecretError(error, 'mutate'))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <section className="space-y-6" data-testid="workspace-secrets-page">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{header || 'Workspace activo'}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Workspace Secrets</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Secretos de función del workspace activo. Los valores son de solo escritura: se inyectan en el
              entorno de las funciones en el deploy y nunca se muestran aquí.
            </p>
          </div>
          {environment ? (
            <Badge
              variant="outline"
              data-testid="workspace-secrets-stage-badge"
              className={
                isProduction
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-border bg-background text-muted-foreground'
              }
            >
              {isProduction ? 'Producción' : `Entorno: ${environment}`}
            </Badge>
          ) : null}
        </div>
      </header>

      <section className="rounded-3xl border border-border bg-card/70 p-6">
        <h2 className="text-lg font-semibold">Crear secreto</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          El valor se envía cifrado al backend y se elimina del formulario tras crearlo. No hay forma de
          volver a leerlo desde la consola.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Nombre</span>
            <input
              aria-label="Nombre del secreto"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="db_password"
              className="rounded-xl border border-input bg-background px-3 py-2"
            />
            {createName ? (
              <span className="text-xs text-muted-foreground">
                Variable de entorno: <code>{secretEnvVarName(createName)}</code>
              </span>
            ) : null}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Valor</span>
            <input
              type="password"
              autoComplete="new-password"
              aria-label="Valor del secreto"
              value={createValue}
              onChange={(event) => setCreateValue(event.target.value)}
              placeholder="••••••••"
              className="rounded-xl border border-input bg-background px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="font-medium">Descripción (opcional)</span>
            <input
              aria-label="Descripción del secreto"
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              placeholder="Nota no secreta para identificar el secreto"
              className="rounded-xl border border-input bg-background px-3 py-2"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button
            type="button"
            onClick={() => void handleCreate()}
            disabled={createBusy || !createName.trim() || createValue.length === 0}
          >
            {createBusy ? 'Creando…' : 'Crear secreto'}
          </Button>
          {createValidation ? (
            <p role="alert" className="text-sm text-red-700">
              {createValidation}
            </p>
          ) : null}
        </div>
        {createError ? (
          <p role="alert" className="mt-3 text-sm text-red-700" data-testid="workspace-secrets-create-error">
            {createError}
          </p>
        ) : null}
        {feedback ? <p className="mt-3 text-sm text-emerald-700">{feedback}</p> : null}
      </section>

      {loading ? (
        <ConsolePageState kind="loading" title="Cargando secretos" description="Consultando los secretos del workspace activo." />
      ) : null}
      {listError ? (
        <ConsolePageState
          kind="error"
          title="No se pudieron cargar los secretos"
          description={describeSecretError(listError, 'list')}
          actionLabel="Reintentar"
          onAction={() => void reload()}
        />
      ) : null}
      {isEmpty ? (
        <ConsolePageState
          kind="empty"
          title="No hay secretos en este workspace"
          description={`El workspace "${activeWorkspace?.label ?? workspaceId}"${environment ? ` (${environment})` : ''} todavía no tiene secretos. Crea uno con el formulario de arriba.`}
        />
      ) : null}

      {secrets.length > 0 ? (
        <div className="overflow-hidden rounded-3xl border border-border bg-card/70">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Variable de entorno</th>
                <th className="px-4 py-3">Funciones que lo usan</th>
                <th className="px-4 py-3">Creado</th>
                <th className="px-4 py-3">Actualizado</th>
                <th className="px-4 py-3">Descripción</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody data-testid="workspace-secrets-table-body">
              {secrets.map((secret) => {
                const name = readSecretName(secret)
                return (
                  <tr key={name} className="border-b border-border/60">
                    <td className="px-4 py-3 font-medium">{name}</td>
                    <td className="px-4 py-3">
                      <code>{secretEnvVarName(name)}</code>
                    </td>
                    <td className="px-4 py-3">{secret.resolvedRefCount}</td>
                    <td className="px-4 py-3">{formatTimestamp(secret.timestamps?.createdAt)}</td>
                    <td className="px-4 py-3">{formatTimestamp(secret.timestamps?.updatedAt)}</td>
                    <td className="px-4 py-3">{secret.description ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => openReplace(secret)}>
                          Reemplazar
                        </Button>
                        <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteTarget(secret)}>
                          Eliminar
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {replaceTarget ? (
        <div role="dialog" aria-label="Reemplazar secreto" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">Reemplazar "{readSecretName(replaceTarget)}"</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              El valor anterior se sustituye en el mismo path. El campo nunca se rellena con el valor actual.
            </p>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-medium">Nuevo valor</span>
              <input
                type="password"
                autoComplete="new-password"
                aria-label="Nuevo valor del secreto"
                value={replaceValue}
                onChange={(event) => setReplaceValue(event.target.value)}
                placeholder="••••••••"
                className="rounded-xl border border-input bg-background px-3 py-2"
              />
            </label>
            <label className="mt-3 flex flex-col gap-1 text-sm">
              <span className="font-medium">Descripción (opcional)</span>
              <input
                aria-label="Nueva descripción del secreto"
                value={replaceDescription}
                onChange={(event) => setReplaceDescription(event.target.value)}
                className="rounded-xl border border-input bg-background px-3 py-2"
              />
            </label>
            {replaceValidation ? (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {replaceValidation}
              </p>
            ) : null}
            {replaceError ? (
              <p role="alert" className="mt-3 text-sm text-red-700" data-testid="workspace-secrets-replace-error">
                {replaceError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setReplaceTarget(null)
                  setReplaceValue('')
                }}
              >
                Cancelar
              </Button>
              <Button type="button" onClick={() => void handleReplace()} disabled={replaceBusy || replaceValue.length === 0}>
                {replaceBusy ? 'Reemplazando…' : 'Reemplazar'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div role="dialog" aria-label="Eliminar secreto" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">Eliminar "{readSecretName(deleteTarget)}"</h2>
            <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800" data-testid="workspace-secrets-delete-warning">
              {deleteTarget.resolvedRefCount > 0
                ? `Atención: ${deleteTarget.resolvedRefCount} función(es) referencian este secreto. Al eliminarlo, la variable de entorno inyectada desaparecerá en su próximo deploy y podría romper su funcionamiento.`
                : 'Atención: si alguna función referencia este secreto, eliminarlo puede romperla en su próximo deploy (el deploy omite silenciosamente una referencia ausente).'}
            </div>
            {deleteError ? (
              <p role="alert" className="mt-3 text-sm text-red-700" data-testid="workspace-secrets-delete-error">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={deleteBusy}>
                {deleteBusy ? 'Eliminando…' : 'Eliminar secreto'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
