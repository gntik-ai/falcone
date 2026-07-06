import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleWorkspaceDatabasePage } from './ConsoleWorkspaceDatabasePage'

const mockUseConsoleContext = vi.fn()
const mockReadConsoleShellSession = vi.fn()
const mockRequestConsoleSessionJson = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))
vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: () => mockReadConsoleShellSession(),
  requestConsoleSessionJson: (...args: unknown[]) => mockRequestConsoleSessionJson(...args)
}))

function renderPage() {
  return render(<ConsoleWorkspaceDatabasePage />, { wrapper: MemoryRouter })
}

describe('ConsoleWorkspaceDatabasePage', () => {
  beforeEach(() => {
    mockUseConsoleContext.mockReset()
    mockReadConsoleShellSession.mockReset()
    mockReadConsoleShellSession.mockReturnValue({ principal: { userId: 'usr_1', platformRoles: ['tenant_owner'] } })
    mockRequestConsoleSessionJson.mockReset()
    mockRequestConsoleSessionJson.mockResolvedValue({ notProvisioned: true })
  })

  afterEach(() => {
    cleanup()
  })

  // #742: the no-workspace guard is the shared WorkspaceRequiredState, not a static message.
  it('[#742] offers a create-workspace CTA when no workspace is active', () => {
    mockUseConsoleContext.mockReturnValue({ activeWorkspace: null, activeWorkspaceId: null })
    renderPage()

    expect(mockRequestConsoleSessionJson).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(/selecciona un área de trabajo/i)
    expect(screen.getByRole('link', { name: /crear área de trabajo/i })).toHaveAttribute('href', '/console/workspaces')
  })

  it('[#742] offers an inline picker that activates the chosen workspace when workspaces already exist', async () => {
    const user = userEvent.setup()
    const selectWorkspace = vi.fn()
    mockUseConsoleContext.mockReturnValue({
      activeWorkspace: null,
      activeWorkspaceId: null,
      workspaces: [
        { workspaceId: 'wrk_1', tenantId: 'ten_1', label: 'Producción', secondary: 'prod' },
        { workspaceId: 'wrk_2', tenantId: 'ten_1', label: 'Staging', secondary: 'staging' }
      ],
      selectWorkspace
    })
    renderPage()

    await user.selectOptions(screen.getByRole('combobox', { name: /seleccionar área de trabajo/i }), 'wrk_2')
    expect(selectWorkspace).toHaveBeenCalledWith('wrk_2')
  })
})
