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

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => mockUseConsoleContext() }))
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
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona un workspace/i)
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
    await user.type(screen.getByLabelText(/nombre de service account/i), 'Nueva SA')
    await user.click(screen.getByRole('button', { name: /^crear$/i }))
    await waitFor(() => expect(mockCreateServiceAccount).toHaveBeenCalled())
    const revealButton = screen.getByRole('button', { name: /revelar secreto actual de ops sa/i })
    expect(revealButton).toHaveAttribute('aria-describedby', 'service-account-credential-actions-help')
    await user.click(revealButton)
    const dialog = await screen.findByRole('dialog', { name: /secreto actual de la service account/i })
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
    expect(dialog).toHaveTextContent(/eliminar service account/i)
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
    expect(screen.queryByRole('dialog', { name: /credencial revelada/i })).not.toBeInTheDocument()
  })
})
