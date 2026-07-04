import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleFunctionRegistryPage } from './ConsoleFunctionRegistryPage'

const mockUseConsoleContext = vi.fn<() => { activeWorkspace: { workspaceId: string; label: string } | null; activeWorkspaceId: string | null }>(() => ({
  activeWorkspace: null,
  activeWorkspaceId: null
}))

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

describe('ConsoleFunctionRegistryPage', () => {
  afterEach(() => {
    cleanup()
    mockUseConsoleContext.mockReturnValue({ activeWorkspace: null, activeWorkspaceId: null })
  })

  it('[#797] usa el mismo título que la etiqueta de navegación', () => {
    render(<ConsoleFunctionRegistryPage />)

    expect(screen.getByRole('heading', { name: 'Funciones: registro' })).toBeInTheDocument()
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
