import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ensureConsoleSession, persistConsoleShellSession, readConsoleAuthStatusHint, readConsoleShellSession, readProtectedRouteIntent, requestConsoleSessionJson, subscribeConsoleSessionInvalidated } from '@in-falcone/console-api/session'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { App } from '../src/App'
import { canManageWorkspaceSecrets } from '@in-falcone/console-api/workspace-secrets-access'
import { changeLocale } from '../src/i18n'
import { StrictMode, useEffect, useState } from 'react'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { ProtectedRoute } from '../src/shell/session'
import { Shell } from '../src/shell/Shell'
import { ErrorPanel } from '@gntik-ai/blocks'
function open(path: string, basename = '/') {
  return render(<MemoryRouter basename={basename} initialEntries={[path]}><CurrentLocation /><App /></MemoryRouter>)
}
function CurrentLocation() {
  const { pathname, search, hash } = useLocation()
  return <output aria-label="Current location">{pathname}{search}{hash}</output>
}

const refreshUrl = '/v1/auth/login-sessions/synthetic-session/refresh'
const sessionKey = 'in-falcone.console-shell-session'
const expiredHint = {
  statusView: 'login', title: 'Tu sesión ha expirado', message: 'Vuelve a autenticarte para continuar en la consola.'
}

test.each(['/', '/next/'].flatMap(base =>
  ['retry-401', 'refresh-rejected', 'retry-200'].map(scenario => ({ base, scenario }))
))('$base shell handles $scenario without an additional refresh', async ({ base, scenario }) => {
  const setupRequests = () => {
    const refreshed = login()
    refreshed.tokenSet!.accessToken = 'synthetic-refreshed-access'
    let gets = 0
    return strictFetch({
      [`GET ${tenantUrl}`]: () => {
        gets++
        return gets === 1 || scenario !== 'retry-200'
          ? Response.json({ code: 'UNAUTHORIZED', message: 'Synthetic 401 error' }, { status: 401 })
          : Response.json({ items: [] })
      },
      [`POST ${refreshUrl}`]: () => scenario === 'refresh-rejected'
        ? Response.json({ code: 'REFRESH_REJECTED' }, { status: 400 })
        : Response.json(refreshed)
    })
  }
  // Compare the shell with the shared client's own refresh count using identical responses.
  const direct = setupRequests()
  const result = requestConsoleSessionJson(tenantUrl)
  if (scenario === 'retry-200') await result
  else await expect(result).rejects.toMatchObject({ status: 401 })
  direct.verify()
  const directRefreshes = direct.mock.mock.calls.filter(([url]) => url === refreshUrl).length

  requests = setupRequests()
  const path = `${base}console/overview?filter=active#details`
  open(path, base.replace(/\/$/, '') || '/')
  if (scenario === 'retry-200') {
    expect(await screen.findByRole('heading', { name: 'Resumen' })).toBeVisible()
    await waitFor(() => expect(readConsoleShellSession()?.tokenSet?.accessToken).toBe('synthetic-refreshed-access'))
    await waitFor(() => expect(screen.getByLabelText('Contexto activo')).toHaveAttribute('aria-busy', 'false'))
    expect(screen.getByLabelText('Current location').textContent).toBe('/console/overview?filter=active#details')
    expect(readProtectedRouteIntent()).toBeNull()
  } else {
    expect(await screen.findByRole('heading', { name: 'Acceso' })).toBeVisible()
    expect(screen.getByLabelText('Current location').textContent).toBe(consoleAuthConfig.loginPath)
    expect(sessionStorage.getItem(sessionKey)).toBeNull()
    expect(readConsoleAuthStatusHint()).toEqual(expiredHint)
    expect(readProtectedRouteIntent()).toBe(path)
  }
  expect(requests.mock.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(scenario === 'refresh-rejected' ? 1 : 2)
  expect(requests.mock.mock.calls.filter(([url]) => url === refreshUrl)).toHaveLength(directRefreshes)
  expect(directRefreshes).toBe(1)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByText(/Synthetic 401 error|Comprueba tu conexión|Check your connection|^401$/)).not.toBeInTheDocument()
})

function GuardedRequestPage() {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    void requestConsoleSessionJson('/v1/test-page').catch(() => setFailed(true))
  }, [])
  return failed ? <ErrorPanel title="401" message="Synthetic page request failure" /> : <h1>Guarded request page</h1>
}

