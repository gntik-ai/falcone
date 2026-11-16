import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { inventory, inventoryPath } from './parity/pages/console-functions-page.manifest'
import es from '../src/locales/es/pages.console-functions-page.json'
import common from '../src/locales/es/common.json'
import i18n from '../src/i18n'

const navigation = common.navigation as Record<string, string>
let requests: ReturnType<typeof strictFetch>
beforeEach(async () => { await i18n.changeLanguage('es') })
vi.setConfig({ testTimeout: 20000 })
afterEach(() => requests?.verify())
const timeout = { timeout: 5000 }
function Probe() {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}</output><button onClick={() => navigate('/console/functions')}>Navigate functions</button></>
}
function open(route = '/console/functions') { return render(<MemoryRouter basename="/next" initialEntries={[`/next${route}`]}><App /><Probe /></MemoryRouter>) }
function setup(variant = 'success', role = 'superadmin', routes: Record<string, unknown> = {}) {
  const initial = login([role]), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let attempt = 0
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${inventoryPath}`]: () => ++attempt === 1 && variant !== 'success' ? Response.json({}, { status: 401 }) : Response.json(inventory({ limit: 50, used: 3, remaining: 47 })),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({}, { status: 401 }) : Response.json(fresh),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
    ...routes,
  }); return { initial, fresh }
}
const functionCalls = () => requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/functions'))

test('the route is migrated', () => { expect(isMigratedRoute('/console/functions')).toBe(true) })

test.each(['superadmin', 'tenant_viewer', 'workspace_viewer'])('route has no role guard for %s', async (role) => {
  setup('success', role); open(); await screen.findByRole('table', {}, timeout)
  expect(screen.getByRole('heading', { level: 1, name: es.title })).toBeVisible()
  expect(functionCalls().map(([path]) => path)).toEqual([inventoryPath])
})

test('401 refreshes once and replays the inventory once with the new token', async () => {
  const { initial, fresh } = setup('refresh-ok'); open(); await screen.findByRole('table', {}, timeout)
  const calls = requests.mock.mock.calls, functions = calls.filter(([path]) => path === inventoryPath), refresh = calls.filter(([path]) => String(path).endsWith('/refresh'))
  expect(functions).toHaveLength(2); expect(refresh).toHaveLength(1)
  expect(new Headers(functions[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
  expect(new Headers(functions[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
  expect(screen.getByTestId('location')).toHaveTextContent('/console/functions')
})

test('a rejected refresh redirects to login without a replay and stores the return path', async () => {
  setup('rejected'); open(); await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, timeout)
  expect(requests.mock.mock.calls.filter(([path]) => path === inventoryPath)).toHaveLength(1)
  expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
  expect(screen.getByTestId('location')).toHaveTextContent(consoleAuthConfig.loginPath)
  expect(readProtectedRouteIntent()).toBe('/next/console/functions')
})

test.each(['link', 'navigate'])('%s loads the lazy chunk in-router', async (mode) => {
  setup(); open('/console/overview'); await screen.findByTestId('console-tenant-inventory-summary', {}, timeout)
  const link = screen.getByRole('link', { name: navigation.functions }); expect(link).toHaveAttribute('href', '/next/console/functions')
  if (mode === 'link') expect(fireEvent.click(link)).toBe(false)
  else fireEvent.click(screen.getByRole('button', { name: 'Navigate functions' }))
  await screen.findByRole('table', {}, timeout); expect(screen.getByTestId('location')).toHaveTextContent('/console/functions')
  expect(screen.getByRole('heading', { name: es.title, level: 1 })).toBeVisible()
})

test('the cross-link to quick deploy opens that route in the router', async () => {
  setup(); open(); await screen.findByRole('table', {}, timeout)
  const link = within(screen.getByTestId('console-functions-page')).getByRole('link', { name: es.quickLink })
  expect(link).toHaveAttribute('href', '/next/console/functions/data')
})

test('selecting a function inside the routed app requests exactly the detail and the versions', async () => {
  setup('success', 'superadmin', { 'GET /v1/functions/actions/synthetic-function-1': {}, 'GET /v1/functions/actions/synthetic-function-1/versions?page[size]=50': { items: [] } })
  open(); await screen.findByRole('table', {}, timeout)
  fireEvent.click(screen.getByRole('radio', { name: 'synthetic-hello' }))
  await screen.findByTestId('functions-history', {}, timeout)
  expect(functionCalls().map(([path]) => String(path))).toEqual([inventoryPath, '/v1/functions/actions/synthetic-function-1', '/v1/functions/actions/synthetic-function-1/versions?page[size]=50'])
})
