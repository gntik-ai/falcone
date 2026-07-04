import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleServiceAccountsPage } from './ConsoleServiceAccountsPage'

const mockUseConsoleContext = vi.fn()
const mockUseConsoleServiceAccounts = vi.fn()
const mockCreateServiceAccount = vi.fn()
const mockIssueServiceAccountCredential = vi.fn()
const mockRevokeServiceAccountCredential = vi.fn()
const mockRotateServiceAccountCredential = vi.fn()
const mockDeleteServiceAccount = vi.fn()
const mockReadConsoleShellSession = vi.fn()

vi.mock('@/lib/console-context', () => ({
  formatConsoleEnumLabel: (value: string | null | undefined) => value ? value.replace(/_/g, ' ') : 'No disponible',
  useConsoleContext: () => mockUseConsoleContext()
}))
vi.mock('@/lib/console-service-accounts', () => ({
  useConsoleServiceAccounts: (...args: unknown[]) => mockUseConsoleServiceAccounts(...args),
  createServiceAccount: (...args: unknown[]) => mockCreateServiceAccount(...args),
  issueServiceAccountCredential: (...args: unknown[]) => mockIssueServiceAccountCredential(...args),
  revokeServiceAccountCredential: (...args: unknown[]) => mockRevokeServiceAccountCredential(...args),
  rotateServiceAccountCredential: (...args: unknown[]) => mockRotateServiceAccountCredential(...args),
  deleteServiceAccount: (...args: unknown[]) => mockDeleteServiceAccount(...args),
  // Mirror the real helper closely enough for the page: 403 → fixed copy, otherwise the Error message.
  consoleServiceAccountsErrorMessage: (error: unknown) => {
    const status = typeof error === 'object' && error && 'status' in error ? (error as { status?: number }).status : undefined
    if (status === 403) return 'Acceso denegado para gestionar service accounts.'
    if (error instanceof Error && error.message) return error.message
    return 'No se pudo completar la operación.'
  }
}))
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => mockReadConsoleShellSession() }))