test.each(['/', '/next/'])('%s concurrent shell context and page retry 401s navigate once', async base => {
  const refreshed = login()
  refreshed.tokenSet!.accessToken = 'synthetic-refreshed-access'
  const unauthorized = () => Response.json({ code: 'RETRY_401' }, { status: 401 })
  requests = strictFetch({
    [`GET ${tenantUrl}`]: unauthorized,
    'GET /v1/test-page': unauthorized,
    [`POST ${refreshUrl}`]: refreshed
  })
  const invalidated = vi.fn()
  const navigated = vi.fn()
  const remove = vi.spyOn(Storage.prototype, 'removeItem')
  const unsubscribe = subscribeConsoleSessionInvalidated(invalidated)
  function NavigationRecorder() {
    const location = useLocation()
    useEffect(() => { navigated(location.pathname) }, [location.key])
    return null
  }
  try {
    render(<MemoryRouter basename={base.replace(/\/$/, '') || '/'} initialEntries={[`${base}console/overview?x=1#s`]}>
      <NavigationRecorder /><Routes>
        <Route path="/console" element={<ProtectedRoute><Shell /></ProtectedRoute>}>
          <Route path="overview" element={<GuardedRequestPage />} />
        </Route>
        <Route path={consoleAuthConfig.loginPath} element={<h1>Configured login</h1>} />
      </Routes>
    </MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Configured login' })).toBeVisible()
    expect(requests.mock.mock.calls.filter(([url]) => url === tenantUrl)).toHaveLength(2)
    expect(requests.mock.mock.calls.filter(([url]) => url === '/v1/test-page')).toHaveLength(2)
    expect(requests.mock.mock.calls.filter(([url]) => url === refreshUrl)).toHaveLength(1)
    expect(invalidated).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls.filter(([key]) => key === sessionKey)).toHaveLength(1)
    expect(navigated.mock.calls.filter(([path]) => path === consoleAuthConfig.loginPath)).toHaveLength(1)
    expect(readProtectedRouteIntent()).toBe(`${base}console/overview?x=1#s`)
    expect(screen.queryByText('401')).not.toBeInTheDocument()
    expect(screen.queryByText('Synthetic page request failure')).not.toBeInTheDocument()
  } finally { unsubscribe() }
})

test('a protected route preserves its query and requires login', async () => {
  sessionStorage.clear()
  open('/console/quotas?x=1')
  expect(await screen.findByRole('heading', { name: 'Acceso' })).toBeVisible()
  expect(readProtectedRouteIntent()).toBe('/console/quotas?x=1')
  expect(sessionStorage.getItem('in-falcone.console-shell-session')).toBeNull()
})

test('in-app navigation revalidates expired access and refresh tokens and preserves the new intent', async () => {
  const session = login(['tenant_owner'])
  requests = strictFetch({})
  open('/console/zzz?x=1#section')
  await screen.findByRole('heading', { name: 'Sección de consola no encontrada' })
  session.expiresAt = session.tokenSet!.expiresAt = '2020-01-01T00:00:00Z'
  session.refreshExpiresAt = session.tokenSet!.refreshExpiresAt = '2020-01-01T00:00:00Z'
  persistConsoleShellSession(session)

  fireEvent.click(screen.getByRole('button', { name: 'Vista general' }))

  expect(await screen.findByRole('heading', { name: 'Acceso' })).toBeVisible()
  expect(readProtectedRouteIntent()).toBe('/console/overview')
  expect(readConsoleShellSession()).toBeNull()
  expect(requests.mock).not.toHaveBeenCalled()
})

test('a rejected session check denies access and preserves the protected intent', async () => {
  login(['tenant_owner'])
  requests = strictFetch({})
  const getItem = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
    if (this === sessionStorage && key === 'in-falcone.console-shell-session') throw new DOMException('Storage unavailable', 'SecurityError')
    return getItem.call(this, key)
  })
  open('/console/quotas?x=1#section')
  expect(await screen.findByRole('heading', { name: 'Acceso' })).toBeVisible()
  expect(readProtectedRouteIntent()).toBe('/console/quotas?x=1#section')
  expect(requests.mock).not.toHaveBeenCalled()
})


