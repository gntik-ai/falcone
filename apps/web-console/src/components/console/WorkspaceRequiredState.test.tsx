import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceRequiredState } from './WorkspaceRequiredState'

const mockSelectWorkspace = vi.fn()
const mockReloadWorkspaces = vi.fn()
const mockUseConsoleContext = vi.fn()
const mockReadConsoleShellSession = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))
vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: () => mockReadConsoleShellSession()
}))

function renderState(description = 'Selecciona un área de trabajo para ver los recursos.') {
  return render(
    <MemoryRouter>
      <WorkspaceRequiredState description={description} />
    </MemoryRouter>
  )
}

describe('WorkspaceRequiredState', () => {
  afterEach(() => {
    cleanup()
    mockSelectWorkspace.mockReset()
    mockReloadWorkspaces.mockReset()
    mockUseConsoleContext.mockReset()
    mockReadConsoleShellSession.mockReset()
  })

  it('[#742] renders an honest loading state while workspaces are being fetched (no false action)', () => {
    mockUseConsoleContext.mockReturnValue({
      workspaces: [],
      workspacesLoading: true,
      workspacesError: null,
      selectWorkspace: mockSelectWorkspace,
      reloadWorkspaces: mockReloadWorkspaces
    })
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_owner'] } })

    renderState()

    expect(screen.getByRole('status')).toHaveTextContent('Cargando áreas de trabajo')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('[#742] keeps the existing retry affordance when the workspaces list failed to load', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({
      workspaces: [],
      workspacesLoading: false,
      workspacesError: 'La organización no respondió.',
      selectWorkspace: mockSelectWorkspace,
      reloadWorkspaces: mockReloadWorkspaces
    })
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_owner'] } })

    renderState()

    expect(screen.getByRole('alert')).toHaveTextContent('La organización no respondió.')
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(mockReloadWorkspaces).toHaveBeenCalledTimes(1)
  })

  it('[#742] scenario: zero workspaces + create-capable role renders a create-workspace CTA linking to the real creation flow', () => {
    mockUseConsoleContext.mockReturnValue({
      workspaces: [],
      workspacesLoading: false,
      workspacesError: null,
      selectWorkspace: mockSelectWorkspace,
      reloadWorkspaces: mockReloadWorkspaces
    })
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_owner'] } })

    renderState('Selecciona un área de trabajo para ver los recursos de almacenamiento.')

    expect(screen.getByRole('status')).toHaveTextContent('Selecciona un área de trabajo')
    const link = screen.getByRole('link', { name: /crear área de trabajo/i })
    expect(link).toHaveAttribute('href', '/console/workspaces')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('[#742] scenario: zero workspaces + read-only role degrades honestly instead of a dead-end CTA', () => {
    mockUseConsoleContext.mockReturnValue({
      workspaces: [],
      workspacesLoading: false,
      workspacesError: null,
      selectWorkspace: mockSelectWorkspace,
      reloadWorkspaces: mockReloadWorkspaces
    })
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_viewer'] } })

    renderState()

    expect(screen.queryByRole('link', { name: /crear área de trabajo/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-required-create-denied')).toHaveTextContent(/pide a un propietario o administrador/i)
  })

  it('[#742] scenario: existing workspaces render an inline picker and selecting one activates it', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({
      workspaces: [
        { workspaceId: 'wrk_1', tenantId: 'ten_1', label: 'Producción', secondary: 'prod', environment: 'production', state: 'active', provisioningStatus: 'provisioned' },
        { workspaceId: 'wrk_2', tenantId: 'ten_1', label: 'Staging', secondary: 'staging', environment: 'staging', state: 'active', provisioningStatus: 'provisioned' }
      ],
      workspacesLoading: false,
      workspacesError: null,
      selectWorkspace: mockSelectWorkspace,
      reloadWorkspaces: mockReloadWorkspaces
    })
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_owner'] } })

    renderState()

    const picker = screen.getByRole('combobox', { name: /seleccionar área de trabajo/i })
    // #742 a11y (WCAG 2.5.3 Label in Name): the picker's accessible name equals its VISIBLE label,
    // so it can't regress to an aria-label that diverges from what sighted users read.
    expect(picker).toHaveAccessibleName('Seleccionar área de trabajo')
    expect(screen.getByText('Seleccionar área de trabajo')).toBeInTheDocument()
    await user.selectOptions(picker, 'wrk_2')

    expect(mockSelectWorkspace).toHaveBeenCalledWith('wrk_2')
  })
})
