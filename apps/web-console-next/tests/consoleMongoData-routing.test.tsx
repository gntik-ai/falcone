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
import { docsUrl, fixtures } from './parity/pages/console-mongo-data-page.manifest'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const shell = () => ({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), 'GET /v1/tenants/synthetic-tenant': buildTenantCollectionFixture().items[0], [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture() })
function Where() { return <output aria-label="Current location">{useLocation().pathname}</output> }
const open = (path = '/console/mongo/data') => render(<MemoryRouter initialEntries={[path]}><Where /><App /></MemoryRouter>)
const pageCalls = () => requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/mongo/') || String(path).startsWith('/v1/workspaces/') || String(path).endsWith('/refresh')).map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path) }))
// The synthetic shell workspace id, taken from the shell fixture rather than hard-coded.
const syntheticWorkspace = () => buildWorkspaceCollectionFixture().items[0].workspaceId
const base = (workspace: string) => `/v1/mongo/workspaces/${workspace}/data/catalog/collections/orders/documents`
const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
const enter = async () => { await screen.findByLabelText('Base de datos', undefined, { timeout: 10000 }); fireEvent.change(screen.getByLabelText('Base de datos'), { target: { value: 'catalog' } }); fireEvent.change(screen.getByLabelText('Colección'), { target: { value: 'orders' } }) }

test.each(['tenant_viewer', 'tenant_owner', 'superadmin'])('authenticated %s reaches the data editor with no guard, the route is migrated and no Mongo request is sent before the fields are set', async (role) => {
  login([role], ['synthetic-tenant']); requests = strictFetch(shell()); open()
  expect(await screen.findByRole('heading', { name: 'Editor de datos Mongo' }, { timeout: 10000 })).toBeVisible(); expect(isMigratedRoute('/console/mongo/data')).toBe(true)
  expect(await screen.findByText('Introduce una base de datos y una colección para comenzar.', undefined, { timeout: 10000 })).toBeVisible(); expect(pageCalls()).toEqual([])
})
test('the shell loads the documents of the synthetic workspace when the target is entered', async () => {
  login(['tenant_owner'], ['synthetic-tenant']); const workspace = syntheticWorkspace()
  requests = strictFetch({ ...shell(), [`GET ${docsUrl({ base: base(workspace) })}`]: fixtures['mongo:documents-page-1'] }); open()
  await enter(); await screen.findByText(/ord_01/, undefined, { timeout: 10000 }); expect(pageCalls()).toEqual([{ method: 'GET', path: docsUrl({ base: base(workspace) }) }])
})
test.each([false, true])('401 on the list (refresh rejected=%s) has one refresh and exactly the permitted replay', async (rejected) => {
  const initial = login(['tenant_owner'], ['synthetic-tenant']), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal; let count = 0
  const workspace = syntheticWorkspace(), url = docsUrl({ base: base(workspace) })
  requests = strictFetch({ ...shell(), [`GET ${url}`]: () => ++count === 1 ? Response.json({}, { status: 401 }) : Response.json(fixtures['mongo:documents-page-1']), [`POST ${refresh}`]: () => rejected ? Response.json({}, { status: 400 }) : Response.json(fresh) }); open()
  await enter()
  if (rejected) { await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, { timeout: 10000 }); expect(screen.getByLabelText('Current location')).toHaveTextContent('/login'); expect(readProtectedRouteIntent()).toBe('/console/mongo/data') }
  else { await screen.findByText(/ord_01/, undefined, { timeout: 10000 }); expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/mongo/data') }
  const sent = pageCalls().filter(({ path }) => path === url || path === refresh)
  expect(sent).toEqual([{ method: 'GET', path: url }, { method: 'POST', path: refresh }, ...(rejected ? [] : [{ method: 'GET', path: url }])])
  if (!rejected) { const reads = requests.mock.mock.calls.filter(([path]) => path === url); expect(new Headers(reads[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`) }
})
// Each write after a 401: one refresh, exactly one replay with the refreshed token, no duplicate write.
const writeCase = {
  insert: { method: 'POST', path: (workspace: string) => base(workspace), body: { document: { status: 'new' } }, start: () => { fireEvent.change(screen.getByLabelText('Documento nuevo (JSON)'), { target: { value: '{"status":"new"}' } }); fireEvent.click(screen.getByRole('button', { name: 'Insertar' })) } },
  update: { method: 'PATCH', path: (workspace: string) => `${base(workspace)}/ord_01`, body: { update: { status: 'shipped' } }, start: () => { fireEvent.click(screen.getByRole('button', { name: 'Editar documento ord_01' })); fireEvent.change(screen.getByLabelText('Documento (JSON)'), { target: { value: '{"status":"shipped"}' } }); fireEvent.click(screen.getByRole('button', { name: 'Guardar' })) } },
  delete: { method: 'DELETE', path: (workspace: string) => `${base(workspace)}/ord_01`, body: undefined, start: () => { fireEvent.click(screen.getByRole('button', { name: 'Eliminar documento ord_01' })); fireEvent.change(screen.getByLabelText('Escribe ord_01 para confirmar'), { target: { value: 'ord_01' } }); fireEvent.click(screen.getByRole('button', { name: 'Eliminar documento' })) } },
} as const
test.each(Object.keys(writeCase) as (keyof typeof writeCase)[])('401 on %s with a good refresh sends one refresh and exactly one replay of the write', async (name) => {
  const initial = login(['tenant_owner'], ['synthetic-tenant']), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal; let attempts = 0
  const workspace = syntheticWorkspace(), url = docsUrl({ base: base(workspace) }), write = writeCase[name], writePath = write.path(workspace)
  requests = strictFetch({ ...shell(), [`GET ${url}`]: fixtures['mongo:documents-page-1'], [`${write.method} ${writePath}`]: () => ++attempts === 1 ? Response.json({}, { status: 401 }) : Response.json({ ok: true }), [`POST ${refresh}`]: fresh }); open()
  await enter(); await screen.findByText(/ord_01/, undefined, { timeout: 10000 }); write.start()
  await waitFor(() => expect(attempts).toBe(2), { timeout: 10000 })
  expect(pageCalls().filter(({ path }) => path === writePath || path === refresh)).toEqual([{ method: write.method, path: writePath }, { method: 'POST', path: refresh }, { method: write.method, path: writePath }])
  const sent = requests.mock.mock.calls.filter(([path, init]) => path === writePath && init?.method === write.method); expect(new Headers(sent[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
  if (write.body) expect(JSON.parse(String(sent[1][1]?.body))).toEqual(write.body)
})
test('rollback uses the shared pending element and sends no Mongo request', async () => {
  login(['tenant_owner'], ['synthetic-tenant']); requests = strictFetch(shell())
  const route = appRoutes.find(({ path }) => path === '/console')!.children!.find(({ path }) => path === 'mongo/data')!, flag = pendingConsoleRoutes.find(({ path }) => path === 'mongo/data')!
  const element = route.element, migrated = flag.migrated; route.element = pendingRouteElement(); flag.migrated = false
  try { open(); await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 10000 }); expect(pageCalls()).toEqual([]); expect(isMigratedRoute('/console/mongo/data')).toBe(false) }
  finally { route.element = element; flag.migrated = migrated }
  await waitFor(() => expect(flag.migrated).toBe(true))
})
