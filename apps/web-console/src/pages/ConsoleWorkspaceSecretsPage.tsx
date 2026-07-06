import { useCallback, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'

import { ConsolePageState } from '@/components/console/ConsolePageState'
import { useModalFocusTrap } from '@/components/console/hooks/useModalFocusTrap'
import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
      return `No tienes permisos para esta acción en esta área de trabajo. La autorización la decide el servidor.${corr}`
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
      return 'El servicio de secretos no está disponible en esta instalación.'
    case 502:
      return `El servicio de secretos falló al procesar la operación. Reintenta más tarde.${corr}`
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

// Accessible modal wrapper built on the shared Dialog primitive (which only renders the backdrop +
// backdrop-click-to-close). This adds the modal a11y the primitive does not: role="dialog" +
// aria-modal, an accessible name (aria-label) + description (aria-describedby), Escape-to-close,
// focus-on-open, a Tab focus-trap, and focus-RETURN to the control that opened it on close, via the
// shared `useModalFocusTrap` hook (also used by DestructiveConfirmationDialog and
// ConsoleServiceAccountsPage's CredentialDisclosureDialog, #783). The accessible name is kept as an
// aria-label so existing `getByRole('dialog', { name })` queries keep matching.
function SecretDialog({
  open,
  label,
  describedById,
  busy,
  onClose,
  children
}: {
  open: boolean
  label: string
  describedById?: string
  busy: boolean
  onClose: () => void
  children: ReactNode
}) {
  const { panelRef, handleTabTrap } = useModalFocusTrap<HTMLDivElement>(open)

  if (!open) {
    return null
  }

  // Escape closes (unless an op is in flight); Tab-cycling is delegated to the shared trap.
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault()
      onClose()
      return
    }
    handleTabTrap(event)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent className="max-w-lg">
        {/* DialogContent does not set the role/name, so the modal semantics live on this inner div
            (also where the test's getByRole('dialog', { name }) resolves). */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          aria-describedby={describedById}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="focus:outline-none"
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
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

  // Stable ids so labels/inputs and alerts/inputs are wired (htmlFor / aria-describedby).
  const createNameId = useId()
  const createValueId = useId()
  const createDescriptionId = useId()
  const createValidationId = useId()
  const replaceValueId = useId()
  const replaceDescriptionId = useId()
  const replaceValidationId = useId()
  const replaceDescId = useId()
  const deleteDescId = useId()

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
      <WorkspaceRequiredState description="Elige un área de trabajo activa para gestionar sus secretos de función. Cada secreto pertenece a una única área de trabajo." />
    )
  }

  // 501 — the secrets backend is off by default; render a first-class informational state (not a
  // repeating error toast). The list read is the authoritative backend-availability signal.
  const backendDisabled = listError?.status === 501

  if (backendDisabled) {
    return (
      <section className="space-y-6" data-testid="workspace-secrets-backend-disabled">
        <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
          <Badge variant="outline">Secretos del área de trabajo</Badge>
          <p className="mt-2 text-sm text-muted-foreground">{header || 'Área de trabajo activa'}</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Secretos del área de trabajo</h1>
        </header>
        <ConsolePageState
          kind="blocked"
          title="Servicio de secretos no disponible"
          description="El servicio de secretos (OpenBao) no está habilitado en esta instalación. Los secretos de área de trabajo estarán disponibles cuando un operador de plataforma lo habilite."
        />
      </section>
    )
  }

  const workspaceId = activeWorkspaceId

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    // A fresh op starts: drop any stale success/feedback so it is not announced as the new outcome.
    setFeedback(null)
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

  function closeReplace() {
    setReplaceTarget(null)
    setReplaceValue('')
  }

  async function handleReplace(event: FormEvent) {
    event.preventDefault()
    if (!replaceTarget) {
      return
    }
    // A fresh op starts: drop any stale success/feedback before the new outcome is announced.
    setFeedback(null)
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
    // A fresh op starts: drop any stale success/feedback before the new outcome is announced.
    setFeedback(null)
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
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline">Secretos del área de trabajo</Badge>
            <div>
              <p className="text-sm text-muted-foreground">{header || 'Área de trabajo activa'}</p>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Secretos del área de trabajo</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Secretos de función del área de trabajo activa. Los valores son de solo escritura: se inyectan en el
                entorno de las funciones en el despliegue y nunca se muestran aquí.
              </p>
            </div>
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

      <section className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Crear secreto</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          El valor se envía cifrado al servicio y se elimina del formulario tras crearlo. No hay forma de
          volver a leerlo desde la consola.
        </p>
        <form className="mt-5 space-y-5" onSubmit={(event) => void handleCreate(event)} noValidate>
          <div className="grid gap-x-4 gap-y-5 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={createNameId}>Nombre</Label>
              <Input
                id={createNameId}
                aria-label="Nombre del secreto"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="db_password"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="text-xs leading-5 text-muted-foreground">
                {createName ? (
                  <>
                    Variable de entorno:{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">{secretEnvVarName(createName)}</code>
                  </>
                ) : (
                  'Minúsculas, empieza por letra. Se expone como variable de entorno en UPPER_SNAKE.'
                )}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={createValueId}>Valor</Label>
              <Input
                id={createValueId}
                type="password"
                autoComplete="new-password"
                aria-label="Valor del secreto"
                value={createValue}
                onChange={(event) => setCreateValue(event.target.value)}
                placeholder="••••••••"
              />
              <span className="text-xs leading-5 text-muted-foreground">
                Solo escritura: nunca se vuelve a mostrar tras guardarlo.
              </span>
            </div>
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label htmlFor={createDescriptionId}>Descripción (opcional)</Label>
              <Input
                id={createDescriptionId}
                aria-label="Descripción del secreto"
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder="Nota no secreta para identificar el secreto"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={createBusy || !createName.trim() || createValue.length === 0}
            >
              {createBusy ? 'Creando…' : 'Crear secreto'}
            </Button>
            {createValidation ? (
              <p id={createValidationId} role="alert" className="text-sm font-medium text-destructive">
                {createValidation}
              </p>
            ) : null}
          </div>
          {createError ? (
            <Alert variant="destructive" data-testid="workspace-secrets-create-error">
              {createError}
            </Alert>
          ) : null}
        </form>
        {/* Outcomes (create / replace / delete) are announced to assistive tech. */}
        <div aria-live="polite" className="mt-4">
          {feedback ? <Alert variant="success">{feedback}</Alert> : null}
        </div>
      </section>

      {loading ? (
        <ConsolePageState kind="loading" title="Cargando secretos" description="Consultando los secretos del área de trabajo activa." />
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
          title="No hay secretos en esta área de trabajo"
          description={`El área de trabajo "${activeWorkspace?.label ?? workspaceId}"${environment ? ` (${environment})` : ''} todavía no tiene secretos. Crea uno con el formulario de arriba.`}
        />
      ) : null}

      {secrets.length > 0 ? (
        <div className="overflow-x-auto rounded-3xl border border-border bg-card/70 shadow-sm">
          <table className="w-full min-w-[64rem] divide-y divide-border text-left text-sm">
            <caption className="sr-only">Secretos de función del área de trabajo activa (solo metadatos; los valores no se muestran)</caption>
            <thead>
              <tr className="bg-muted/40 align-top text-xs uppercase tracking-[0.16em] text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">Nombre</th>
                <th scope="col" className="px-4 py-3 font-medium">Variable de entorno</th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Funciones que lo usan
                  <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
                    Recuento informativo; puede ir por detrás del último despliegue.
                  </span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">Creado</th>
                <th scope="col" className="px-4 py-3 font-medium">Actualizado</th>
                <th scope="col" className="px-4 py-3 font-medium">Descripción</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80" data-testid="workspace-secrets-table-body">
              {secrets.map((secret) => {
                const name = readSecretName(secret)
                return (
                  <tr key={name} className="transition-colors hover:bg-muted/30">
                    <th scope="row" className="px-4 py-4 text-left font-medium text-foreground">{name}</th>
                    <td className="px-4 py-4">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{secretEnvVarName(name)}</code>
                    </td>
                    <td className="px-4 py-4 tabular-nums text-muted-foreground">{secret.resolvedRefCount}</td>
                    <td className="px-4 py-4 text-muted-foreground">{formatTimestamp(secret.timestamps?.createdAt)}</td>
                    <td className="px-4 py-4 text-muted-foreground">{formatTimestamp(secret.timestamps?.updatedAt)}</td>
                    <td className="px-4 py-4 text-muted-foreground">{secret.description ?? '—'}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openReplace(secret)}
                          aria-label={`Reemplazar el secreto ${name}`}
                        >
                          Reemplazar
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => { setFeedback(null); setDeleteError(null); setDeleteTarget(secret) }}
                          aria-label={`Eliminar el secreto ${name}`}
                        >
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

      <SecretDialog
        open={replaceTarget !== null}
        label="Reemplazar secreto"
        describedById={replaceDescId}
        busy={replaceBusy}
        onClose={closeReplace}
      >
        {replaceTarget ? (
          <form onSubmit={(event) => void handleReplace(event)} noValidate className="space-y-5">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground">Reemplazar &ldquo;{readSecretName(replaceTarget)}&rdquo;</h2>
              <p id={replaceDescId} className="text-sm leading-6 text-muted-foreground">
                El valor anterior se sustituye en el mismo path. El campo nunca se rellena con el valor actual.
              </p>
            </div>
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={replaceValueId}>Nuevo valor</Label>
                <Input
                  id={replaceValueId}
                  type="password"
                  autoComplete="new-password"
                  aria-label="Nuevo valor del secreto"
                  aria-describedby={replaceValidation ? replaceValidationId : undefined}
                  value={replaceValue}
                  onChange={(event) => setReplaceValue(event.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={replaceDescriptionId}>Descripción (opcional)</Label>
                <Input
                  id={replaceDescriptionId}
                  aria-label="Nueva descripción del secreto"
                  value={replaceDescription}
                  onChange={(event) => setReplaceDescription(event.target.value)}
                />
              </div>
            </div>
            {replaceValidation ? (
              <p id={replaceValidationId} role="alert" className="text-sm font-medium text-destructive">
                {replaceValidation}
              </p>
            ) : null}
            {replaceError ? (
              <Alert variant="destructive" data-testid="workspace-secrets-replace-error">
                {replaceError}
              </Alert>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={closeReplace} disabled={replaceBusy}>
                Cancelar
              </Button>
              <Button type="submit" disabled={replaceBusy || replaceValue.length === 0}>
                {replaceBusy ? 'Reemplazando…' : 'Reemplazar'}
              </Button>
            </div>
          </form>
        ) : null}
      </SecretDialog>

      <SecretDialog
        open={deleteTarget !== null}
        label="Eliminar secreto"
        describedById={deleteDescId}
        busy={deleteBusy}
        onClose={() => setDeleteTarget(null)}
      >
        {deleteTarget ? (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-foreground">Eliminar &ldquo;{readSecretName(deleteTarget)}&rdquo;</h2>
            <Alert
              id={deleteDescId}
              className="border-amber-500/40 bg-amber-500/10 text-amber-200"
              data-testid="workspace-secrets-delete-warning"
            >
              {deleteTarget.resolvedRefCount > 0
                ? `Atención: ${deleteTarget.resolvedRefCount} función(es) referencian este secreto. Al eliminarlo, la variable de entorno inyectada desaparecerá en su próximo despliegue y podría romper su funcionamiento.`
                : 'Atención: si alguna función referencia este secreto, eliminarlo puede romperla en su próximo despliegue (el despliegue omite silenciosamente una referencia ausente).'}
            </Alert>
            {deleteError ? (
              <Alert variant="destructive" data-testid="workspace-secrets-delete-error">
                {deleteError}
              </Alert>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={deleteBusy}>
                {deleteBusy ? 'Eliminando…' : 'Eliminar secreto'}
              </Button>
            </div>
          </div>
        ) : null}
      </SecretDialog>
    </section>
  )
}