let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())

test.each(['iam-access', 'plans', 'auth', 'tenants/t1/plan'].flatMap((path) =>
  [['superadmin'], ['platform_auditor'], ['tenant_owner'], []].map((roles) => ({ path, roles }))
))('$path keeps navigation visible and gates $roles by superadmin', async ({ path, roles }) => {
  login(roles)
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  open(`/console/${path}`)
  expect(await screen.findByRole('heading', { name: roles.includes('superadmin') ? 'Página pendiente' : 'Acceso denegado' })).toBeVisible()
  expect(screen.getByRole('navigation', { name: 'Navegación de consola' })).toBeVisible()
})

test.each(['superadmin', 'platform_admin', 'platform_operator', 'platform_auditor', 'tenant_owner'])('runtime and workspace secrets follow shared permissions for %s', async (role) => {
  login([role])
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  const runtime = open('/console/runtime')
  expect(await screen.findByRole('heading', { name: role === 'tenant_owner' ? 'Acceso denegado' : 'Página pendiente' })).toBeVisible()
  runtime.unmount()
  const allowed = canManageWorkspaceSecrets(readConsoleShellSession(), null)
  open('/console/workspace-secrets')
  expect(await screen.findByRole('heading', { name: allowed ? 'Página pendiente' : 'Acceso denegado' })).toBeVisible()
})

test.each(['superadmin', 'platform_admin', 'platform_operator', 'platform_auditor', 'tenant_owner'].flatMap((role) =>
  [true, false].map((member) => ({ role, member }))
))('workspace secrets uses active workspace w1 for $role with membership $member', async ({ role, member }) => {
  const session = login([role], ['t1'], member ? ['w1'] : [])
  localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: 'synthetic-user', tenantId: 't1', workspaceId: 'w1', updatedAt: '2026-01-01' }))
  requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [{ tenantId: 't1', displayName: 'Tenant One' }] },
    'GET /v1/tenants/t1': { tenantId: 't1', displayName: 'Tenant One' },
    [`GET ${workspaceUrl('t1')}`]: { items: [{ workspaceId: 'w1', tenantId: 't1', displayName: 'Workspace One' }] }
  })
  open('/console/workspace-secrets')
  await screen.findByRole('button', { name: /Workspace One/ })
  const allowed = canManageWorkspaceSecrets(session, 'w1')
  expect(await screen.findByRole('heading', { name: allowed ? 'Página pendiente' : 'Acceso denegado' })).toBeVisible()
})


test.each([
  { roles: ['superadmin'], ids: [], expected: [tenantUrl] },
  { roles: ['tenant_owner'], ids: ['t1', 't2'], expected: ['/v1/tenants/t1', '/v1/tenants/t2'] },
  { roles: ['tenant_owner'], ids: [], expected: [] }
])('tenant bootstrap requests exactly the accessible scope for $roles / $ids', async ({ roles, ids, expected }) => {
  login(roles, ids)
  requests = strictFetch(Object.fromEntries(expected.map((url) => [`GET ${url}`, url === tenantUrl ? { items: [] } : { tenantId: url.endsWith('t1') ? 't1' : 't2', displayName: url } ])))
  open('/console/overview')
  await screen.findByRole('heading', { name: 'Resumen' })
  await waitFor(() => expect(screen.getByLabelText('Organización activa')).toBeInTheDocument())
  expect(requests.mock.mock.calls.map(([url]) => url).sort()).toEqual(expected.sort())
})

test('route workspace overrides stored context, then tenant switching clears it and refetches', async () => {
  login(['tenant_owner'], ['t1', 't2'])
  localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: 'synthetic-user', tenantId: 't1', workspaceId: 'w1', updatedAt: '2026-01-01' }))
  requests = strictFetch({
    'GET /v1/tenants/t1': { tenantId: 't1', displayName: 'Tenant One' },
    'GET /v1/tenants/t2': { tenantId: 't2', displayName: 'Tenant Two' },
    [`GET ${workspaceUrl('t1')}`]: { items: [{ workspaceId: 'w1', tenantId: 't1', displayName: 'Workspace One' }, { workspaceId: 'w2', tenantId: 't1', displayName: 'Workspace Two' }] },
    [`GET ${workspaceUrl('t2')}`]: { items: [] }
  })
  open('/console/workspaces/w2')
  expect(await screen.findByRole('button', { name: /Workspace Two/ })).toBeVisible()
  fireEvent.change(screen.getByLabelText('Organización activa'), { target: { value: 't2' } })
  await waitFor(() => expect(requests.mock.mock.calls.some(([url]) => url === workspaceUrl('t2'))).toBe(true))
  await waitFor(() => expect(screen.queryByRole('button', { name: /Workspace Two/ })).not.toBeInTheDocument())
  const snapshot = JSON.parse(localStorage.getItem('in-falcone.console-active-context')!)
  expect(snapshot).toEqual({ userId: 'synthetic-user', tenantId: 't2', workspaceId: null, updatedAt: expect.any(String) })
})

