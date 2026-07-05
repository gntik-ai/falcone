import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const useConsoleContextMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/console-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/console-context')>('@/lib/console-context')

  return {
    ...actual,
    useConsoleContext: useConsoleContextMock
  }
})

import { ConsoleSettingsPage } from './ConsoleSettingsPage'

const NO_SCAFFOLDING_PATTERNS = [/EP-\d+/, /US-UI/i, /consola base/i, /pantalla temporal/i, /entrada base/i, /iteración posterior/i]

describe('ConsoleSettingsPage', () => {
  afterEach(() => {
    cleanup()
    useConsoleContextMock.mockReset()
  })

  it('[#744][Scenario: Tenant owner views any authenticated page] muestra un estado vacío honesto, sin jerga de desarrollo ni IDs de seguimiento', () => {
    useConsoleContextMock.mockReturnValue({ activeTenant: { label: 'Tenant Alpha' } })

    render(<ConsoleSettingsPage />)

    expect(screen.getByRole('heading', { name: /ajustes de consola/i })).toBeInTheDocument()
    expect(screen.getByText(/sin preferencias configurables/i)).toBeInTheDocument()

    const pageText = document.body.textContent ?? ''
    expect(pageText).toContain('Tenant Alpha')
    for (const pattern of NO_SCAFFOLDING_PATTERNS) {
      expect(pageText).not.toMatch(pattern)
    }
  })
})
