import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sessionMocks = vi.hoisted(() => ({
  hasUsableConsoleSessionMock: vi.fn(),
  readConsoleShellSessionMock: vi.fn()
}))

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/console-session', () => ({
  hasUsableConsoleSession: sessionMocks.hasUsableConsoleSessionMock,
  readConsoleShellSession: sessionMocks.readConsoleShellSessionMock
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock
  }
})

import { consoleAuthConfig } from '@/lib/console-config'

import { NotFoundPage } from './NotFoundPage'

// #733: NotFoundPage is a recovery hub, not a dead end — it must offer a primary path forward
// (auth-aware), secondary paths home/back, and render the "404" code as one legible token.
describe('NotFoundPage', () => {
  beforeEach(() => {
    // Deterministic baseline: no in-app back entry (a fresh/direct arrival). Tests that need a
    // navigable history opt in explicitly by stamping react-router's { idx } onto history.state.
    window.history.replaceState(null, '')
  })

  afterEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '')
  })

  it('muestra un estado controlado con enlace de retorno', () => {
    sessionMocks.readConsoleShellSessionMock.mockReturnValue(null)
    sessionMocks.hasUsableConsoleSessionMock.mockReturnValue(false)

    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    )

    expect(screen.getByRole('heading', { level: 1, name: /página no encontrada/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver al inicio$/i })).toHaveAttribute('href', '/')
  })

  it('para un visitante SIN sesión, ofrece "Ir al acceso" como acción primaria hacia el login configurado', () => {
    sessionMocks.readConsoleShellSessionMock.mockReturnValue(null)
    sessionMocks.hasUsableConsoleSessionMock.mockReturnValue(false)

    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    )

    expect(screen.getByRole('link', { name: /ir al acceso/i })).toHaveAttribute('href', consoleAuthConfig.loginPath)
    expect(screen.queryByRole('link', { name: /ir a la consola/i })).not.toBeInTheDocument()
  })

  it('para un visitante CON sesión utilizable, ofrece "Ir a la consola" como acción primaria en lugar de login', () => {
    const session = { sessionId: 'ses_test', authenticationState: 'active' }
    sessionMocks.readConsoleShellSessionMock.mockReturnValue(session)
    sessionMocks.hasUsableConsoleSessionMock.mockReturnValue(true)

    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    )

    expect(sessionMocks.hasUsableConsoleSessionMock).toHaveBeenCalledWith(session)
    expect(screen.getByRole('link', { name: /ir a la consola/i })).toHaveAttribute('href', '/console')
    expect(screen.queryByRole('link', { name: /ir al acceso/i })).not.toBeInTheDocument()
  })

  it('cuando existe una entrada previa en el historial de la app, ofrece "Volver atrás" invocando navigate(-1)', async () => {
    sessionMocks.readConsoleShellSessionMock.mockReturnValue(null)
    sessionMocks.hasUsableConsoleSessionMock.mockReturnValue(false)
    // Simulate a prior in-app navigation: react-router stamps an incrementing idx into history.state.
    window.history.replaceState({ idx: 1 }, '')

    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: /volver atrás/i }))

    expect(navigateMock).toHaveBeenCalledWith(-1)
  })

  it('cuando el 404 es el punto de entrada (sin historial navegable), oculta "Volver atrás" para no expulsar al visitante fuera de la consola', () => {
    sessionMocks.readConsoleShellSessionMock.mockReturnValue(null)
    sessionMocks.hasUsableConsoleSessionMock.mockReturnValue(false)
    // idx 0 = this document's first entry; navigate(-1) would leave the app entirely.
    window.history.replaceState({ idx: 0 }, '')

    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    )

    expect(screen.queryByRole('button', { name: /volver atrás/i })).not.toBeInTheDocument()
    // The forward paths always remain, so the page is never a dead end.
    expect(screen.getByRole('link', { name: /ir al acceso/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver al inicio$/i })).toBeInTheDocument()
  })

  it('al aterrizar, coloca el foco en el encabezado de error (tabIndex -1) para orientar a teclado y lectores de pantalla', () => {
    sessionMocks.readConsoleShellSessionMock.mockReturnValue(null)
    sessionMocks.hasUsableConsoleSessionMock.mockReturnValue(false)

    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    )

    const heading = screen.getByRole('heading', { level: 1, name: /página no encontrada/i })
    expect(heading).toHaveFocus()
    expect(heading).toHaveAttribute('tabindex', '-1')
  })

  it('renderiza el código "404" como un único token legible, sin el tracking amplio que lo partía visualmente en "4 0 4"', () => {
    sessionMocks.readConsoleShellSessionMock.mockReturnValue(null)
    sessionMocks.hasUsableConsoleSessionMock.mockReturnValue(false)

    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    )

    const code = screen.getByText('404')
    expect(code).toBeInTheDocument()
    expect(code.className).not.toMatch(/tracking-/)
  })
})
