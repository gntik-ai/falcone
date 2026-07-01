import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleFunctionsDataPage } from './ConsoleFunctionsDataPage'

const mockUseConsoleContext = vi.fn()

function renderPage() {
  return render(
    <MemoryRouter>
      <ConsoleFunctionsDataPage />
    </MemoryRouter>
  )
}

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

vi.mock('@/services/functionsApi', () => ({
  listFunctions: vi.fn().mockResolvedValue({ items: [] }),
  deployFunction: vi.fn(),
  invokeFunction: vi.fn(),
  listActivations: vi.fn()
}))

describe('ConsoleFunctionsDataPage', () => {
  beforeEach(() => {
    mockUseConsoleContext.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('[#797] muestra guards de contexto con ConsolePageState', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: null, activeWorkspaceId: null })

    renderPage()

    expect(screen.getByRole('alert', { name: 'Funciones bloqueadas' })).toHaveTextContent('Selecciona una organización para usar funciones.')

    cleanup()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_alpha', activeWorkspaceId: null })

    renderPage()

    expect(screen.getByRole('alert', { name: 'Funciones bloqueadas' })).toHaveTextContent('Selecciona un área de trabajo para usar funciones.')
  })

  it('[#797] alinea el título con la etiqueta de ruta de despliegue rápido', async () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_alpha', activeWorkspaceId: 'wrk_alpha' })

    renderPage()

    expect(screen.getByRole('heading', { name: 'Funciones: despliegue rápido' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Funciones: administrar' })).toHaveAttribute('href', '/console/functions')
    expect(screen.getByText('Cargando funciones…')).toBeInTheDocument()
    expect(await screen.findByRole('status', { name: 'No hay funciones desplegadas todavía.' })).toBeInTheDocument()
  })
})
