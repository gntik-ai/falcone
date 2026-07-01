import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConsoleLoginSession } from '@/lib/console-auth'
import {
  persistConsoleShellSession,
  readConsoleShellSession,
  readProtectedRouteIntent,
  requestConsoleSessionJson
} from '@/lib/console-session'

import { ProtectedRoute } from './ProtectedRoute'

const fetchMock = vi.fn<typeof fetch>()

const activeSession: ConsoleLoginSession = {
  sessionId: 'ses_invalidated123',
  authenticationState: 'active',
  statusView: 'login',
  issuedAt: '2026-07-01T10:00:00.000Z',
  lastActivityAt: '2026-07-01T10:00:00.000Z',
  expiresAt: '2099-07-01T10:30:00.000Z',
  idleExpiresAt: '2099-07-01T10:30:00.000Z',
  refreshExpiresAt: '2099-07-01T18:00:00.000Z',
  sessionPolicy: {
    maxLifetime: '8h',
    idleTimeout: '30m',
    refreshTokenMaxAge: '8h'
  },
  tokenSet: {
    accessToken: 'access-token-invalidated-1234567890',
    refreshToken: 'refresh-token-invalidated-1234567890',
    tokenType: 'Bearer',
    expiresIn: 1800,
    refreshExpiresIn: 28800,
    scope: 'openid profile email',
    expiresAt: '2099-07-01T10:30:00.000Z',
    refreshExpiresAt: '2099-07-01T18:00:00.000Z'
  },
  principal: {
    userId: 'usr_invalidated123',
    username: 'operator',
    displayName: 'Operator',
    primaryEmail: 'operator@example.com',
    state: 'active',
    platformRoles: ['platform_operator']
  }
}

describe('ProtectedRoute session invalidation', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
    window.sessionStorage.clear()
  })

  it('redirects to login when an authenticated request returns 401 and silent refresh also fails', async () => {
    persistConsoleShellSession(activeSession)

    let resolveProtectedRequest!: (value: Response) => void
    const protectedRequest = new Promise<Response>((resolve) => {
      resolveProtectedRequest = resolve
    })

    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
      if (url === '/v1/console/session') {
        return protectedRequest
      }

      if (url === '/v1/auth/login-sessions/ses_invalidated123/refresh') {
        return createJsonResponse(401, {
          status: 401,
          code: 'HTTP_401',
          message: 'Refresh token expired'
        })
      }

      return createJsonResponse(500, {
        status: 500,
        code: 'HTTP_500',
        message: `Unexpected request: ${url}`
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const router = renderProtectedRouter('/console/members?filter=active#top')

    expect(await screen.findByText('Authenticated chrome')).toBeInTheDocument()
    expect(screen.getByText('Member roster')).toBeInTheDocument()

    resolveProtectedRequest(
      createJsonResponse(401, {
        status: 401,
        code: 'HTTP_401',
        message: 'Access token revoked'
      })
    )

    expect(await screen.findByText('Login screen')).toBeInTheDocument()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login')
    })
    expect(readConsoleShellSession()).toBeNull()
    expect(readProtectedRouteIntent()).toBe('/console/members?filter=active#top')
    expect(screen.queryByText('Authenticated chrome')).not.toBeInTheDocument()
    expect(screen.queryByText('Member roster')).not.toBeInTheDocument()
  })
})

function ProtectedMembersPage() {
  useEffect(() => {
    void requestConsoleSessionJson('/v1/console/session').catch(() => {})
  }, [])

  return (
    <>
      <div>Authenticated chrome</div>
      <div>Member roster</div>
    </>
  )
}

function renderProtectedRouter(initialEntry: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/login',
        element: <div>Login screen</div>
      },
      {
        path: '/console',
        element: <ProtectedRoute />,
        children: [
          {
            path: 'members',
            element: <ProtectedMembersPage />
          }
        ]
      }
    ],
    {
      initialEntries: [initialEntry]
    }
  )

  render(<RouterProvider router={router} />)

  return router
}

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}
