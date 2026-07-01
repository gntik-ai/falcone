import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LoginPage } from './LoginPage'
import { PasswordRecoveryPage } from './PasswordRecoveryPage'

const fetchMock = vi.fn<typeof fetch>()

describe('LoginPage', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
  })

  it('renderiza el formulario y las acciones secundarias', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, allowedSignupPolicy()))
    vi.stubGlobal('fetch', fetchMock)

    renderLoginPage()

    expect(await screen.findByRole('heading', { name: /accede a in falcone console/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/usuario/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /mantener la sesión abierta/i })).toBeInTheDocument()
    const recoveryLink = screen.getByRole('link', { name: /¿olvidaste tu contraseña\?/i })
    expect(recoveryLink).toHaveAttribute('href', '/password-recovery')
    expect(recoveryLink).not.toHaveAttribute('type')
  })

  it('[#726] navega desde el enlace de contraseña olvidada hasta una vista real de recuperación', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, allowedSignupPolicy()))
    vi.stubGlobal('fetch', fetchMock)

    renderLoginPage()

    fireEvent.click(await screen.findByRole('link', { name: /¿olvidaste tu contraseña\?/i }))

    expect(
      await screen.findByRole('heading', { name: /recupera el acceso a in falcone console/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar instrucciones/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver a login/i })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('heading', { name: /página no encontrada/i })).not.toBeInTheDocument()
  })

  it('muestra el CTA de signup cuando la policy lo permite', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, allowedSignupPolicy()))
    vi.stubGlobal('fetch', fetchMock)

    renderLoginPage('/login?tenant=ten_acme&workspaceId=wrk_console')

    expect(await screen.findByRole('link', { name: /solicita acceso o crea tu cuenta/i })).toHaveAttribute(
      'href',
      '/signup?tenantId=ten_acme&workspaceId=wrk_console'
    )
  })

  it('oculta el CTA de signup cuando la policy lo deshabilita', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(200, {
        selfServiceEnabled: false,
        mode: 'invitation',
        statusView: 'login',
        passwordPolicy: { minLength: 8 },
        message: 'El auto-registro está deshabilitado por política.'
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    renderLoginPage()

    expect(await screen.findByText(/el auto-registro está deshabilitado por política/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /solicita acceso o crea tu cuenta/i })).not.toBeInTheDocument()
  })

  it('envía el login y redirige al destino protegido recordado', async () => {
    window.sessionStorage.setItem('in-falcone.console-protected-route', JSON.stringify('/console/workspaces?tab=active'))

    fetchMock
      .mockResolvedValueOnce(createJsonResponse(200, allowedSignupPolicy()))
      .mockResolvedValueOnce(createJsonResponse(200, activeConsoleSession()))
    vi.stubGlobal('fetch', fetchMock)

    renderLoginPage()
    await screen.findByRole('link', { name: /solicita acceso o crea tu cuenta/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'super-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar a la consola/i }))

    expect(await screen.findByText('Workspace target')).toBeInTheDocument()
    expect(JSON.parse(window.sessionStorage.getItem('in-falcone.console-shell-session') ?? '{}')).toMatchObject({
      sessionId: 'ses_abc123'
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/v1/auth/login-sessions',
        expect.objectContaining({
          method: 'POST'
        })
      )
    })
  })

  it('muestra el hint auth consumido desde storage', async () => {
    window.sessionStorage.setItem(
      'in-falcone.console-auth-status-hint',
      JSON.stringify({
        statusView: 'login',
        title: 'Tu sesión ha expirado',
        message: 'Vuelve a autenticarte para continuar en la consola.'
      })
    )
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, allowedSignupPolicy()))
    vi.stubGlobal('fetch', fetchMock)

    renderLoginPage()

    expect(await screen.findByText(/tu sesión ha expirado/i)).toBeInTheDocument()
    expect(screen.getByText(/vuelve a autenticarte para continuar en la consola/i)).toBeInTheDocument()
  })

  it('evita permanecer en login cuando ya existe una sesión válida', async () => {
    window.sessionStorage.setItem('in-falcone.console-shell-session', JSON.stringify(activeConsoleSession()))
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, allowedSignupPolicy()))
    vi.stubGlobal('fetch', fetchMock)

    renderLoginPage()

    expect(await screen.findByText('Overview target')).toBeInTheDocument()
  })

  it('no impone un minLength de cliente mayor que el mínimo de la policy (#804)', async () => {
    // The platform password policy minimum is 8 (`/v1/auth/signups/policy` →
    // `passwordPolicy.minLength`). The login form must not carry a client-side
    // `minLength` larger than that, or policy-valid 8–11-char accounts cannot submit.
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, allowedSignupPolicy()))
    vi.stubGlobal('fetch', fetchMock)

    renderLoginPage()

    const password = (await screen.findByLabelText(/contraseña/i)) as HTMLInputElement
    const policyMinLength = 8
    const min = password.hasAttribute('minlength') ? Number(password.getAttribute('minlength')) : 0

    expect(min).toBeLessThanOrEqual(policyMinLength)
  })

  it('envía el login con una contraseña de 8 caracteres válida según la policy (#804)', async () => {
    // Scenario 1: WHEN the policy minLength is 8 and a user submits an 8-character
    // password on /login THEN the form submits and POST /v1/auth/login-sessions is sent,
    // not blocked by client-side minLength.
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(200, allowedSignupPolicy()))
      .mockResolvedValueOnce(createJsonResponse(200, activeConsoleSession()))
    vi.stubGlobal('fetch', fetchMock)

    renderLoginPage()
    await screen.findByRole('link', { name: /solicita acceso o crea tu cuenta/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'Abcd1234' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar a la consola/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/v1/auth/login-sessions',
        expect.objectContaining({
          method: 'POST'
        })
      )
    })
  })
})

