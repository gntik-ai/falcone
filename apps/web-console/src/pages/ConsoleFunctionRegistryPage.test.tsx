import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleFunctionRegistryPage } from './ConsoleFunctionRegistryPage'

const mockUseConsoleContext = vi.fn<() => { activeWorkspace: { workspaceId: string; label: string } | null; activeWorkspaceId: string | null }>(() => ({
  activeWorkspace: null,
  activeWorkspaceId: null
}))
const mockReadConsoleShellSession = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))
vi.mock('@/lib/console-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/console-session')>()
  return {
    ...actual,
    readConsoleShellSession: () => mockReadConsoleShellSession()
  }
})

function renderPage() {
  return render(<ConsoleFunctionRegistryPage />, { wrapper: MemoryRouter })
}

describe('ConsoleFunctionRegistryPage', () => {
  beforeEach(() => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { userId: 'usr_1', platformRoles: ['tenant_owner'] } })
  })

  afterEach(() => {
    cleanup()
    mockUseConsoleContext.mockReturnValue({ activeWorkspace: null, activeWorkspaceId: null })
  })

  it('[#797] usa el mismo título que la etiqueta de navegación', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Funciones: registro' })).toBeInTheDocument()
  })

  // #742: the no-workspace guard is the shared WorkspaceRequiredState, not a static message.
  it('[#742] offers a create-workspace CTA when no workspace is active', () => {
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent(/selecciona un área de trabajo/i)
    expect(screen.getByRole('link', { name: /crear área de trabajo/i })).toHaveAttribute('href', '/console/workspaces')
  })

  // #757: the "Registrar función" fields were raw h-10 inputs bypassing the shared h-11 Input
  // primitive — converge them onto the design system like every other data-plane form.
  it('renders the registration fields via the shared Input primitive (#757)', () => {
    mockUseConsoleContext.mockReturnValue({
      activeWorkspace: { workspaceId: 'wrk_alpha', label: 'Workspace Alpha' },
      activeWorkspaceId: 'wrk_alpha'
    })

    const { container } = render(<ConsoleFunctionRegistryPage />)

    const fields = container.querySelectorAll('input, select')
    expect(fields.length).toBeGreaterThan(0)
    for (const field of Array.from(fields)) {
      expect(field.className).toMatch(/rounded-xl border border-input/)
    }
  })
})