test.each([['superadmin', 'Resumen', '/console/overview'], ['platform_auditor', 'Página pendiente', '/console/observability']] as const)('index chooses the permission landing for %s', async (role, heading, destination) => {
  login([role])
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  open('/console')
  expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  expect(screen.getByLabelText('Current location').textContent).toBe(destination)
})

test.each([['es', 'Acceso denegado', 'Saltar al contenido principal'], ['en', 'Access denied', 'Skip to main content']] as const)('shell and 403 use app and kit copy in %s', async (locale, heading, skip) => {
  await changeLocale(locale)
  login(['tenant_owner'])
  requests = strictFetch({})
  open('/console/plans')
  expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  expect(screen.getAllByRole('link', { name: skip }).length).toBeGreaterThan(0)
})

test.each([['/console/zzz', 'Sección de consola no encontrada', true], ['/zzz', 'Página no encontrada', false]] as const)('unknown path %s keeps the correct shell', async (path, heading, shell) => {
  login()
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  open(path)
  expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  expect(Boolean(screen.queryByRole('navigation', { name: 'Navegación de consola' }))).toBe(shell)
})


test.each([200, 504, 400])('expired sessions use shared single-flight refresh and handle %s', async (status) => {
  const expired = login(['tenant_owner'])
  expired.tokenSet!.expiresAt = '2020-01-01T00:00:00Z'
  expired.expiresAt = '2020-01-01T00:00:00Z'
  persistConsoleShellSession(expired)
  const fresh = { ...expired, expiresAt: '2099-01-01T00:00:00Z', tokenSet: { ...expired.tokenSet!, expiresAt: '2099-01-01T00:00:00Z' } }
  let posts = 0
  requests = strictFetch({
    'POST /v1/auth/login-sessions/synthetic-session/refresh': async () => {
      posts++
      await new Promise((resolve) => setTimeout(resolve, 10))
      return status === 400 || (status === 504 && posts === 1) ? Response.json({ message: 'Synthetic error' }, { status }) : Response.json(fresh)
    }
  })
  open('/console/overview')
  await act(async () => { await Promise.all([ensureConsoleSession(), ensureConsoleSession()]) })
  expect(posts).toBe(status === 504 ? 2 : 1)
  for (const [, init] of requests.mock.mock.calls) expect(JSON.parse(init!.body as string)).toEqual({ refreshToken: 'synthetic-refresh-token' })
  expect(await screen.findByRole('heading', { name: status === 400 ? 'Acceso' : 'Resumen' })).toBeVisible()
  if (status === 400) {
    expect(sessionStorage.getItem('in-falcone.console-shell-session')).toBeNull()
    expect(readConsoleAuthStatusHint()).toEqual({ statusView: 'login', title: 'Tu sesión ha expirado', message: 'Vuelve a autenticarte para continuar en la consola.' })
  }
})

test.each([204, 500])('sign-out revokes the shared session and leaves for login on %s', async (status) => {
  login(['tenant_owner'])
  requests = strictFetch({
    'DELETE /v1/auth/login-sessions/synthetic-session': () => {
      return new Response(null, { status })
    }
  })
  open('/console/overview')
  await screen.findByRole('heading', { name: 'Resumen' })
  fireEvent.click(screen.getByRole('button', { name: 'Menú de usuario' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }))
  expect(await screen.findByRole('heading', { name: 'Acceso' })).toBeVisible()
  expect(sessionStorage.getItem('in-falcone.console-shell-session')).toBeNull()
  expect(requests.mock).toHaveBeenCalledTimes(1)
  const init = requests.mock.mock.calls[0][1]
  expect(JSON.parse(init!.body as string)).toEqual({ refreshToken: 'synthetic-refresh-token' })
  expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer synthetic-access-token')
})

