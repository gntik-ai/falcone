import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { appRoutes, pendingRouteElement } from '../src/router'
import { isMigratedRoute } from '../src/shell/navigation'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { fixtures, urls } from './parity/pages/console-mongo-page.manifest'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const shell = () => ({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), 'GET /v1/tenants/synthetic-tenant': buildTenantCollectionFixture().items[0], [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture() })
function Where() { return <output aria-label="Current location">{useLocation().pathname}</output> }
function open(path = '/console/mongo') { return render(<MemoryRouter initialEntries={[path]}><Where /><App /></MemoryRouter>) }
const mongoCalls = () => requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/mongo/') || String(path).endsWith('/refresh')).map(([path, init]) => ({ method: init?.method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined }))

test.each(['tenant_viewer', 'tenant_owner', 'superadmin'])('authenticated %s reaches MongoDB with no guard and exactly the databases read', async (role) => {
  login([role], ['synthetic-tenant']); requests = strictFetch({ ...shell(), [`GET ${urls.databases()}`]: fixtures.databases }); open()
  expect(await screen.findByRole('button', { name: 'catalog' }, { timeout: 10000 })).toBeVisible()
  expect(isMigratedRoute('/console/mongo')).toBe(true); expect(isMigratedRoute('/console/mongo/data')).toBe(true); expect(pendingConsoleRoutes.find(({ path }) => path === 'mongo')?.migrated).toBe(true)
  expect(mongoCalls()).toEqual([{ method: 'GET', path: urls.databases(), body: undefined }])
})
test.each([false, true])('401 rejected=%s has one refresh and exactly the permitted replay', async (rejected) => {
  const initial = login(), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal; let count = 0
  const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
  requests = strictFetch({ ...shell(), [`GET ${urls.databases()}`]: () => ++count === 1 ? Response.json({}, { status: 401 }) : Response.json(fixtures.databases), [`POST ${refresh}`]: () => rejected ? Response.json({}, { status: 400 }) : Response.json(fresh) }); open()
  if (rejected) { await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, { timeout: 10000 }); expect(screen.getByLabelText('Current location')).toHaveTextContent('/login'); expect(readProtectedRouteIntent()).toBe('/console/mongo'); expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('ventas') }
  else { await screen.findByRole('button', { name: 'catalog' }, { timeout: 10000 }); expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/mongo') }
  expect(mongoCalls()).toEqual([{ method: 'GET', path: urls.databases(), body: undefined }, { method: 'POST', path: refresh, body: { refreshToken: initial.tokenSet?.refreshToken } }, ...(rejected ? [] : [{ method: 'GET', path: urls.databases(), body: undefined }])])
  if (!rejected) { const reads = requests.mock.mock.calls.filter(([path]) => path === urls.databases()); expect(new Headers(reads[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`) }
})
test('a 401 on the wizard POST refreshes once and replays the POST with its body and key; a rejected refresh sends no replay and persists nothing', async () => {
  for (const rejected of [false, true]) {
    const initial = login(), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal; let count = 0
    const refresh = '/v1/auth/login-sessions/synthetic-session/refresh', submit = '/v1/workspaces/synthetic-workspace/databases'
    requests = strictFetch({ ...shell(), [`GET ${urls.databases()}`]: fixtures.databases, 'GET /v1/metrics/tenants/synthetic-tenant/quotas': {}, 'GET /v1/metrics/tenants/synthetic-tenant/overview': {}, 'GET /v1/metrics/workspaces/synthetic-workspace/quotas': { dimensions: [] }, 'GET /v1/metrics/workspaces/synthetic-workspace/overview': {},
      [`POST ${submit}`]: () => ++count === 1 ? Response.json({}, { status: 401 }) : Response.json({ databaseId: 'catalog' }, { status: 201 }), [`POST ${refresh}`]: () => rejected ? Response.json({}, { status: 400 }) : Response.json(fresh) })
    const view = open(); await screen.findByRole('button', { name: 'catalog' }, { timeout: 10000 }); fireEvent.click(screen.getByRole('button', { name: 'Nueva base de datos' }))
    const dialog = await screen.findByTestId('mongo-wizard'); const { within } = await import('@testing-library/react')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' })); fireEvent.change(within(dialog).getByLabelText('Nombre'), { target: { value: 'ventas' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' })); fireEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }))
    if (rejected) { await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, { timeout: 10000 }); expect(readProtectedRouteIntent()).toBe('/console/mongo'); expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('ventas') }
    else await screen.findByTestId('mongo-wizard-result', undefined, { timeout: 10000 })
    const writes = requests.mock.mock.calls.filter(([path, init]) => path === submit && init?.method === 'POST')
    expect(writes).toHaveLength(rejected ? 1 : 2)
    if (!rejected) { expect(writes[1][1]?.body).toBe(writes[0][1]?.body); expect(new Headers(writes[1][1]?.headers).get('Idempotency-Key')).toBe(new Headers(writes[0][1]?.headers).get('Idempotency-Key')); expect(new Headers(writes[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`) }
    requests.verify(); view.unmount(); sessionStorage.clear(); localStorage.clear()
  }
})
test('rollback uses the shared pending element and serves no mongo request', async () => {
  login(); requests = strictFetch(shell()); const route = appRoutes.find(({ path }) => path === '/console')!.children!.find(({ path }) => path === 'mongo')!, flag = pendingConsoleRoutes.find(({ path }) => path === 'mongo')!
  const element = route.element, migrated = flag.migrated; route.element = pendingRouteElement(); flag.migrated = false
  try { open(); await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 10000 }); expect(mongoCalls()).toEqual([]); expect(isMigratedRoute('/console/mongo')).toBe(false); expect(isMigratedRoute('/console/mongo/data')).toBe(true) }
  finally { route.element = element; flag.migrated = migrated }
})
