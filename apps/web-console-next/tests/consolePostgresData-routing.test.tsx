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
import { fixtures, keysPath, rowsUrl } from './parity/pages/console-postgres-data-page.manifest'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const shell = () => ({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), 'GET /v1/tenants/synthetic-tenant': buildTenantCollectionFixture().items[0], [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture() })
function Where() { return <output aria-label="Current location">{useLocation().pathname}</output> }
const open = (path = '/console/postgres/data') => render(<MemoryRouter initialEntries={[path]}><Where /><App /></MemoryRouter>)
const pageCalls = () => requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/postgres/') || String(path).startsWith('/v1/workspaces/') || String(path).endsWith('/refresh')).map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path) }))
// The synthetic shell workspace id, taken from the shell fixture rather than hard-coded.
const syntheticWorkspace = () => buildWorkspaceCollectionFixture().items[0].workspaceId
const rows = (workspace: string) => `/v1/postgres/workspaces/${workspace}/data/app_db/schemas/public/tables/accounts`

test.each(['tenant_viewer', 'tenant_owner', 'superadmin'])('authenticated %s reaches the data editor with no guard and the route is migrated', async (role) => {
  login([role], ['synthetic-tenant']); requests = strictFetch(shell()); open()
  expect(await screen.findByRole('heading', { name: 'Editor de datos' }, { timeout: 10000 })).toBeVisible(); expect(isMigratedRoute('/console/postgres/data')).toBe(true)
  expect(await screen.findByText('Introduce una base de datos y una tabla para comenzar.', undefined, { timeout: 10000 })).toBeVisible(); expect(pageCalls()).toEqual([])
})
test('the shell loads rows and keys for the synthetic workspace when the target is entered', async () => {
  login(['tenant_owner'], ['synthetic-tenant']); const workspace = syntheticWorkspace()
  requests = strictFetch({ ...shell(), [`GET ${rowsUrl({ base: `${rows(workspace)}/rows` })}`]: fixtures['pg-rows-page1'], [`GET /v1/workspaces/${workspace}/api-keys`]: fixtures['pg-api-keys'] }); open()
  await screen.findByRole('heading', { name: 'Editor de datos' }, { timeout: 10000 }); await screen.findByLabelText('Base de datos')
  fireEvent.change(screen.getByLabelText('Base de datos'), { target: { value: 'app_db' } }); fireEvent.change(screen.getByLabelText('Tabla'), { target: { value: 'accounts' } })
  await screen.findByText('acc_01'); expect(pageCalls()).toHaveLength(2); void keysPath
})
test.each([false, true])('401 on rows (refresh rejected=%s) has one refresh and exactly the permitted replay', async (rejected) => {
  const initial = login(['tenant_owner'], ['synthetic-tenant']), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal; let count = 0
  const workspace = syntheticWorkspace(), url = rowsUrl({ base: `${rows(workspace)}/rows` }), refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
  requests = strictFetch({ ...shell(), [`GET ${url}`]: () => ++count === 1 ? Response.json({}, { status: 401 }) : Response.json(fixtures['pg-rows-page1']), [`GET /v1/workspaces/${workspace}/api-keys`]: fixtures['pg-api-keys'], [`POST ${refresh}`]: () => rejected ? Response.json({}, { status: 400 }) : Response.json(fresh) }); open()
  await screen.findByLabelText('Base de datos', undefined, { timeout: 10000 }); fireEvent.change(screen.getByLabelText('Base de datos'), { target: { value: 'app_db' } }); fireEvent.change(screen.getByLabelText('Tabla'), { target: { value: 'accounts' } })
  if (rejected) { await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, { timeout: 10000 }); expect(screen.getByLabelText('Current location')).toHaveTextContent('/login'); expect(readProtectedRouteIntent()).toBe('/console/postgres/data') }
  else { await screen.findByText('acc_01', undefined, { timeout: 10000 }); expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/postgres/data') }
  const sent = pageCalls().filter(({ path }) => path === url || path === refresh)
  expect(sent).toEqual([{ method: 'GET', path: url }, { method: 'POST', path: refresh }, ...(rejected ? [] : [{ method: 'GET', path: url }])])
  if (!rejected) { const reads = requests.mock.mock.calls.filter(([path]) => path === url); expect(new Headers(reads[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`) }
})
test('rollback uses the shared pending element and sends no postgres request', async () => {
  login(['tenant_owner'], ['synthetic-tenant']); requests = strictFetch(shell())
  const route = appRoutes.find(({ path }) => path === '/console')!.children!.find(({ path }) => path === 'postgres/data')!, flag = pendingConsoleRoutes.find(({ path }) => path === 'postgres/data')!
  const element = route.element, migrated = flag.migrated; route.element = pendingRouteElement(); flag.migrated = false
  try { open(); await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 10000 }); expect(pageCalls()).toEqual([]); expect(isMigratedRoute('/console/postgres/data')).toBe(false) }
  finally { route.element = element; flag.migrated = migrated }
  await waitFor(() => expect(flag.migrated).toBe(true))
})
