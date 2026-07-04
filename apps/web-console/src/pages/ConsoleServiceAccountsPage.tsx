import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'

import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import { useDestructiveOp } from '@/components/console/hooks/useDestructiveOp'
import { useModalFocusTrap } from '@/components/console/hooks/useModalFocusTrap'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ConsoleCredentialStatusBadge } from '@/components/console/ConsoleCredentialStatusBadge'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import {
  consoleServiceAccountsErrorMessage,
  createServiceAccount,
  deleteServiceAccount,
  issueServiceAccountCredential,
  revokeServiceAccountCredential,
  rotateServiceAccountCredential,
  useConsoleServiceAccounts,
  type ConsoleIssuedCredential,
  type ConsoleServiceAccount
} from '@/lib/console-service-accounts'
import { formatConsoleEnumLabel, useConsoleContext } from '@/lib/console-context'
import { DESTRUCTIVE_OP_LEVELS } from '@/lib/destructive-ops'
import { readConsoleShellSession } from '@/lib/console-session'

const credentialActionsHelpId = 'service-account-credential-actions-help'

function formatAccessProjection(value: string | null | undefined): string {
  const labels: Record<string, string> = {
    rw: 'Lectura y escritura',
    read_write: 'Lectura y escritura',
    read_only: 'Solo lectura',
    denied: 'Denegado',
    none: 'Sin acceso',
    unknown: 'Desconocido'
  }

  if (!value) return 'Desconocido'
  return labels[value] ?? formatConsoleEnumLabel(value)
}

