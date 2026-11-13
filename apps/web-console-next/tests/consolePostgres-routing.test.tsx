import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantFixture, buildWorkspaceFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import * as pg from './parity/fixtures/postgres'
import es from '../src/locales/es/pages.console-postgres-page.json'

let server: ReturnType<typeof strictFetch>
afterEach(() => server?.verify())
const tenant = { ...buildTenantFixture(), tenantId: 't-1', displayName: 'Tenant Alpha' }
const workspace = { ...buildWorkspaceFixture(), tenantId: 't-1', workspaceId: 'ws-1', displayName: 'Workspace Alpha' }
function Probe() { const navigate = useNavigate(), location = useLocation(); return <><output data-testid="location">{location.pathname}</output><button onClick={() => navigate('/console/postgres')}>Navigate postgres</button></> }
function open(route = '/console/postgres', basename = '') { return render(<StrictMode><MemoryRouter basename={basename || '/'} initialEntries={[basename + route]}><App /><Probe /></MemoryRouter></StrictMode>) }
function setup(variant = 'success', role = 'superadmin', routes = {}) {
  const initial = login([role], ['t-1'], ['ws-1']), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let attempts = 0
  server = strictFetch({ [`GET ${tenantUrl}`]: { items: [tenant] }, 'GET /v1/tenants/t-1': tenant, [`GET ${workspaceUrl('t-1')}`]: { items: [workspace] },
    ...pg.reads(), [`GET ${pg.base}${pg.query}`]: () => ++attempts === 1 && variant !== 'success' ? Response.json({}, { status: 401 }) : Response.json(pg.fixtures.databases),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({}, { status: 401 }) : Response.json(fresh),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(), ...routes,
  })
  return { initial, fresh }
}
test.each(['superadmin', 'tenant_owner', 'tenant_viewer', 'workspace_viewer'])('deep link under /next has no role guard for %s', async (role) => {
  setup('success', role); open('/console/postgres', '/next')
  expect(await screen.findByRole('table', { name: es.databasesTable }, { timeout: 5000 })).toBeVisible()
  expect(isMigratedRoute('/console/postgres')).toBe(true)
  expect(isMigratedRoute('/console/postgres/data')).toBe(false)
  expect(server.mock.mock.calls.filter(([path]) => path === pg.base + pg.query)).toHaveLength(1)
})
test.each(['link', 'navigate'])('%s enters the lazy page without React suspension or console errors', async (mode) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  setup(); open('/console/overview', '/next')
  const link = await screen.findByRole('link', { name: 'PostgreSQL' }, { timeout: 5000 })
  await waitFor(() => expect(server.mock.mock.calls.some(([path]) => path === workspaceUrl('t-1'))).toBe(true))
  expect(link).toHaveAttribute('href', '/next/console/postgres')
  fireEvent.click(mode === 'link' ? link : screen.getByRole('button', { name: 'Navigate postgres' }))
  await screen.findByRole('table', { name: es.databasesTable })
  expect(screen.getByTestId('location')).toHaveTextContent('/console/postgres')
  expect(error).not.toHaveBeenCalled()
})
test('401 refresh-ok replays only once with the refreshed token and stays on postgres', async () => {
  const { initial, fresh } = setup('refresh-ok'); open()
  await screen.findByRole('table', { name: es.databasesTable }, { timeout: 5000 })
  const reads = server.mock.mock.calls.filter(([path]) => path === pg.base + pg.query), refresh = server.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))
  expect(reads).toHaveLength(2); expect(refresh).toHaveLength(1)
  expect(new Headers(reads[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet!.accessToken}`)
  expect(new Headers(reads[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet!.accessToken}`)
  expect(refresh[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ refreshToken: initial.tokenSet!.refreshToken }) })
  expect(screen.getByTestId('location')).toHaveTextContent('/console/postgres')
})
test('401 refresh-rejected performs no replay, renders login and preserves the postgres return path', async () => {
  setup('rejected'); open()
  expect(await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, { timeout: 5000 })).toBeVisible()
  expect(server.mock.mock.calls.filter(([path]) => path === pg.base + pg.query)).toHaveLength(1)
  expect(server.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
  expect(readProtectedRouteIntent()).toBe('/console/postgres')
})
test('the CSP session with no accessible tenant sends no on-load postgres request', async () => {
  login(); server = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } }); open()
  await screen.findByRole('heading', { level: 1, name: es.title }, { timeout: 5000 })
  expect(screen.getByRole('button', { name: es.newDatabase })).toBeVisible()
  expect(server.mock.mock.calls.map(([path]) => path)).toEqual([tenantUrl])
})