function renderLoginPage(initialEntry = '/login') {
  const router = createMemoryRouter(
    [
      {
        path: '/login',
        element: <LoginPage />
      },
      {
        path: '/password-recovery',
        element: <PasswordRecoveryPage />
      },
      {
        path: '/console/overview',
        element: <div>Overview target</div>
      },
      {
        path: '/console/workspaces',
        element: <div>Workspace target</div>
      }
    ],
    {
      initialEntries: [initialEntry]
    }
  )

  render(<RouterProvider router={router} />)
}

function allowedSignupPolicy() {
  return {
    selfServiceEnabled: true,
    mode: 'self_service',
    statusView: 'signup',
    passwordPolicy: { minLength: 8 },
    message: 'Self-service signup is enabled.'
  }
}

function activeConsoleSession() {
  return {
    sessionId: 'ses_abc123',
    authenticationState: 'active',
    statusView: 'login',
    issuedAt: '2026-03-28T18:00:00.000Z',
    lastActivityAt: '2026-03-28T18:00:00.000Z',
    expiresAt: '2099-03-28T20:00:00.000Z',
    idleExpiresAt: '2099-03-28T19:00:00.000Z',
    refreshExpiresAt: '2099-03-29T18:00:00.000Z',
    sessionPolicy: {
      maxLifetime: '8h',
      idleTimeout: '1h',
      refreshTokenMaxAge: '24h'
    },
    tokenSet: {
      accessToken: 'access-token-1234567890',
      refreshToken: 'refresh-token-1234567890',
      tokenType: 'Bearer',
      expiresIn: 3600,
      refreshExpiresIn: 7200,
      scope: 'openid profile email',
      expiresAt: '2099-03-28T20:00:00.000Z',
      refreshExpiresAt: '2099-03-29T18:00:00.000Z'
    },
    principal: {
      userId: 'usr_abc123',
      username: 'operaciones',
      displayName: 'Operaciones',
      primaryEmail: 'ops@example.com',
      state: 'active',
      platformRoles: ['platform_operator']
    }
  }
}

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}
