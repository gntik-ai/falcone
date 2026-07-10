import { Fragment, useCallback, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import { useDestructiveOp } from '@/components/console/hooks/useDestructiveOp'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getConsoleContextStatusBadgeClasses, useConsoleContext } from '@/lib/console-context'
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

type CreateValidationState = {
  name: string | null
  value: string | null
}

type SecretFeedback = {
  message: string
  targetName: string
  placement: 'create' | 'row' | 'table'
}

const EMPTY_CREATE_VALIDATION: CreateValidationState = { name: null, value: null }

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

// Accessible modal wrapper built on the shared Dialog primitive. The accessible name is kept as an
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
  if (!open) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent className="max-w-lg" aria-label={label} aria-describedby={describedById}>
        <div>
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function WorkspaceSecretsBreadcrumb({
  workspaceId,
  workspaceLabel
}: {
  workspaceId: string
  workspaceLabel: string | null | undefined
}) {
  return (
    <nav aria-label="Navegación de secretos del área de trabajo" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Link to="/console/workspaces" className="font-medium text-foreground underline-offset-4 hover:underline">
        Áreas de trabajo
      </Link>
      <span aria-hidden="true">›</span>
      <Link
        to={`/console/workspaces/${workspaceId}`}
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        {workspaceLabel ?? workspaceId}
      </Link>
      <span aria-hidden="true">›</span>
      <span>Secretos</span>
    </nav>
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
  const [createValidation, setCreateValidation] = useState<CreateValidationState>(EMPTY_CREATE_VALIDATION)
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
  const destructiveOp = useDestructiveOp()

  const [feedback, setFeedback] = useState<SecretFeedback | null>(null)

  // Stable ids so labels/inputs and alerts/inputs are wired (htmlFor / aria-describedby).
  const createNameId = useId()
  const createNameHelpId = useId()
  const createNameErrorId = useId()
  const createValueId = useId()
  const createValueHelpId = useId()
  const createValueErrorId = useId()
  const createDescriptionId = useId()
  const replaceValueId = useId()
  const replaceDescriptionId = useId()
  const replaceValidationId = useId()
  const replaceDescId = useId()

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
    setCreateValidation(EMPTY_CREATE_VALIDATION)
    setCreateError(null)
    setReplaceTarget(null)
    setReplaceValue('')
    setReplaceDescription('')
    destructiveOp.handleCancel()
    setFeedback(null)
    if (activeWorkspaceId) {
      void reload()
    } else {
      setSecrets([])
      setListError(null)
    }
  }, [activeWorkspaceId, destructiveOp.handleCancel, reload])

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
        <header className="space-y-2 rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6">
          <WorkspaceSecretsBreadcrumb workspaceId={activeWorkspaceId} workspaceLabel={activeWorkspace?.label} />
          <Badge variant="outline">Secretos del área de trabajo</Badge>
          <div>
            <p className="text-sm text-muted-foreground">{header || 'Área de trabajo activa'}</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Secretos del área de trabajo</h1>
          </div>
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
  const createNameDescribedBy = [createNameHelpId, createValidation.name ? createNameErrorId : null].filter(Boolean).join(' ') || undefined
  const createValueDescribedBy = [createValueHelpId, createValidation.value ? createValueErrorId : null].filter(Boolean).join(' ') || undefined
  const tableLevelFeedback =
    feedback && feedback.placement !== 'create' && (
      feedback.placement === 'table' ||
      !secrets.some((secret) => readSecretName(secret) === feedback.targetName)
    )
      ? feedback
      : null

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    // A fresh op starts: drop any stale success/feedback so it is not announced as the new outcome.
    setFeedback(null)
    setCreateError(null)
    const nameError = validateName(createName)
    const valueError = validateValue(createValue)
    setCreateValidation({ name: nameError, value: valueError })
    if (nameError || valueError) {
      return
    }
    const name = createName
    setCreateBusy(true)
    try {
      await createSecret(workspaceId, {
        secretName: name,
        secretValue: createValue,
        ...(createDescription.trim() ? { description: createDescription.trim() } : {})
      })
      // Write-only: clear the value from component state immediately after a successful create.
      setCreateValue('')
      setCreateName('')
      setCreateDescription('')
      setCreateValidation(EMPTY_CREATE_VALIDATION)
      setFeedback({ message: `Secreto "${name}" creado.`, targetName: name, placement: 'create' })
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
      setFeedback({ message: `Secreto "${name}" reemplazado.`, targetName: name, placement: 'row' })
      await reload()
    } catch (error) {
      setReplaceError(describeSecretError(error, 'mutate'))
    } finally {
      setReplaceBusy(false)
    }
  }

  function openDelete(secret: WorkspaceSecret) {
    setFeedback(null)
    const name = readSecretName(secret)
    const refCount = Math.max(0, Number.isFinite(secret.resolvedRefCount) ? secret.resolvedRefCount : 0)
    const requiresTypedConfirmation = refCount > 0 || isProduction
    const impactParts = [
      refCount > 0
        ? `${refCount} función(es) referencian este secreto. Al eliminarlo, la variable de entorno inyectada desaparecerá en su próximo despliegue y podría romper su funcionamiento.`
        : 'No hay funciones referenciadas detectadas ahora, pero una referencia ausente se omite silenciosamente durante el despliegue.',
      isProduction
        ? 'El área de trabajo activa está marcada como producción; confirma explícitamente antes de eliminar un secreto de este entorno.'
        : null
    ].filter(Boolean)

    destructiveOp.openDialog({
      level: requiresTypedConfirmation ? 'CRITICAL' : 'WARNING',
      operationId: 'delete-workspace-secret',
      resourceName: name,
      resourceType: 'secreto del área de trabajo',
      cascadeImpact: refCount > 0 ? [{ resourceType: 'funciones que lo usan', count: refCount }] : [],
      impactDescription: impactParts.join(' '),
      onConfirm: async () => {
        await deleteSecret(workspaceId, name)
      },
      onSuccess: () => {
        setFeedback({ message: `Secreto "${name}" eliminado.`, targetName: name, placement: 'table' })
        void reload()
      }
    })
  }

  return (
    <section className="space-y-6" data-testid="workspace-secrets-page">
      <header className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-5">
          <div className="min-w-0 space-y-2">
            <WorkspaceSecretsBreadcrumb workspaceId={workspaceId} workspaceLabel={activeWorkspace?.label} />
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
              className={`${getConsoleContextStatusBadgeClasses(isProduction ? 'restricted' : 'neutral')} shrink-0`}
            >
              {isProduction ? 'Producción' : `Entorno: ${environment}`}
            </Badge>
          ) : null}
        </div>
      </header>

      <section className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold text-foreground">Crear secreto</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          El valor se envía cifrado al servicio y se elimina del formulario tras crearlo. No hay forma de
          volver a leerlo desde la consola.
        </p>
        <form className="mt-5 space-y-5" onSubmit={(event) => void handleCreate(event)} noValidate>
          <div className="grid gap-x-4 gap-y-5 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={createNameId}>Nombre del secreto</Label>
              <Input
                id={createNameId}
                aria-describedby={createNameDescribedBy}
                aria-invalid={createValidation.name ? true : undefined}
                value={createName}
                onChange={(event) => {
                  setCreateName(event.target.value)
                  setCreateValidation((current) => current.name ? { ...current, name: null } : current)
                }}
                placeholder="db_password"
                autoComplete="off"
                spellCheck={false}
              />
              <span id={createNameHelpId} className="text-xs leading-5 text-muted-foreground">
                {createName ? (
                  <>
                    Variable de entorno:{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">{secretEnvVarName(createName)}</code>
                  </>
                ) : (
                  'Minúsculas, empieza por letra. Se expone como variable de entorno en UPPER_SNAKE.'
                )}
              </span>
              {createValidation.name ? (
                <p id={createNameErrorId} role="alert" className="text-sm font-medium text-destructive">
                  {createValidation.name}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={createValueId}>Valor del secreto</Label>
              <Input
                id={createValueId}
                type="password"
                autoComplete="new-password"
                aria-describedby={createValueDescribedBy}
                aria-invalid={createValidation.value ? true : undefined}
                value={createValue}
                onChange={(event) => {
                  setCreateValue(event.target.value)
                  setCreateValidation((current) => current.value ? { ...current, value: null } : current)
                }}
                placeholder="••••••••"
              />
              <span id={createValueHelpId} className="text-xs leading-5 text-muted-foreground">
                Solo escritura: nunca se vuelve a mostrar tras guardarlo.
              </span>
              {createValidation.value ? (
                <p id={createValueErrorId} role="alert" className="text-sm font-medium text-destructive">
                  {createValidation.value}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label htmlFor={createDescriptionId}>Descripción del secreto (opcional)</Label>
              <Input
                id={createDescriptionId}
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder="Nota no secreta para identificar el secreto"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={createBusy}
              className="w-full sm:w-auto"
            >
              {createBusy ? 'Creando…' : 'Crear secreto'}
            </Button>
          </div>
          {createError ? (
            <Alert variant="destructive" data-testid="workspace-secrets-create-error">
              {createError}
            </Alert>
          ) : null}
        </form>
        {/* Outcomes (create / replace / delete) are announced to assistive tech. */}
        <div aria-live="polite" className="mt-4">
          {feedback?.placement === 'create' ? <Alert variant="success" role="status" aria-live="polite">{feedback.message}</Alert> : null}
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
      {tableLevelFeedback ? (
        <div aria-live="polite">
          <Alert variant="success" role="status" aria-live="polite" data-testid="workspace-secrets-table-feedback">
            {tableLevelFeedback.message}
          </Alert>
        </div>
      ) : null}
      {isEmpty ? (
        <ConsolePageState
          kind="empty"
          title="No hay secretos en esta área de trabajo"
          description={`El área de trabajo "${activeWorkspace?.label ?? workspaceId}"${environment ? ` (${environment})` : ''} todavía no tiene secretos. Crea uno con el formulario de arriba.`}
        />
      ) : null}

      {secrets.length > 0 ? (
        <section className="space-y-3" aria-labelledby="workspace-secrets-metadata-heading">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 id="workspace-secrets-metadata-heading" className="text-lg font-semibold tracking-tight text-foreground">Secretos guardados</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeWorkspace?.label ?? workspaceId}{environment ? ` · ${environment}` : ''}
              </p>
            </div>
            <Badge variant="outline" className="border-border bg-muted/40 text-muted-foreground">
              {secrets.length} {secrets.length === 1 ? 'secreto' : 'secretos'}
            </Badge>
          </div>
          <Table
            containerClassName="bg-card/70 shadow-sm"
            aria-label="Secretos de función del área de trabajo activa"
          >
            <TableCaption>Secretos de función del área de trabajo activa (solo metadatos; los valores no se muestran)</TableCaption>
            <TableHeader>
              <TableRow className="align-top">
                <TableHead>Nombre</TableHead>
                <TableHead>Variable de entorno</TableHead>
                <TableHead>
                  Funciones que lo usan
                  <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
                    Recuento informativo; puede ir por detrás del último despliegue.
                  </span>
                </TableHead>
                <TableHead className="hidden lg:table-cell">Creado</TableHead>
                <TableHead className="hidden xl:table-cell">Actualizado</TableHead>
                <TableHead className="hidden md:table-cell">Descripción</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody data-testid="workspace-secrets-table-body">
              {secrets.map((secret) => {
                const name = readSecretName(secret)
                const rowFeedback = feedback?.placement === 'row' && feedback.targetName === name ? feedback : null
                return (
                  <Fragment key={name}>
                    <TableRow className="hover:bg-muted/30">
                      <TableHead scope="row" className="max-w-[12rem] break-words text-left font-medium text-foreground sm:max-w-none">{name}</TableHead>
                      <TableCell>
                        <code className="inline-block max-w-[12rem] break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground sm:max-w-none">{secretEnvVarName(name)}</code>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{secret.resolvedRefCount}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{formatTimestamp(secret.timestamps?.createdAt)}</TableCell>
                      <TableCell className="hidden text-muted-foreground xl:table-cell">{formatTimestamp(secret.timestamps?.updatedAt)}</TableCell>
                      <TableCell className="hidden max-w-[16rem] break-words text-muted-foreground md:table-cell">{secret.description ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
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
                            onClick={() => openDelete(secret)}
                            aria-label={`Eliminar el secreto ${name}`}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {rowFeedback ? (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Alert variant="success" role="status" aria-live="polite" data-testid="workspace-secrets-row-feedback">
                            {rowFeedback.message}
                          </Alert>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </section>
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
                <Label htmlFor={replaceValueId}>Nuevo valor del secreto</Label>
                <Input
                  id={replaceValueId}
                  type="password"
                  autoComplete="new-password"
                  aria-describedby={replaceValidation ? replaceValidationId : undefined}
                  aria-invalid={replaceValidation ? true : undefined}
                  value={replaceValue}
                  onChange={(event) => {
                    setReplaceValue(event.target.value)
                    setReplaceValidation((current) => current ? null : current)
                  }}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={replaceDescriptionId}>Descripción del secreto (opcional)</Label>
                <Input
                  id={replaceDescriptionId}
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
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={closeReplace} disabled={replaceBusy}>
                Cancelar
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={replaceBusy}>
                {replaceBusy ? 'Reemplazando…' : 'Reemplazar'}
              </Button>
            </div>
          </form>
        ) : null}
      </SecretDialog>

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
