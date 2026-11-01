import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { actionsPath, actions2, deployPath, deployAccepted } from './parity/pages/console-functions-data-page.manifest'
import es from '../src/locales/es/pages.console-functions-data-page.json'
import en from '../src/locales/en/pages.console-functions-data-page.json'
import common from '../src/locales/es/common.json'
const navigation = common.navigation as Record<string, string>

import i18n from '../src/i18n'

let requests: ReturnType<typeof strictFetch>
beforeEach(async () => { await i18n.changeLanguage('es') })
vi.setConfig({ testTimeout: 20000 })
afterEach(() => requests?.verify())
const timeout = { timeout: 5000 }
function Probe() {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}</output><button onClick={() => navigate('/console/functions/data')}>Navigate quick deploy</button></>
}
function open(route = '/console/functions/data') { return render(<MemoryRouter basename="/next" initialEntries={[`/next${route}`]}><App /><Probe /></MemoryRouter>) }
function setup(variant = 'success', role = 'superadmin', routes: Record<string, unknown> = {}) {
  const initial = login([role]), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let attempt = 0
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${actionsPath}`]: () => ++attempt === 1 && variant !== 'success' ? Response.json({}, { status: 401 }) : Response.json(actions2),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({}, { status: 401 }) : Response.json(fresh),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
    ...routes,
  }); return { initial, fresh }
}
const functionCalls = () => requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/functions'))

test('the route is migrated', () => { expect(isMigratedRoute('/console/functions/data')).toBe(true) })

test.each(['superadmin', 'tenant_viewer', 'workspace_viewer'])('route has no role guard for %s', async (role) => {
  setup('success', role); open(); await screen.findByRole('table', {}, timeout)
  expect(screen.getByRole('textbox', { name: es.deploySpecLabel })).toBeVisible()
  expect(functionCalls().map(([path]) => path)).toEqual([actionsPath])
})

test('401 refreshes once and replays once with the new token under the basename', async () => {
  const { initial, fresh } = setup('refresh-ok'); open(); await screen.findByRole('table', {}, timeout)
  const calls = requests.mock.mock.calls, functions = calls.filter(([path]) => path === actionsPath), refresh = calls.filter(([path]) => String(path).endsWith('/refresh'))
  expect(functions).toHaveLength(2); expect(refresh).toHaveLength(1)
  expect(new Headers(functions[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
  expect(new Headers(functions[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
  expect(screen.getByTestId('location')).toHaveTextContent('/console/functions/data')
})

test('rejected refresh redirects without replay and stores the basename-inclusive intent', async () => {
  setup('rejected'); open(); await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, timeout)
  expect(requests.mock.mock.calls.filter(([path]) => path === actionsPath)).toHaveLength(1)
  expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
  expect(screen.getByTestId('location')).toHaveTextContent(consoleAuthConfig.loginPath)
  expect(readProtectedRouteIntent()).toBe('/next/console/functions/data')
})

test.each(['link', 'navigate'])('%s loads the lazy chunk in-router', async (mode) => {
  setup(); open('/console/overview'); await screen.findByTestId('console-tenant-inventory-summary', {}, timeout)
  const link = screen.getByRole('link', { name: navigation['functions-data'] }); expect(link).toHaveAttribute('href', '/next/console/functions/data')
  if (mode === 'link') expect(fireEvent.click(link)).toBe(false)
  else fireEvent.click(screen.getByRole('button', { name: 'Navigate quick deploy' }))
  await screen.findByRole('table', {}, timeout); expect(screen.getByTestId('location')).toHaveTextContent('/console/functions/data')
  expect(screen.getByRole('heading', { name: es.title, level: 1 })).toBeVisible()
})

test('the cross-link opens the admin route in-router and the page keeps its english copy available', async () => {
  await i18n.changeLanguage('en'); setup(); open(); await screen.findByRole('table', { name: en.listLegend }, timeout)
  expect(within(screen.getByTestId('console-functions-data-page')).getByRole('link', { name: en.adminLink })).toHaveAttribute('href', '/next/console/functions')
})

test('a deploy inside the routed app keeps the legacy request order and focus', async () => {
  let count = 0
  setup('success', 'superadmin', { [`GET ${actionsPath}`]: () => Response.json(++count === 1 ? actions2 : { items: [...actions2.items, { resourceId: 'synthetic-function-3', actionName: 'hello', execution: { runtime: 'nodejs:20' } }] }), [`POST ${deployPath}`]: deployAccepted })
  open(); await screen.findByRole('table', {}, timeout)
  const page = within(screen.getByTestId('console-functions-data-page'))
  fireEvent.click(page.getByRole('button', { name: es.deploy }))
  await waitFor(() => expect(page.getAllByRole('radio')).toHaveLength(3), timeout)
  expect(functionCalls().map(([path, init]) => `${init?.method ?? 'GET'} ${path}`)).toEqual([`GET ${actionsPath}`, `POST ${deployPath}`, `GET ${actionsPath}`])
  expect(JSON.parse(String(functionCalls()[1][1]?.body))).toMatchObject({ tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace', actionName: 'hello' })
})

test('workspace error retry reloads only shell workspaces and the picker activates a workspace', async () => {
  login(); let attempt = 0; const workspace = buildWorkspaceCollectionFixture().items[0]
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: () => ++attempt === 1 ? Response.json({}, { status: 500 }) : Response.json({ items: [workspace, { ...workspace, workspaceId: 'synthetic-other', displayName: 'Other workspace' }] }), [`GET ${actionsPath}`]: actions2 })
  open(); const heading = await screen.findByRole('heading', { name: es.workspaceError }, timeout)
  expect(functionCalls()).toHaveLength(0)
  fireEvent.click(within(heading.closest('section') ?? document.body).getByRole('button', { name: es.retry }))
  const picker = await screen.findByRole('combobox', { name: es.workspaceLabel }, timeout)
  expect(requests.mock.mock.calls.map(([path]) => path)).toEqual([tenantUrl, workspaceUrl('synthetic-tenant'), workspaceUrl('synthetic-tenant')])
  fireEvent.click(picker); const option = await screen.findByRole('option', { name: workspace.displayName }); fireEvent.pointerDown(option); fireEvent.click(option)
  await screen.findByRole('table'); await waitFor(() => expect(functionCalls()).toHaveLength(1))
})
