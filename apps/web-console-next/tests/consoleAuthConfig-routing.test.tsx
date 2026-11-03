import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { config, configPath } from './parity/pages/console-auth-config-page.manifest'
import es from '../src/locales/es/pages.console-auth-config-page.json'
import common from '../src/locales/es/common.json'
import i18n from '../src/i18n'
const navigation = common.navigation as Record<string, string>

let requests: ReturnType<typeof strictFetch>
beforeEach(async () => { vi.stubGlobal('PointerEvent', MouseEvent); await i18n.changeLanguage('es') })
vi.setConfig({ testTimeout: 20000 })
afterEach(() => requests?.verify())
const timeout = { timeout: 5000 }
function Probe() {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}</output><button onClick={() => navigate('/console/auth-config')}>Navigate auth config</button></>
}
function open(route = '/console/auth-config') { return render(<MemoryRouter basename="/next" initialEntries={[`/next${route}`]}><App /><Probe /></MemoryRouter>) }
function setup(variant = 'success', role = 'superadmin') {
  const initial = login([role]), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let attempt = 0
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${configPath}`]: () => ++attempt === 1 && variant !== 'success' ? Response.json({}, { status: 401 }) : Response.json(config),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({}, { status: 401 }) : Response.json(fresh),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
  }); return { initial, fresh }
}
const pageCalls = () => requests.mock.mock.calls.filter(([path]) => String(path).includes('/auth-config'))
const ready = () => screen.findByRole('group', { name: es.methodsTitle }, timeout)

test('the route is migrated', () => { expect(isMigratedRoute('/console/auth-config')).toBe(true) })

test.each(['superadmin', 'tenant_viewer', 'workspace_viewer'])('route has no role guard for %s', async (role) => {
  setup('success', role); open(); await ready()
  expect(pageCalls().map(([path]) => path)).toEqual([configPath])
  expect(screen.getByRole('heading', { name: es.title, level: 1 })).toBeVisible()
})

test('401 refreshes once and replays once with the new token under the basename', async () => {
  const { initial, fresh } = setup('refresh-ok'); open(); await ready()
  const calls = requests.mock.mock.calls, reads = calls.filter(([path]) => path === configPath), refresh = calls.filter(([path]) => String(path).endsWith('/refresh'))
  expect(reads).toHaveLength(2); expect(refresh).toHaveLength(1)
  expect(new Headers(reads[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
  expect(new Headers(reads[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
})

test('a rejected refresh redirects to login without replay and stores the basename-inclusive intent', async () => {
  setup('rejected'); open(); await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, timeout)
  expect(requests.mock.mock.calls.filter(([path]) => path === configPath)).toHaveLength(1)
  expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
  expect(screen.getByTestId('location')).toHaveTextContent(consoleAuthConfig.loginPath)
  expect(readProtectedRouteIntent()).toBe('/next/console/auth-config')
})

test.each(['link', 'navigate'])('%s loads the lazy chunk in-router', async (mode) => {
  setup(); open('/console/overview'); await screen.findByTestId('console-tenant-inventory-summary', {}, timeout)
  const link = screen.getByRole('link', { name: navigation['auth-config'] }); expect(link).toHaveAttribute('href', '/next/console/auth-config')
  if (mode === 'link') expect(fireEvent.click(link)).toBe(false)
  else fireEvent.click(screen.getByRole('button', { name: 'Navigate auth config' }))
  await ready(); expect(screen.getByTestId('location')).toHaveTextContent('/console/auth-config')
  expect(within(screen.getByTestId('console-auth-config-page')).getByRole('heading', { name: es.title, level: 1 })).toBeVisible()
})

test('a save inside the routed app sends one PUT with only the changed keys', async () => {
  setup()
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), [`GET ${configPath}`]: config,
    [`PUT ${configPath}`]: { ...config, verifyEmail: true }, 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture() })
  open(); await ready()
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(es.methods.verifyEmail.label) }))
  fireEvent.click(screen.getByRole('button', { name: es.save }))
  await screen.findByRole('region', { name: es.announcementRegion }, timeout)
  const puts = requests.mock.mock.calls.filter(([, init]) => init?.method === 'PUT')
  expect(puts).toHaveLength(1); expect(JSON.parse(String(puts[0][1]?.body))).toEqual({ verifyEmail: true })
})