test('navigation keeps legacy groups, role visibility and same-tab document links', async () => {
  login(['tenant_owner'])
  requests = strictFetch({})
  open('/console/flows/f1/runs/e1')
  await screen.findByRole('heading', { name: 'Página pendiente' })
  const nav = screen.getByRole('navigation', { name: 'Navegación de consola' })
  const flows = Array.from(nav.querySelectorAll('a')).find((link) => link.textContent?.includes('Flujos / workflows'))!
  expect(flows).toHaveAttribute('href', '/console/flows')
  expect(flows).not.toHaveAttribute('target')
  expect(flows).toHaveAttribute('aria-current', 'page')
  expect(nav).not.toHaveTextContent('Acceso IAM')
  expect(screen.getByText('Flujo f1')).toBeVisible()
  expect(screen.getByText('Ejecuciones')).toBeVisible()
  expect(screen.getByText('Ejecución e1')).toBeVisible()
})

test('About belongs to the kit user menu and shows the injected build identity', async () => {
  login(['tenant_owner'])
  requests = strictFetch({})
  vi.stubGlobal('__APP_VERSION__', '1.2.3')
  vi.stubGlobal('__APP_COMMIT_SHA__', '0123456789abcdef0123456789abcdef01234567')
  open('/console/overview')
  await screen.findByRole('heading', { name: 'Resumen' })
  fireEvent.click(screen.getByRole('button', { name: 'Menú de usuario' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Acerca de' }))
  expect(await screen.findByRole('dialog', { name: 'Acerca de' })).toHaveTextContent('1.2.3 · 0123456')
})

test('a tenant route parameter does not replace stored context', async () => {
  login(['superadmin'])
  localStorage.setItem('in-falcone.console-active-context', JSON.stringify({ userId: 'synthetic-user', tenantId: 't2', workspaceId: null, updatedAt: '2026-01-01' }))
  requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [{ tenantId: 't1', displayName: 'Tenant One' }, { tenantId: 't2', displayName: 'Tenant Two' }] },
    [`GET ${workspaceUrl('t2')}`]: { items: [] }
  })
  open('/console/tenants/t1/plan')
  await screen.findByRole('heading', { name: 'Página pendiente' })
  await waitFor(() => expect(screen.getByLabelText('Organización activa')).toHaveValue('t2'))
})

test.each(['plans', 'runtime'])('platform-global %s hides context controls', async (path) => {
  login()
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  open(`/console/${path}`)
  await screen.findByRole('heading', { name: 'Página pendiente' })
  expect(screen.queryByLabelText('Organización activa')).not.toBeInTheDocument()
})

test('the application StrictMode bootstrap makes only one tenant collection request', async () => {
  login()
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  render(<StrictMode><MemoryRouter initialEntries={['/console/overview']}><App /></MemoryRouter></StrictMode>)
  await screen.findByRole('heading', { name: 'Resumen' })
  await waitFor(() => expect(screen.getByLabelText('Contexto activo')).toHaveAttribute('aria-busy', 'false'))
  expect(requests.mock).toHaveBeenCalledTimes(1)
})

test('sign-out uses the latest shared session after token rotation', async () => {
  const session = login(['tenant_owner'])
  requests = strictFetch({
    'DELETE /v1/auth/login-sessions/synthetic-session': () => {
      return new Response(null, { status: 204 })
    }
  })
  open('/console/overview')
  await screen.findByRole('heading', { name: 'Resumen' })
  session.tokenSet!.accessToken = 'synthetic-rotated-access'
  session.tokenSet!.refreshToken = 'synthetic-rotated-refresh'
  persistConsoleShellSession(session)
  fireEvent.click(screen.getByRole('button', { name: 'Menú de usuario' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Cerrar sesión' }))
  await screen.findByRole('heading', { name: 'Acceso' })
  const init = requests.mock.mock.calls[0][1]
  expect(JSON.parse(init!.body as string)).toEqual({ refreshToken: 'synthetic-rotated-refresh' })
  expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer synthetic-rotated-access')
})
