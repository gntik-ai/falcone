import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { useConsoleContext } from '../src/shell/context'
import type { ReactNode } from 'react'
import { App } from '../src/App'
import { appRoutes, pendingRouteElement } from '../src/router'
import { isMigratedRoute } from '../src/shell/navigation'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { fixtures, pageUrl, paths } from './parity/pages/console-postgres-page.manifest'
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const shell = () => ({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), 'GET /v1/tenants/synthetic-tenant': buildTenantCollectionFixture().items[0], [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture() })
function Where() { return <output aria-label="Current location">{useLocation().pathname}</output> }
function open(path = '/console/postgres') { return render(<MemoryRouter initialEntries={[path]}><Where /><App /></MemoryRouter>) }
const pgCalls = () => requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/postgres/') || String(path).endsWith('/refresh')).map(([path, init]) => ({ method: init?.method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined }))
test.each(['tenant_viewer', 'tenant_owner', 'superadmin'])('authenticated %s reaches PostgreSQL with no guard', async (role) => {
  login([role], ['synthetic-tenant']); requests = strictFetch({ ...shell(), [`GET ${pageUrl(paths.databases)}`]: fixtures.databases }); open()
  expect(await screen.findByRole('button', { name: 'app_db' }, { timeout: 10000 })).toBeVisible(); expect(isMigratedRoute('/console/postgres')).toBe(true); expect(isMigratedRoute('/console/postgres/data')).toBe(false)
  expect(pgCalls()).toEqual([{ method: 'GET', path: pageUrl(paths.databases), body: undefined }])
})
test.each([false, true])('401 rejected=%s has one refresh and exactly the permitted replay', async (rejected) => {
  const initial = login(), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal; let count = 0
  const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
  requests = strictFetch({ ...shell(), [`GET ${pageUrl(paths.databases)}`]: () => ++count === 1 ? Response.json({}, { status: 401 }) : Response.json(fixtures.databases), [`POST ${refresh}`]: () => rejected ? Response.json({}, { status: 400 }) : Response.json(fresh) }); open()
  if (rejected) { await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, { timeout: 10000 }); expect(screen.getByLabelText('Current location')).toHaveTextContent('/login'); expect(readProtectedRouteIntent()).toBe('/console/postgres') }
  else { await screen.findByRole('button', { name: 'app_db' }, { timeout: 10000 }); expect(screen.getByLabelText('Current location')).toHaveTextContent('/console/postgres') }
  expect(pgCalls()).toEqual([{ method: 'GET', path: pageUrl(paths.databases), body: undefined }, { method: 'POST', path: refresh, body: { refreshToken: initial.tokenSet?.refreshToken } }, ...(rejected ? [] : [{ method: 'GET', path: pageUrl(paths.databases), body: undefined }])])
  if (!rejected) { const reads = requests.mock.mock.calls.filter(([path]) => path === pageUrl(paths.databases)); expect(new Headers(reads[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`) }
})
test('workspace picker selects ws-1 and sends the schemas read once', async () => {
  login(); const collection = buildWorkspaceCollectionFixture(); const base = collection.items[0]
  requests = strictFetch({ ...shell(), [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [{ ...base, workspaceId: 'ws-1', displayName: 'One' }, { ...base, workspaceId: 'ws-2', displayName: 'Two' }], page: {} }, [`GET ${pageUrl(paths.databases)}`]: fixtures.databases, [`GET ${pageUrl(paths.schemas)}`]: fixtures.schemas }); open()
  fireEvent.click(await screen.findByRole('button', { name: 'app_db' }, { timeout: 10000 })); expect(pgCalls()).toHaveLength(1)
  fireEvent.click(screen.getByRole('combobox', { name: 'Seleccionar área de trabajo' })); const option = await screen.findByRole('option', { name: 'One' }); fireEvent.pointerDown(option); fireEvent.click(option); await screen.findByRole('button', { name: 'public' })
  expect(pgCalls()).toHaveLength(2)
})
test('rollback uses the shared pending element and sends no postgres request', async () => {
  login(); requests = strictFetch(shell()); const route = appRoutes.find(({ path }) => path === '/console')!.children!.find(({ path }) => path === 'postgres')!, flag = pendingConsoleRoutes.find(({ path }) => path === 'postgres')!
  const element = route.element, migrated = flag.migrated; route.element = pendingRouteElement(); flag.migrated = false
  try { open(); await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 10000 }); expect(pgCalls()).toEqual([]); expect(isMigratedRoute('/console/postgres')).toBe(false) }
  finally { route.element = element; flag.migrated = migrated }
})

let captured: ReturnType<typeof useConsoleContext> | null = null
function WorkspaceProbe({ children }: { children: ReactNode }) { captured = useConsoleContext(); return children }
test('selected database keeps workspace loading and error; Retry sends exactly one synthetic-tenant workspace GET', async () => {
  login(); let count = 0, release!: (value: Response) => void
  const collection = buildWorkspaceCollectionFixture(), base = collection.items[0]
  const two = { items: [{ ...base, workspaceId: 'ws-1', displayName: 'One' }, { ...base, workspaceId: 'ws-2', displayName: 'Two' }], page: {} }
  requests = strictFetch({ ...shell(), [`GET ${workspaceUrl('synthetic-tenant')}`]: () => ++count === 2 ? new Promise<Response>((resolve) => { release = resolve }) : Response.json(two), [`GET ${pageUrl(paths.databases)}`]: fixtures.databases })
  const route = appRoutes.find(({ path }) => path === '/console')!.children!.find(({ path }) => path === 'postgres')!, original = route.element
  route.element = <WorkspaceProbe>{original}</WorkspaceProbe>
  try {
    open(); fireEvent.click(await screen.findByRole('button', { name: 'app_db' }, { timeout: 10000 })); expect(pgCalls()).toHaveLength(1)
    let pending: Promise<void> | undefined
    act(() => { pending = captured!.reloadWorkspaces?.() })
    await screen.findByRole('heading', { name: 'Cargando áreas de trabajo' }); await waitFor(() => expect(release).toBeTypeOf('function'))
    await act(async () => { release(Response.json({}, { status: 500 })); await pending })
    await screen.findByTestId('pg-failure-workspace'); const before = count
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })); await screen.findByRole('combobox', { name: 'Seleccionar área de trabajo' }); expect(count).toBe(before + 1); expect(pgCalls()).toHaveLength(1)
  } finally { route.element = original; captured = null }
})
