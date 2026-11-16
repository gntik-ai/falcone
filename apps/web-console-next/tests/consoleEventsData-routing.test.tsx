import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { topicsPath, topics } from './parity/pages/console-events-data-page.manifest'
import es from '../src/locales/es/pages.console-events-data-page.json'
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
  return <><output data-testid="location">{location.pathname}</output><button onClick={() => navigate('/console/events/data')}>Navigate events</button></>
}
function open(route = '/console/events/data') { return render(<MemoryRouter basename="/next" initialEntries={[`/next${route}`]}><App /><Probe /></MemoryRouter>) }
function setup(variant = 'success', role = 'superadmin', routes: Record<string, unknown> = {}) {
  const initial = login([role]), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let attempt = 0
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${topicsPath}`]: () => ++attempt === 1 && variant !== 'success' ? Response.json({}, { status: 401 }) : Response.json(topics),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({}, { status: 401 }) : Response.json(fresh),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
    ...routes,
  }); return { initial, fresh }
}
const eventCalls = () => requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/events'))

test('the route is migrated', () => { expect(isMigratedRoute('/console/events/data')).toBe(true) })

test.each(['superadmin', 'tenant_viewer', 'workspace_viewer'])('route has no role guard for %s', async (role) => {
  setup('success', role); open(); await screen.findByRole('table', {}, timeout)
  expect(screen.queryByRole('textbox', { name: es.newTopic }) !== null).toBe(role === 'superadmin')
  expect(eventCalls().map(([path]) => path)).toEqual([topicsPath])
})

test('401 refreshes once and replays once with the new token under the basename', async () => {
  const { initial, fresh } = setup('refresh-ok'); open(); await screen.findByRole('table', {}, timeout)
  const calls = requests.mock.mock.calls, events = calls.filter(([path]) => path === topicsPath), refresh = calls.filter(([path]) => String(path).endsWith('/refresh'))
  expect(events).toHaveLength(2); expect(refresh).toHaveLength(1)
  expect(new Headers(events[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
  expect(new Headers(events[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
  expect(screen.getByTestId('location')).toHaveTextContent('/console/events/data')
})

test('rejected refresh redirects without replay and stores the basename-inclusive intent', async () => {
  setup('rejected'); open(); await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, timeout)
  expect(requests.mock.mock.calls.filter(([path]) => path === topicsPath)).toHaveLength(1)
  expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
  expect(screen.getByTestId('location')).toHaveTextContent(consoleAuthConfig.loginPath)
  expect(readProtectedRouteIntent()).toBe('/next/console/events/data')
})

test.each(['link', 'navigate'])('%s loads the lazy chunk in-router', async (mode) => {
  setup(); open('/console/overview'); await screen.findByTestId('console-tenant-inventory-summary', {}, timeout)
  const link = screen.getByRole('link', { name: navigation['events-data'] }); expect(link).toHaveAttribute('href', '/next/console/events/data')
  if (mode === 'link') expect(fireEvent.click(link)).toBe(false)
  else fireEvent.click(screen.getByRole('button', { name: 'Navigate events' }))
  await screen.findByRole('table', {}, timeout); expect(screen.getByTestId('location')).toHaveTextContent('/console/events/data')
  expect(screen.getByRole('heading', { name: es.title, level: 1 })).toBeVisible()
})