describe('ConsoleServiceAccountsPage', () => {
  beforeEach(() => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { userId: 'usr_1' } })
  })

  afterEach(() => {
    cleanup()
    mockUseConsoleContext.mockReset()
    mockUseConsoleServiceAccounts.mockReset()
    mockCreateServiceAccount.mockReset()
    mockIssueServiceAccountCredential.mockReset()
    mockRevokeServiceAccountCredential.mockReset()
    mockRotateServiceAccountCredential.mockReset()
    mockDeleteServiceAccount.mockReset()
  })

  it('muestra bloqueo sin workspace', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: null })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [], loading: false, error: null, reload: vi.fn(), knownIds: [] })
    render(<ConsoleServiceAccountsPage />)
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona un área de trabajo/i)
  })

  it('muestra empty state del workspace, no del navegador local', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [], loading: false, error: null, reload: vi.fn(), knownIds: [] })
    render(<ConsoleServiceAccountsPage />)
    expect(screen.getByText(/no hay cuentas de servicio en esta área de trabajo/i)).toBeInTheDocument()
    expect(screen.queryByText(/navegador/i)).not.toBeInTheDocument()
  })

  it('crea y revela la credencial actual sin prometer secreto de una sola vez', async () => {
    const user = userEvent.setup()
    const reload = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'active' }, accessProjection: { effectiveAccess: 'rw', clientState: 'active' } }], loading: false, error: null, reload, knownIds: ['sa_1'] })
    mockCreateServiceAccount.mockResolvedValue({ serviceAccountId: 'sa_2' })
    mockIssueServiceAccountCredential.mockResolvedValue({ credentialId: 'cred_1', secret: 'secret-value', expiresAt: null })
    render(<ConsoleServiceAccountsPage />)
    await user.type(screen.getByLabelText(/nombre de cuenta de servicio/i), 'Nueva SA')
    await user.click(screen.getByRole('button', { name: /^crear$/i }))
    await waitFor(() => expect(mockCreateServiceAccount).toHaveBeenCalled())
    const revealButton = screen.getByRole('button', { name: /revelar secreto actual de ops sa/i })
    expect(revealButton).toHaveAttribute('aria-describedby', 'service-account-credential-actions-help')
    await user.click(revealButton)
    const dialog = await screen.findByRole('dialog', { name: /secreto actual de la cuenta de servicio/i })
    expect(dialog).toHaveFocus()
    expect(dialog).toHaveAttribute('aria-describedby')
    expect(dialog).toHaveTextContent(/secreto actual/i)
    expect(dialog).toHaveTextContent(/puede mostrarse de nuevo/i)
    expect(dialog).toHaveTextContent(/usa rotar para reemplazarlo/i)
    expect(dialog).not.toHaveTextContent(/una sola vez/i)
    expect(dialog).not.toHaveTextContent(/no podrá recuperarse/i)
    await user.click(screen.getByRole('button', { name: /copiar secreto/i }))
    expect(writeText).toHaveBeenCalledWith('secret-value')
    expect(screen.getByRole('status')).toHaveTextContent(/copiado/i)
    await user.keyboard('{Escape}')
    expect(screen.queryByText('secret-value')).not.toBeInTheDocument()
    expect(revealButton).toHaveFocus()
  })

  // #783 scenario 1: the one-time-credential disclosure is an accessible, action-anchored MODAL
  // (aria-modal, Tab-trap, focus-return), shows credentialId + expiresAt, and its copy control
  // degrades gracefully when the Clipboard API is unavailable. RED on main: CredentialDisclosureDialog
  // is a bare `role="dialog"` div with no `aria-modal` and no Tab trap (Tab escapes the dialog), and
  // never renders credentialId/expiresAt at all.
  it('[#783] el modal de secreto es accesible (aria-modal + foco atrapado), muestra credentialId/expiresAt y degrada sin portapapeles', async () => {
    const user = userEvent.setup()
    // Simulate a browser/context with no Clipboard API (e.g. insecure context) rather than a
    // rejecting one — navigator.clipboard itself is undefined.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'active' }, accessProjection: { effectiveAccess: 'rw', clientState: 'active' } }], loading: false, error: null, reload: vi.fn(), knownIds: ['sa_1'] })
    mockIssueServiceAccountCredential.mockResolvedValue({ credentialId: 'cred_abc123', secret: 'secret-value', expiresAt: '2027-01-01T00:00:00.000Z' })
    render(<ConsoleServiceAccountsPage />)

    const revealButton = screen.getByRole('button', { name: /revelar secreto actual de ops sa/i })
    await user.click(revealButton)
    const dialog = await screen.findByRole('dialog', { name: /secreto actual de la cuenta de servicio/i })

    // (a) True modal semantics + credentialId/expiresAt are displayed.
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('cred_abc123')
    expect(dialog).toHaveTextContent(/2027/)

    // Tab-trap: from the last focusable element, Tab wraps back to the first instead of escaping
    // the modal.
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    expect(focusable.length).toBeGreaterThan(1)
    focusable[focusable.length - 1].focus()
    await user.tab()
    expect(focusable[0]).toHaveFocus()
    await user.tab({ shift: true })
    expect(focusable[focusable.length - 1]).toHaveFocus()

    // Copy degrades gracefully without the Clipboard API instead of throwing.
    await user.click(screen.getByRole('button', { name: /copiar secreto/i }))
    expect(screen.getByRole('status')).toHaveTextContent(/no se pudo copiar automáticamente/i)

    await user.keyboard('{Escape}')
    expect(revealButton).toHaveFocus()
  })

  it('muestra la rotación como generación de un nuevo secreto', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'active' }, accessProjection: { effectiveAccess: 'rw', clientState: 'active' } }], loading: false, error: null, reload: vi.fn(), knownIds: ['sa_1'] })
    mockRotateServiceAccountCredential.mockResolvedValue({ credentialId: 'cred_2', secret: 'rotated-secret', expiresAt: null })
    render(<ConsoleServiceAccountsPage />)

    const rotateButton = screen.getByRole('button', { name: /rotar secreto de ops sa/i })
    expect(rotateButton).toHaveAttribute('aria-describedby', 'service-account-credential-actions-help')
    await user.click(rotateButton)
    const dialog = await screen.findByRole('dialog', { name: /nuevo secreto generado/i })

    expect(dialog).toHaveTextContent(/nuevo secreto generado/i)
    expect(dialog).toHaveTextContent(/rotar reemplaza el secreto anterior/i)
    expect(dialog).toHaveTextContent(/rotated-secret/i)
    expect(dialog).not.toHaveTextContent(/una sola vez/i)
    expect(dialog).not.toHaveTextContent(/no podrá recuperarse/i)
  })

  it('abre confirmación WARNING al revocar una credencial', async () => {
    const user = userEvent.setup()
    const reload = vi.fn()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'active' }, accessProjection: { effectiveAccess: 'rw', clientState: 'active' } }], loading: false, error: null, reload, knownIds: ['sa_1'] })
    mockRevokeServiceAccountCredential.mockResolvedValue(undefined)
    render(<ConsoleServiceAccountsPage />)

    await user.click(screen.getByRole('button', { name: /revocar/i }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/ops sa/i)
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/la credencial dejará de funcionar de inmediato/i)
    // [#783] Revoking is a terminal action for the credential: the copy must say it cannot be
    // re-issued or rotated afterward, and that using the service account again requires deleting
    // and recreating it.
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/no (podrás|se podrá) (volver a )?(emitir|revelar)/i)
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/ni rotarla/i)
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/eliminar.*crear/i)

    await user.click(screen.getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() => {
      expect(mockRevokeServiceAccountCredential).toHaveBeenCalledWith('wrk_1', 'sa_1', { reason: 'Console revoke' })
      expect(reload).toHaveBeenCalled()
    })
  })

  it('abre confirmación CRITICAL al eliminar una service account y llama al SDK (#687)', async () => {
    const user = userEvent.setup()
    const reload = vi.fn()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'active' }, accessProjection: { effectiveAccess: 'rw', clientState: 'active' } }], loading: false, error: null, reload, knownIds: ['sa_1'] })
    mockDeleteServiceAccount.mockResolvedValue(undefined)
    render(<ConsoleServiceAccountsPage />)

    // The row's destructive "Eliminar" button opens the CRITICAL confirmation dialog.
    await user.click(screen.getByRole('button', { name: /eliminar/i }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(/eliminar cuenta de servicio/i)
    expect(dialog).toHaveTextContent(/ops sa/i)
    expect(dialog).toHaveTextContent(/esta operación es irreversible/i)

    // CRITICAL ops require typing the exact resource name before the dialog's confirm enables.
    // The dialog's confirmation input carries the resource name as its placeholder.
    await user.type(screen.getByPlaceholderText('Ops SA'), 'Ops SA')
    // The footer confirm button (also labelled "Eliminar") is the last match.
    const confirmButtons = screen.getAllByRole('button', { name: /eliminar/i })
    await user.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => {
      expect(mockDeleteServiceAccount).toHaveBeenCalledWith('wrk_1', 'sa_1')
      expect(reload).toHaveBeenCalled()
    })
  })

  it('permite eliminar incluso una service account con credencial revocada (#687)', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'revoked' }, accessProjection: { effectiveAccess: 'denied', clientState: 'disabled', credentialState: 'revoked' } }], loading: false, error: null, reload: vi.fn(), knownIds: ['sa_1'] })
    render(<ConsoleServiceAccountsPage />)
    // Unlike reveal/rotate, delete is NOT gated by credentialRevoked — a revoked SA is exactly what
    // a caller wants to delete so it stops accumulating.
    expect(screen.getByRole('button', { name: /eliminar/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /revelar/i })).toBeDisabled()
  })

  it('deshabilita acciones con tenant inactivo', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'suspended' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'active' }, accessProjection: { effectiveAccess: 'rw', clientState: 'active' } }], loading: false, error: null, reload: vi.fn(), knownIds: ['sa_1'] })
    render(<ConsoleServiceAccountsPage />)
    expect(screen.getByRole('button', { name: /revelar/i })).toBeDisabled()
  })

  it('deshabilita revelar y rotar para una credencial revocada', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'revoked' }, accessProjection: { effectiveAccess: 'denied', clientState: 'disabled', credentialState: 'revoked' } }], loading: false, error: null, reload: vi.fn(), knownIds: ['sa_1'] })
    render(<ConsoleServiceAccountsPage />)
    // Revealing or rotating a revoked credential is rejected by the control plane (409 CREDENTIAL_REVOKED);
    // the UI must not offer those actions. Revocar stays enabled (idempotent).
    expect(screen.getByRole('button', { name: /revelar/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /rotar/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /revocar/i })).toBeEnabled()
  })

  it('muestra feedback de error cuando revelar es rechazado (credencial revocada)', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    // Credential not yet reflected as revoked in this browser's index, so the button is enabled and the
    // click reaches the control plane, which rejects it. The page must surface the failure, not crash or
    // swallow it.
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'active' }, accessProjection: { effectiveAccess: 'rw', clientState: 'active' } }], loading: false, error: null, reload: vi.fn(), knownIds: ['sa_1'] })
    mockIssueServiceAccountCredential.mockRejectedValue(Object.assign(new Error('service account credential is revoked'), { status: 409 }))
    render(<ConsoleServiceAccountsPage />)

    await user.click(screen.getByRole('button', { name: /revelar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/revoked/i)
    // No success dialog opened.
    expect(screen.queryByRole('dialog', { name: /secreto actual de la cuenta de servicio/i })).not.toBeInTheDocument()
  })

  // #783: handleCreate did not have a busy/pending state or a try/catch, unlike its siblings
  // handleIssue/handleRotate. RED on main: the submit button stays enabled mid-flight and a
  // rejected create crashes (unhandled rejection) instead of surfacing an error.
  it('[#783] handleCreate deshabilita el envío mientras está en curso (paridad con handleIssue/handleRotate)', async () => {
    const user = userEvent.setup()
    let resolveCreate: ((value: { serviceAccountId: string }) => void) | null = null
    mockCreateServiceAccount.mockImplementation(
      () => new Promise<{ serviceAccountId: string }>((resolve) => { resolveCreate = resolve })
    )
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [], loading: false, error: null, reload: vi.fn(), knownIds: [] })
    render(<ConsoleServiceAccountsPage />)

    await user.type(screen.getByLabelText(/nombre de cuenta de servicio/i), 'Nueva SA')
    const createButton = screen.getByRole('button', { name: /crear/i })
    await user.click(createButton)

    // Busy: disabled and the label reflects the in-flight state (parity with handleIssue/handleRotate).
    expect(createButton).toBeDisabled()
    expect(createButton).toHaveTextContent(/creando/i)

    resolveCreate!({ serviceAccountId: 'sa_9' })
    // Not busy anymore — the label reverts (the field itself is cleared on success, which is a
    // separate, pre-existing write-only-form behavior, not what this test is about).
    await waitFor(() => expect(createButton).toHaveTextContent(/^crear$/i))
  })

  it('[#783] handleCreate surge el error sin romper la página cuando la creación falla', async () => {
    const user = userEvent.setup()
    mockCreateServiceAccount.mockRejectedValue(new Error('create explotó'))
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [], loading: false, error: null, reload: vi.fn(), knownIds: [] })
    render(<ConsoleServiceAccountsPage />)

    await user.type(screen.getByLabelText(/nombre de cuenta de servicio/i), 'Nueva SA')
    const createButton = screen.getByRole('button', { name: /crear/i })
    await user.click(createButton)

    expect(await screen.findByRole('alert')).toHaveTextContent(/create explotó/i)
    expect(createButton).toBeEnabled()
  })

  it('[#803] renderiza los encabezados de cuentas de servicio en español', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { state: 'active', label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleServiceAccounts.mockReturnValue({ accounts: [{ serviceAccountId: 'sa_1', displayName: 'Ops SA', desiredState: 'active', expiresAt: null, credentialStatus: { state: 'active' }, accessProjection: { effectiveAccess: 'rw', clientState: 'active' } }], loading: false, error: null, reload: vi.fn(), knownIds: ['sa_1'] })

    render(<ConsoleServiceAccountsPage />)

    expect(screen.getByRole('heading', { name: 'Cuentas de servicio' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Crear cuenta de servicio' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Service Accounts' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Service accounts del workspace activo/i)).not.toBeInTheDocument()
  })
})
