import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import { useDestructiveOp } from '@/components/console/hooks/useDestructiveOp'
import { Button } from '@/components/ui/button'
import { DialogFooter, DialogHeader } from '@/components/ui/dialog'
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
import { useConsoleContext } from '@/lib/console-context'
import { DESTRUCTIVE_OP_LEVELS } from '@/lib/destructive-ops'
import { readConsoleShellSession } from '@/lib/console-session'

const credentialActionsHelpId = 'service-account-credential-actions-help'

function CredentialDisclosureDialog({
  disclosure,
  onClose
}: {
  disclosure: { mode: 'reveal' | 'rotate'; credential: ConsoleIssuedCredential } | null
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const secretId = useId()
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)
  const isOpen = disclosure !== null

  useEffect(() => {
    if (!isOpen) {
      return
    }
    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null
    panelRef.current?.focus()
    return () => {
      restoreFocusRef.current?.focus?.()
    }
  }, [isOpen])

  useEffect(() => {
    setCopyFeedback(null)
  }, [disclosure?.credential.credentialId, disclosure?.credential.secret, disclosure?.mode])

  if (!disclosure) {
    return null
  }

  const activeDisclosure = disclosure
  const isRotate = activeDisclosure.mode === 'rotate'
  const title = isRotate ? 'Nuevo secreto generado' : 'Secreto actual de la service account'
  const description = isRotate
    ? 'Actualiza tus clientes con este valor. Rotar reemplaza el secreto anterior e invalida los tokens emitidos antes de la rotación.'
    : 'Este panel revela el secreto de cliente actual y puede mostrarse de nuevo. Usa Rotar para reemplazarlo e invalidar los tokens emitidos con el secreto anterior.'

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
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
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <DialogHeader>
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </p>
      </DialogHeader>
      <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
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
  )
}

export function ConsoleServiceAccountsPage() {
  const { activeTenant, activeTenantId, activeWorkspace, activeWorkspaceId } = useConsoleContext()
  const { accounts, loading, error, reload } = useConsoleServiceAccounts(activeWorkspaceId)
  const [displayName, setDisplayName] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null)
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
  }, [activeTenantId, activeWorkspaceId, destructiveOp.handleCancel])

  if (!activeTenantId) {
    return <ConsolePageState kind="blocked" title="Service accounts bloqueadas" description="Selecciona un tenant para continuar." />
  }
  if (!activeWorkspaceId) {
    return <ConsolePageState kind="blocked" title="Service accounts bloqueadas" description="Selecciona un workspace para gestionar credenciales." />
  }

  const workspaceId = activeWorkspaceId

  async function handleCreate() {
    const result = await createServiceAccount(workspaceId, { displayName, entityType: 'service_account', desiredState: 'active' })
    setFeedback(`Service account creada: ${result.serviceAccountId}`)
    setDisplayName('')
    reload()
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
      resourceType: 'credencial de service account',
      impactDescription: 'La credencial dejará de funcionar de inmediato.',
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
      resourceType: 'service account',
      impactDescription: 'Se eliminarán el cliente de Keycloak y el registro de la service account de forma permanente.',
      onConfirm: () => handleDelete(account.serviceAccountId),
      onSuccess: () => {
        setFeedback('Service account eliminada.')
        reload()
      }
    })
  }

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <p className="text-sm text-muted-foreground">{header || 'Workspace activo'}</p>
        <h1 className="text-2xl font-semibold tracking-tight">Service Accounts</h1>
        {writesBlocked ? <p className="mt-2 text-sm text-amber-700">El tenant no está activo; las acciones de escritura están deshabilitadas.</p> : null}
      </header>

      <section className="rounded-3xl border border-border bg-card/70 p-6">
        <h2 className="text-lg font-semibold">Crear service account</h2>
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex-1 space-y-2 text-sm text-foreground" htmlFor={displayNameId}>
            <span>Nombre de service account</span>
            <Input id={displayNameId} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <Button type="button" className="md:min-w-24" onClick={() => void handleCreate()} disabled={writesBlocked || !displayName.trim()}>Crear</Button>
        </div>
        {feedback ? <p aria-live="polite" className="mt-3 text-sm text-emerald-700">{feedback}</p> : null}
        {errorFeedback ? <p role="alert" className="mt-3 text-sm text-red-700">{errorFeedback}</p> : null}
      </section>

      {loading ? <ConsolePageState kind="loading" title="Cargando service accounts" description="Consultando el listado del workspace." /> : null}
      {error ? <ConsolePageState kind="error" title="No se pudieron cargar las service accounts" description={error} actionLabel="Reintentar" onAction={reload} /> : null}
      {isEmpty ? <ConsolePageState kind="empty" title="No hay service accounts en este workspace" description="Crea una nueva para empezar." /> : null}

      {accounts.length > 0 ? (
        <div className="overflow-x-auto rounded-3xl border border-border bg-card/70 shadow-sm">
          <table className="w-full min-w-[60rem] divide-y divide-border text-left text-sm">
            <caption className="sr-only">
              Service accounts del workspace activo. Revelar muestra el secreto de cliente actual y puede usarse de nuevo; Rotar genera un secreto nuevo que reemplaza el anterior.
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
                    <td className="px-4 py-4 text-muted-foreground">{account.accessProjection?.clientState ?? account.desiredState ?? 'unknown'}</td>
                    <td className="px-4 py-4"><ConsoleCredentialStatusBadge status={account.credentialStatus?.state} /></td>
                    <td className="px-4 py-4 text-muted-foreground">{account.accessProjection?.effectiveAccess ?? 'unknown'}</td>
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
                          aria-label={`Eliminar service account ${accountName}`}
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