function formatCredentialExpiry(value: string | null | undefined): string {
  if (!value) {
    return 'Sin expiración'
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString()
}

// A true, action-anchored MODAL for the one-time credential disclosure (#783): built on the shared
// Dialog/DialogContent primitive (backdrop + click-outside-to-close) plus the same
// `useModalFocusTrap` hook used by DestructiveConfirmationDialog and
// ConsoleWorkspaceSecretsPage's SecretDialog, so Tab never escapes it and focus returns to the
// triggering row action (Revelar/Rotar) on close. `initialFocus: 'panel'` preserves the existing
// behavior of moving focus onto the dialog container itself (not a specific control inside it).
function CredentialDisclosureDialog({
  disclosure,
  onClose
}: {
  disclosure: { mode: 'reveal' | 'rotate'; credential: ConsoleIssuedCredential } | null
  onClose: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const secretId = useId()
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)
  const isOpen = disclosure !== null
  const { panelRef, handleTabTrap } = useModalFocusTrap<HTMLDivElement>(isOpen, { initialFocus: 'panel' })

  useEffect(() => {
    setCopyFeedback(null)
  }, [disclosure?.credential.credentialId, disclosure?.credential.secret, disclosure?.mode])

  if (!disclosure) {
    return null
  }

  const activeDisclosure = disclosure
  const isRotate = activeDisclosure.mode === 'rotate'
  const title = isRotate ? 'Nuevo secreto generado' : 'Secreto actual de la cuenta de servicio'
  const description = isRotate
    ? 'Actualiza tus clientes con este valor. Rotar reemplaza el secreto anterior e invalida los tokens emitidos antes de la rotación.'
    : 'Este panel revela el secreto de cliente actual y puede mostrarse de nuevo. Usa Rotar para reemplazarlo e invalidar los tokens emitidos con el secreto anterior.'

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    handleTabTrap(event)
  }

  async function handleCopy() {
    if (!navigator.clipboard?.writeText) {
      setCopyFeedback('No se pudo copiar automáticamente. Selecciona el secreto para copiarlo.')
      return
    }

    try {
      await navigator.clipboard.writeText(activeDisclosure.credential.secret)
      setCopyFeedback('Secreto copiado al portapapeles.')
    } catch {
      setCopyFeedback('No se pudo copiar automáticamente. Selecciona el secreto para copiarlo.')
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-lg">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <DialogHeader>
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {description}
            </p>
          </DialogHeader>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">ID de credencial</dt>
              <dd className="mt-1 break-all font-mono text-xs text-foreground">{activeDisclosure.credential.credentialId}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Expira</dt>
              <dd className="mt-1 text-foreground">{formatCredentialExpiry(activeDisclosure.credential.expiresAt)}</dd>
            </div>
          </dl>
          <div className="mt-4 rounded-2xl border border-border/70 bg-background/70 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Secreto de cliente</p>
            <pre
              id={secretId}
              tabIndex={0}
              aria-label="Valor del secreto de cliente"
              className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border/70 bg-muted/30 p-3 font-mono text-xs leading-5 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {activeDisclosure.credential.secret}
            </pre>
          </div>
          <DialogFooter className="mt-4 flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
              {copyFeedback}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="sm:min-w-24"
                aria-label="Copiar secreto al portapapeles"
                onClick={() => void handleCopy()}
              >
                Copiar
              </Button>
              <Button type="button" className="sm:min-w-24" onClick={onClose}>Cerrar</Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ConsoleServiceAccountsPage() {
  const { activeTenant, activeTenantId, activeWorkspace, activeWorkspaceId } = useConsoleContext()
  const { accounts, loading, error, reload } = useConsoleServiceAccounts(activeWorkspaceId)
  const [displayName, setDisplayName] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [credentialDisclosure, setCredentialDisclosure] = useState<{ mode: 'reveal' | 'rotate'; credential: ConsoleIssuedCredential } | null>(null)
  const destructiveOp = useDestructiveOp()
  const displayNameId = useId()
  const session = readConsoleShellSession()
  const principalUserId = session?.principal?.userId ?? 'unknown-user'
  const writesBlocked = activeTenant?.state !== 'active'
  const isEmpty = !loading && !error && accounts.length === 0

  const header = useMemo(() => [activeTenant?.label, activeWorkspace?.label].filter(Boolean).join(' · '), [activeTenant?.label, activeWorkspace?.label])

  useEffect(() => {
    destructiveOp.handleCancel()
    setFeedback(null)
    setErrorFeedback(null)
    setCredentialDisclosure(null)
    setDisplayName('')
    setCreateBusy(false)
  }, [activeTenantId, activeWorkspaceId, destructiveOp.handleCancel])

  if (!activeTenantId) {
    return <ConsolePageState kind="blocked" title="Cuentas de servicio bloqueadas" description="Selecciona una organización para continuar." />
  }
  if (!activeWorkspaceId) {
    return <ConsolePageState kind="blocked" title="Cuentas de servicio bloqueadas" description="Selecciona un área de trabajo para gestionar credenciales." />
  }

  const workspaceId = activeWorkspaceId

  async function handleCreate() {
    // Parity with handleIssue/handleRotate below: clear stale feedback, gate the submit control on
    // a busy state, and surface a rejection instead of letting it become an unhandled rejection
    // (#783).
    setFeedback(null)
    setErrorFeedback(null)
    setCreateBusy(true)
    try {
      const result = await createServiceAccount(workspaceId, { displayName, entityType: 'service_account', desiredState: 'active' })
      setFeedback(`Cuenta de servicio creada: ${result.serviceAccountId}`)
      setDisplayName('')
      reload()
    } catch (rawError) {
      setErrorFeedback(consoleServiceAccountsErrorMessage(rawError))
    } finally {
      setCreateBusy(false)
    }
  }

  async function handleIssue(serviceAccountId: string) {
    setErrorFeedback(null)
    try {
      const credential = await issueServiceAccountCredential(workspaceId, serviceAccountId, { requestedByUserId: principalUserId })
      setCredentialDisclosure({ mode: 'reveal', credential })
      reload()
    } catch (rawError) {
      // The control plane rejects revealing a credential for a revoked service account (409
      // CREDENTIAL_REVOKED). requestConsoleSessionJson throws on any non-2xx, so surface the failure
      // instead of leaving the rejection silent.
      setErrorFeedback(consoleServiceAccountsErrorMessage(rawError))
    }
  }

  async function handleRevoke(serviceAccountId: string) {
    await revokeServiceAccountCredential(workspaceId, serviceAccountId, { reason: 'Console revoke' })
  }

  function openRevokeDialog(account: ConsoleServiceAccount) {
    destructiveOp.openDialog({
      level: DESTRUCTIVE_OP_LEVELS['revoke-service-account-credential'],
      operationId: 'revoke-service-account-credential',
      resourceName: account.displayName ?? account.serviceAccountId,
      resourceType: 'credencial de cuenta de servicio',
      // [#783] Revoking is TERMINAL for this credential — unlike a revoked-but-still-listed
      // service account (which can still be deleted, see #687), there is no path back to a usable
      // credential for it: it can never be re-issued (Revelar) or rotated again. State that
      // explicitly so an operator does not expect a "un-revoke" or re-issue option afterward.
      impactDescription:
        'La credencial dejará de funcionar de inmediato. La revocación es terminal: no podrás volver a emitirla ni rotarla. ' +
        'Para usar esta cuenta de servicio de nuevo, deberás eliminarla y crear una nueva.',
      onConfirm: () => handleRevoke(account.serviceAccountId),
      onSuccess: () => {
        setFeedback('Credencial revocada.')
        reload()
      }
    })
  }

  async function handleRotate(serviceAccountId: string) {
    setErrorFeedback(null)
    try {
      const credential = await rotateServiceAccountCredential(workspaceId, serviceAccountId, { reason: 'Console rotate' })
      setCredentialDisclosure({ mode: 'rotate', credential })
      reload()
    } catch (rawError) {
      // Rotation of a revoked service account is rejected with 409 CREDENTIAL_REVOKED; surface it.
      setErrorFeedback(consoleServiceAccountsErrorMessage(rawError))
    }
  }

  async function handleDelete(serviceAccountId: string) {
    await deleteServiceAccount(workspaceId, serviceAccountId)
  }

  function openDeleteDialog(account: ConsoleServiceAccount) {
    destructiveOp.openDialog({
      level: DESTRUCTIVE_OP_LEVELS['delete-service-account'],
      operationId: 'delete-service-account',
      resourceName: account.displayName ?? account.serviceAccountId,
      resourceType: 'cuenta de servicio',
      impactDescription: 'Se eliminarán el cliente de Keycloak y el registro de la cuenta de servicio de forma permanente.',
      onConfirm: () => handleDelete(account.serviceAccountId),
      onSuccess: () => {
        setFeedback('Cuenta de servicio eliminada.')
        reload()
      }
    })
  }

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <p className="text-sm text-muted-foreground">{header || 'Área de trabajo activa'}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Cuentas de servicio</h1>
        {writesBlocked ? <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">La organización no está activa; las acciones de escritura están deshabilitadas.</p> : null}
      </header>

      <section className="rounded-3xl border border-border bg-card/70 p-6">
        <h2 className="text-lg font-semibold">Crear cuenta de servicio</h2>
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex-1 space-y-2 text-sm text-foreground" htmlFor={displayNameId}>
            <span>Nombre de cuenta de servicio</span>
            <Input id={displayNameId} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <Button type="button" className="md:min-w-24" onClick={() => void handleCreate()} disabled={writesBlocked || !displayName.trim() || createBusy}>
            {createBusy ? 'Creando…' : 'Crear'}
          </Button>
        </div>
        {feedback ? <p aria-live="polite" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{feedback}</p> : null}
        {errorFeedback ? <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{errorFeedback}</p> : null}
      </section>

      {loading ? <ConsolePageState kind="loading" title="Cargando cuentas de servicio" description="Consultando el listado del área de trabajo." /> : null}
      {error ? <ConsolePageState kind="error" title="No se pudieron cargar las cuentas de servicio" description={error} actionLabel="Reintentar" onAction={reload} /> : null}
      {isEmpty ? <ConsolePageState kind="empty" title="No hay cuentas de servicio en esta área de trabajo" description="Crea una nueva para empezar." /> : null}

      {accounts.length > 0 ? (
        <div className="overflow-x-auto rounded-3xl border border-border bg-card/70 shadow-sm">
          <table className="w-full min-w-[60rem] divide-y divide-border text-left text-sm">
            <caption className="sr-only">
              Cuentas de servicio del área de trabajo activa. Revelar muestra el secreto de cliente actual y puede usarse de nuevo; Rotar genera un secreto nuevo que reemplaza el anterior.
            </caption>
            <thead>
              <tr className="bg-muted/40 align-top text-xs uppercase tracking-[0.16em] text-muted-foreground">
                <th scope="col" className="px-4 py-3 font-medium">Nombre</th>
                <th scope="col" className="px-4 py-3 font-medium">Cliente</th>
                <th scope="col" className="px-4 py-3 font-medium">Credencial</th>
                <th scope="col" className="px-4 py-3 font-medium">Acceso</th>
                <th scope="col" className="px-4 py-3 font-medium">Expira</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/80">
              {accounts.map((account) => {
                // A revoked credential cannot be revealed or rotated (the control plane rejects it with
                // 409 CREDENTIAL_REVOKED); reflect that in the UI by disabling those actions. Revocar stays
                // available so re-revoking remains an idempotent no-op.
                const credentialRevoked = account.credentialStatus?.state === 'revoked' || account.accessProjection?.credentialState === 'revoked'
                const accountName = account.displayName ?? account.serviceAccountId
                return (
                  <tr key={account.serviceAccountId} className="transition-colors hover:bg-muted/30">
                    <th scope="row" className="max-w-[18rem] break-words px-4 py-4 text-left font-medium text-foreground">{accountName}</th>
                    <td className="px-4 py-4 text-muted-foreground">{formatConsoleEnumLabel(account.accessProjection?.clientState ?? account.desiredState ?? null)}</td>
                    <td className="px-4 py-4"><ConsoleCredentialStatusBadge status={account.credentialStatus?.state} /></td>
                    <td className="px-4 py-4 text-muted-foreground">{formatAccessProjection(account.accessProjection?.effectiveAccess)}</td>
                    <td className="px-4 py-4 text-muted-foreground">{account.expiresAt ?? '—'}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Revelar secreto actual de ${accountName}`}
                          aria-describedby={credentialActionsHelpId}
                          title={credentialRevoked ? 'La credencial revocada no se puede revelar.' : 'Muestra el secreto de cliente actual; puede mostrarse de nuevo.'}
                          disabled={writesBlocked || credentialRevoked}
                          onClick={() => void handleIssue(account.serviceAccountId)}
                        >
                          Revelar
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Rotar secreto de ${accountName}`}
                          aria-describedby={credentialActionsHelpId}
                          title={credentialRevoked ? 'La credencial revocada no se puede rotar.' : 'Genera un secreto nuevo y reemplaza el anterior.'}
                          disabled={writesBlocked || credentialRevoked}
                          onClick={() => void handleRotate(account.serviceAccountId)}
                        >
                          Rotar
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Revocar credencial de ${accountName}`}
                          disabled={writesBlocked}
                          onClick={() => openRevokeDialog(account)}
                        >
                          Revocar
                        </Button>
                        {/* Delete works for an active OR a revoked SA — gated only by tenant suspension (#687). */}
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          aria-label={`Eliminar cuenta de servicio ${accountName}`}
                          disabled={writesBlocked}
                          onClick={() => openDeleteDialog(account)}
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
          <p id={credentialActionsHelpId} className="sr-only">
            Revelar muestra el secreto de cliente actual y puede repetirse. Rotar genera un secreto nuevo, reemplaza el anterior e invalida tokens emitidos antes de la rotación.
          </p>
        </div>
      ) : null}

      <DestructiveConfirmationDialog
        open={destructiveOp.isOpen}
        config={destructiveOp.config}
        opState={destructiveOp.opState}
        confirmError={destructiveOp.confirmError}
        onConfirm={() => void destructiveOp.handleConfirm()}
        onCancel={destructiveOp.handleCancel}
      />

      <CredentialDisclosureDialog disclosure={credentialDisclosure} onClose={() => setCredentialDisclosure(null)} />
    </section>
  )
}
