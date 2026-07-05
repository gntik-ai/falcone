import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  afterEach(() => {
    vi.clearAllMocks()
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

  it('ofrece "Volver atrás" invocando navigate(-1)', async () => {
    sessionMocks.readConsoleShellSessionMock.mockReturnValue(null)
    sessionMocks.hasUsableConsoleSessionMock.mockReturnValue(false)

    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: /volver atrás/i }))

    expect(navigateMock).toHaveBeenCalledWith(-1)
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
