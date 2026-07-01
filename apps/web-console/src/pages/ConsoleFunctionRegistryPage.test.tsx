import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleFunctionRegistryPage } from './ConsoleFunctionRegistryPage'

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => ({
    activeWorkspace: null,
    activeWorkspaceId: null
  })
}))

describe('ConsoleFunctionRegistryPage', () => {
  afterEach(() => {
    cleanup()
  })

  it('[#797] usa el mismo título que la etiqueta de navegación', () => {
    render(<ConsoleFunctionRegistryPage />)

    expect(screen.getByRole('heading', { name: 'Funciones: registro' })).toBeInTheDocument()
  })
})
