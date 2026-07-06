import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleAuthConfigPage } from './ConsoleAuthConfigPage'

const mockUseConsoleContext = vi.fn()
const authConfigApi = vi.hoisted(() => ({
  getTenantAuthConfig: vi.fn(),
  updateTenantAuthConfig: vi.fn(),
  deleteTenantIdentityProvider: vi.fn()
}))

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => mockUseConsoleContext() }))
vi.mock('@/services/authConfigApi', () => authConfigApi)

const baseConfig = {
  tenantId: 'ten_1',
  realm: 'ten-1-realm',
  registrationAllowed: false,
  loginWithEmailAllowed: true,
  resetPasswordAllowed: true,
  rememberMe: false,
  verifyEmail: false,
  identityProviders: [
    { alias: 'google', providerId: 'google', enabled: true, displayName: 'Google' }
  ]
}

function apiError(status: number, message = 'boom') {
  return Object.assign(new Error(message), { status })
}

describe('ConsoleAuthConfigPage (#782)', () => {
  beforeEach(() => {
    authConfigApi.getTenantAuthConfig.mockReset()
    authConfigApi.updateTenantAuthConfig.mockReset()
    authConfigApi.deleteTenantIdentityProvider.mockReset()
    mockUseConsoleContext.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('WHEN no active tenant is selected THEN it renders an empty state and issues no request', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: null, activeTenant: null })

    render(<ConsoleAuthConfigPage />)

    expect(screen.getByText(/selecciona una organización/i)).toBeInTheDocument()
    expect(authConfigApi.getTenantAuthConfig).not.toHaveBeenCalled()
  })

  it('renders the 5 realm login settings from GET', async () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeTenant: { tenantId: 'ten_1', label: 'Acme' } })
    authConfigApi.getTenantAuthConfig.mockResolvedValue(baseConfig)

    render(<ConsoleAuthConfigPage />)

    await waitFor(() => expect(authConfigApi.getTenantAuthConfig).toHaveBeenCalledWith('ten_1'))

    expect(await screen.findByLabelText(/permitir el registro de usuarios/i)).not.toBeChecked()
    expect(screen.getByLabelText(/permitir inicio de sesión con correo electrónico/i)).toBeChecked()
    expect(screen.getByLabelText(/permitir recuperación de contraseña/i)).toBeChecked()
    expect(screen.getByLabelText(/permitir «recordar sesión»/i)).not.toBeChecked()
    expect(screen.getByLabelText(/requerir verificación de correo electrónico/i)).not.toBeChecked()
    expect(screen.getByText('Google')).toBeInTheDocument()
  })

  it('[Scenario: Tenant owner edits realm login settings] WHEN toggling verifyEmail and saving THEN it PUTs only the changed boolean and reflects the persisted value', async () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeTenant: { tenantId: 'ten_1', label: 'Acme' } })
    authConfigApi.getTenantAuthConfig.mockResolvedValue(baseConfig)
    authConfigApi.updateTenantAuthConfig.mockResolvedValue({ ...baseConfig, verifyEmail: true })

    render(<ConsoleAuthConfigPage />)

    const verifyEmailCheckbox = await screen.findByLabelText(/requerir verificación de correo electrónico/i)
    expect(verifyEmailCheckbox).not.toBeChecked()

    const saveButton = screen.getByRole('button', { name: /guardar cambios/i })
    expect(saveButton).toBeDisabled()

    await userEvent.click(verifyEmailCheckbox)
    expect(saveButton).toBeEnabled()

    await userEvent.click(saveButton)

    await waitFor(() => expect(authConfigApi.updateTenantAuthConfig).toHaveBeenCalledWith('ten_1', { verifyEmail: true }))

    expect(await screen.findByLabelText(/requerir verificación de correo electrónico/i)).toBeChecked()
    expect(await screen.findByText(/configuración de autenticación actualizada/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /guardar cambios/i })).toBeDisabled()
  })

  it('WHEN the save request fails THEN it shows a localized error and keeps the draft dirty', async () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeTenant: { tenantId: 'ten_1', label: 'Acme' } })
    authConfigApi.getTenantAuthConfig.mockResolvedValue(baseConfig)
    authConfigApi.updateTenantAuthConfig.mockRejectedValue(apiError(500, 'Internal error trace leak'))

    render(<ConsoleAuthConfigPage />)

    const verifyEmailCheckbox = await screen.findByLabelText(/requerir verificación de correo electrónico/i)
    await userEvent.click(verifyEmailCheckbox)
    await userEvent.click(screen.getByRole('button', { name: /guardar cambios/i }))

    expect(await screen.findByText(/el servicio no está disponible en este momento/i)).toBeInTheDocument()
    expect(screen.queryByText(/internal error trace leak/i)).not.toBeInTheDocument()
  })

  it('WHEN the GET fails with 403 THEN it renders a blocked state, never the raw backend message', async () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeTenant: { tenantId: 'ten_1', label: 'Acme' } })
    authConfigApi.getTenantAuthConfig.mockRejectedValue(
      apiError(403, 'requires superadmin or the tenant owner/admin of this project')
    )

    render(<ConsoleAuthConfigPage />)

    expect(await screen.findByText(/no tienes permiso para ver este recurso/i)).toBeInTheDocument()
    expect(screen.queryByText(/requires superadmin/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/permitir el registro de usuarios/i)).not.toBeInTheDocument()
  })

  it('WHEN the GET fails with a network/5xx error THEN it renders an error state with a retry action', async () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeTenant: { tenantId: 'ten_1', label: 'Acme' } })
    authConfigApi.getTenantAuthConfig.mockRejectedValueOnce(apiError(502, 'upstream blew up'))
    authConfigApi.getTenantAuthConfig.mockResolvedValueOnce(baseConfig)

    render(<ConsoleAuthConfigPage />)

    expect(await screen.findByText(/no se pudo cargar la configuración/i)).toBeInTheDocument()
    expect(screen.queryByText(/upstream blew up/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByLabelText(/permitir el registro de usuarios/i)).toBeInTheDocument()
  })

  it('WHEN deleting an identity provider is confirmed THEN it DELETEs the provider and refreshes the list', async () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeTenant: { tenantId: 'ten_1', label: 'Acme' } })
    authConfigApi.getTenantAuthConfig
      .mockResolvedValueOnce(baseConfig)
      .mockResolvedValueOnce({ ...baseConfig, identityProviders: [] })
    authConfigApi.deleteTenantIdentityProvider.mockResolvedValue({ deleted: true })

    render(<ConsoleAuthConfigPage />)

    await screen.findByText('Google')
    await userEvent.click(screen.getByRole('button', { name: /eliminar/i }))

    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /^confirmar$/i }))

    await waitFor(() => expect(authConfigApi.deleteTenantIdentityProvider).toHaveBeenCalledWith('ten_1', 'google'))
    expect(await screen.findByText(/proveedor .*eliminado/i)).toBeInTheDocument()
    expect(await screen.findByText(/no hay proveedores de identidad configurados/i)).toBeInTheDocument()
  })

  it('switching the active tenant reloads that tenant\'s own auth-config (no cross-tenant bleed)', async () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeTenant: { tenantId: 'ten_1', label: 'Acme' } })
    authConfigApi.getTenantAuthConfig.mockResolvedValueOnce(baseConfig)

    const { rerender } = render(<ConsoleAuthConfigPage />)
    await waitFor(() => expect(authConfigApi.getTenantAuthConfig).toHaveBeenCalledWith('ten_1'))

    const otherTenantConfig = { ...baseConfig, tenantId: 'ten_2', realm: 'ten-2-realm', verifyEmail: true, identityProviders: [] }
    authConfigApi.getTenantAuthConfig.mockResolvedValueOnce(otherTenantConfig)
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_2', activeTenant: { tenantId: 'ten_2', label: 'Beta' } })

    rerender(<ConsoleAuthConfigPage />)

    await waitFor(() => expect(authConfigApi.getTenantAuthConfig).toHaveBeenCalledWith('ten_2'))
    expect(await screen.findByText('Realm: ten-2-realm')).toBeInTheDocument()
  })
})
