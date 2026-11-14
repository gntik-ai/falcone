import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { appRoutes, pendingRouteElement } from '../src/router'
import { isMigratedRoute } from '../src/shell/navigation'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { keysPath, pg, rowsUrl } from './parity/pages/console-postgres-data-page.manifest'
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const workspace = 'synthetic-workspace'
const shell = () => ({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), 'GET /v1/tenants/synthetic-tenant': buildTenantCollectionFixture().items[0], [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture() })
function Where() { return <output aria-label="Current location">{useLocation().pathname}</output> }
const open = (path = '/console/postgres/data') => render(<MemoryRouter initialEntries={[path]}><Where /><App /></MemoryRouter>)
const pageCalls = () => requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/postgres/') || String(path).includes('/api-keys') || String(path).endsWith('/refresh')).map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path), headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined }))
const target = async () => {
  fireEvent.change(await screen.findByLabelText('Base de datos', {}, { timeout: 10000 }), { target: { value: 'app_db' } }); fireEvent.change(screen.getByLabelText('Tabla'), { target: { value: 'accounts' } })
}
const rows = rowsUrl({ workspace })

test.each(['tenant_viewer', 'tenant_owner', 'superadmin'])('authenticated %s reaches the data editor with no guard and the route is migrated', async (role) => {
  login([role], ['synthetic-tenant']); requests = strictFetch(shell()); open()
  expect(await screen.findByRole('heading', { name: 'Editor de datos' }, { timeout: 10000 })).toBeVisible(); expect(isMigratedRoute('/console/postgres/data')).toBe(true)
  expect(await screen.findByText('Introduce una base de datos y una tabla para comenzar.')).toBeVisible(); expect(pageCalls()).toEqual([])
})
test('entering a target sends exactly the rows read and the api-keys read for the active workspace', async () => {
  login(['tenant_owner'], ['synthetic-tenant']); requests = strictFetch({ ...shell(), [`GET ${rows}`]: pg['pg-rows-page1'], [`GET ${keysPath(workspace)}`]: pg['pg-api-keys'] }); open(); await target()
  await screen.findByRole('table', { name: 'Filas de la tabla' }); await screen.findByRole('table', { name: 'Claves API del área de trabajo' })
  expect(pageCalls().map(({ method, path }) => `${method} ${path}`).sort()).toEqual([`GET ${keysPath(workspace)}`, `GET ${rows}`].sort())
})
test('401 with a successful refresh sends one refresh POST, then one replay with the refreshed session, and the rows render', async () => {
  const initial = login(['tenant_owner'], ['synthetic-tenant']), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal; let count = 0
  const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
  requests = strictFetch({ ...shell(), [`GET ${rows}`]: () => ++count === 1 ? Response.json({}, { status: 401 }) : Response.json(pg['pg-rows-page1']), [`GET ${keysPath(workspace)}`]: pg['pg-api-keys'], [`POST ${refresh}`]: () => Response.json(fresh) })
  open(); await target(); await screen.findByText('user1@example.test', {}, { timeout: 10000 })
  const calls = pageCalls(); expect(calls.filter(({ method, path }) => method === 'POST' && path === refresh)).toHaveLength(1)
  const reads = calls.filter(({ path }) => path === rows); expect(reads).toHaveLength(2); expect(reads[1].headers.get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
  expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/postgres/data')
})
test('401 with a rejected refresh sends no replay and redirects to /login with the return path', async () => {
  login(['tenant_owner'], ['synthetic-tenant']); const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
  requests = strictFetch({ ...shell(), [`GET ${rows}`]: () => Response.json({}, { status: 401 }), [`GET ${keysPath(workspace)}`]: pg['pg-api-keys'], [`POST ${refresh}`]: () => Response.json({}, { status: 400 }) })
  open(); await target(); await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, { timeout: 10000 })
  expect(screen.getByLabelText('Current location')).toHaveTextContent('/login'); expect(readProtectedRouteIntent()).toBe('/console/postgres/data')
  expect(pageCalls().filter(({ path }) => path === rows)).toHaveLength(1)
})
test('rollback uses the shared pending element and sends no page request', async () => {
  login(['tenant_owner'], ['synthetic-tenant']); requests = strictFetch(shell())
  const route = appRoutes.find(({ path }) => path === '/console')!.children!.find(({ path }) => path === 'postgres/data')!, flag = pendingConsoleRoutes.find(({ path }) => path === 'postgres/data')!
  const element = route.element, migrated = flag.migrated; route.element = pendingRouteElement(); flag.migrated = false
  try { open(); await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 10000 }); expect(pageCalls()).toEqual([]); expect(isMigratedRoute('/console/postgres/data')).toBe(false) }
  finally { route.element = element; flag.migrated = migrated }
})
test('the strict fetch mock records no DDL, export, import, bulk insert or rotation request', async () => {
  login(['tenant_owner'], ['synthetic-tenant']); requests = strictFetch({ ...shell(), [`GET ${rows}`]: pg['pg-rows-page1'], [`GET ${keysPath(workspace)}`]: pg['pg-api-keys'] }); open(); await target(); await screen.findByRole('table', { name: 'Filas de la tabla' })
  await waitFor(() => expect(pageCalls()).toHaveLength(2))
  expect(pageCalls().some(({ path }) => /\/(exports|imports|rotations|bulk|columns|indexes)|\/schemas$|\/tables$/.test(path))).toBe(false)
})
