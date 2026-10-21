import { useEffect } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { readConsoleAuthStatusHint, readConsoleShellSession, readProtectedRouteIntent, requestConsoleSessionJson, subscribeConsoleSessionInvalidated } from '@in-falcone/console-api/session'
import { Shell } from '../src/shell/Shell'
import { ProtectedRoute } from '../src/shell/session'
import { login, strictFetch, tenantUrl } from './shell-support'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())

test.each(['/', '/next/'])('retry 401 redirects the shell to configured login under %s', async (base) => {
  const session = login()
  const path = `${base}console/overview?tab=activity#recent`
  requests = strictFetch({
    [`GET ${tenantUrl}`]: () => Response.json({ code: 'RETRY_401' }, { status: 401 }),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': session,
  })
  render(<MemoryRouter basename={base} initialEntries={[path]}><Routes>
    <Route path="/console" element={<ProtectedRoute><Shell /></ProtectedRoute>}>
      <Route path="overview" element={<h1>Protected overview</h1>} />
    </Route>
    <Route path={consoleAuthConfig.loginPath} element={<h1>Configured login</h1>} />
  </Routes></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Configured login' })).toBeVisible()
  expect(readConsoleShellSession()).toBeNull()
  expect(readConsoleAuthStatusHint()?.title).toBe('Tu sesión ha expirado')
  expect(readProtectedRouteIntent()).toBe(path)
  expect(screen.queryByText(/401|Comprueba tu conexión|Check your connection|RETRY_401/)).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Protected overview' })).not.toBeInTheDocument()
  expect(requests.mock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)).toEqual([
    `GET ${tenantUrl}`, 'POST /v1/auth/login-sessions/synthetic-session/refresh', `GET ${tenantUrl}`,
  ])
})

test.each(['/', '/next/'].flatMap((base) => ['rejected', 'successful'].map((refresh) => ({ base, refresh }))))(
  '$refresh refresh preserves the existing shell outcome under $base', async ({ base, refresh }) => {
    const session = login()
    const refreshed = { ...session, tokenSet: { ...session.tokenSet!, accessToken: 'synthetic-new-access' } }
    let gets = 0
    requests = strictFetch({
      [`GET ${tenantUrl}`]: () => ++gets === 1 ? Response.json({}, { status: 401 }) : Response.json({ items: [] }),
      'POST /v1/auth/login-sessions/synthetic-session/refresh': () => refresh === 'rejected'
        ? Response.json({ code: 'EXPIRED' }, { status: 401 }) : Response.json(refreshed),
    })
    render(<MemoryRouter basename={base} initialEntries={[`${base}console/overview`]}><Routes>
      <Route path="/console" element={<ProtectedRoute><Shell /></ProtectedRoute>}>
        <Route path="overview" element={<h1>Protected overview</h1>} />
      </Route>
      <Route path={consoleAuthConfig.loginPath} element={<h1>Configured login</h1>} />
    </Routes></MemoryRouter>)
    if (refresh === 'rejected') {
      expect(await screen.findByRole('heading', { name: 'Configured login' })).toBeVisible()
      expect(readConsoleShellSession()).toBeNull()
      expect(readConsoleAuthStatusHint()?.title).toBe('Tu sesión ha expirado')
    } else {
      await waitFor(() => expect(screen.getByRole('region', { name: 'Contexto activo' })).toHaveAttribute('aria-busy', 'false'))
      expect(screen.getByRole('heading', { name: 'Protected overview' })).toBeVisible()
      expect(screen.queryByRole('heading', { name: 'Configured login' })).not.toBeInTheDocument()
      expect(readConsoleShellSession()?.tokenSet?.accessToken).toBe('synthetic-new-access')
      expect(readConsoleAuthStatusHint()).toBeNull()
    }
    expect(requests.mock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)).toEqual([
      `GET ${tenantUrl}`, 'POST /v1/auth/login-sessions/synthetic-session/refresh',
      ...(refresh === 'successful' ? [`GET ${tenantUrl}`] : []),
    ])
  },
)

test.each(['/', '/next/'])('concurrent guarded retry 401s navigate and invalidate only once under %s', async (base) => {
  const session = login()
  const events = vi.fn()
  const unsubscribe = subscribeConsoleSessionInvalidated(events)
  const remove = vi.spyOn(Storage.prototype, 'removeItem')
  const locations: string[] = []
  function LocationObserver() {
    const location = useLocation()
    useEffect(() => { locations.push(location.pathname) }, [location])
    return null
  }
  let completed!: Promise<PromiseSettledResult<unknown>[]>
  function ConcurrentPage() {
    useEffect(() => {
      completed = Promise.allSettled([
        requestConsoleSessionJson('/v1/guarded-a'), requestConsoleSessionJson('/v1/guarded-b'),
      ])
    }, [])
    return <h1>Protected concurrent page</h1>
  }
  let release!: () => void
  const bothRetries = new Promise<void>((resolve) => { release = resolve })
  let retries = 0
  const respond = async (init: RequestInit) => {
    if (new Headers(init.headers).get('Authorization') === 'Bearer synthetic-new-access') {
      if (++retries === 2) release()
      await bothRetries
    }
    return Response.json({ code: 'DENIED' }, { status: 401 })
  }
  requests = strictFetch({
    'GET /v1/guarded-a': respond, 'GET /v1/guarded-b': respond,
    'POST /v1/auth/login-sessions/synthetic-session/refresh': {
      ...session, tokenSet: { ...session.tokenSet!, accessToken: 'synthetic-new-access' },
    },
  })
  try {
    render(<MemoryRouter basename={base} initialEntries={[`${base}console/concurrent`]}>
      <LocationObserver /><Routes>
        <Route path="/console/concurrent" element={<ProtectedRoute><ConcurrentPage /></ProtectedRoute>} />
        <Route path={consoleAuthConfig.loginPath} element={<h1>Configured login</h1>} />
      </Routes>
    </MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Configured login' })).toBeVisible()
    await act(async () => {
      expect(await completed).toEqual([
        expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ status: 401 }) }),
        expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ status: 401 }) }),
      ])
    })
    expect(events).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls.filter(([key]) => key === 'in-falcone.console-shell-session')).toHaveLength(1)
    expect(locations.filter((path) => path === consoleAuthConfig.loginPath)).toHaveLength(1)
    expect(requests.mock.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(4)
    expect(requests.mock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(readConsoleShellSession()).toBeNull()
  } finally { unsubscribe(); remove.mockRestore() }
})
