import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { App } from '../src/App'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { functionRows, functionsPath } from './parity/pages/console-function-registry-page.manifest'
import es from '../src/locales/es/pages.console-function-registry-page.json'
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const timeout = { timeout: 5000 }
function Probe() {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}</output><button onClick={() => navigate('/console/functions-registry')}>Navigate registry</button></>
}
function open(route = '/console/functions-registry') { return render(<MemoryRouter basename="/next" initialEntries={[`/next${route}`]}><App /><Probe /></MemoryRouter>) }
function setup(variant = 'success', role = 'superadmin') {
  const initial = login([role]), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let attempt = 0
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${functionsPath}`]: () => ++attempt === 1 && variant !== 'success' ? Response.json({}, { status: 401 }) : Response.json(functionRows),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({}, { status: 401 }) : Response.json(fresh),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
  }); return { initial, fresh }
}
test.each(['superadmin', 'tenant_viewer', 'workspace_viewer'])('route has no role guard for %s', async (role) => {
  setup('success', role); open(); await screen.findByRole('table', {}, timeout)
  expect(screen.getByRole('textbox', { name: es.name })).toBeVisible()
  expect(requests.mock.mock.calls.filter(([path]) => path === functionsPath)).toHaveLength(1)
})
test('401 refreshes once and replays once with the new token under the basename', async () => {
  const { initial, fresh } = setup('refresh-ok'); open(); await screen.findByRole('table', {}, timeout)
  const calls = requests.mock.mock.calls, functions = calls.filter(([path]) => path === functionsPath), refresh = calls.filter(([path]) => String(path).endsWith('/refresh'))
  expect(functions).toHaveLength(2); expect(refresh).toHaveLength(1)
  expect(new Headers(functions[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
  expect(new Headers(functions[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
  expect(refresh[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ refreshToken: initial.tokenSet?.refreshToken }) })
  expect(screen.getByTestId('location')).toHaveTextContent('/console/functions-registry')
})
test('rejected refresh redirects without replay and stores the basename-inclusive intent', async () => {
  setup('rejected'); open(); await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, timeout)
  expect(requests.mock.mock.calls.filter(([path]) => path === functionsPath)).toHaveLength(1)
  expect(requests.mock.mock.calls.filter(([path]) => String(path).endsWith('/refresh'))).toHaveLength(1)
  expect(screen.getByTestId('location')).toHaveTextContent(consoleAuthConfig.loginPath)
  expect(readProtectedRouteIntent()).toBe('/next/console/functions-registry')
})
test.each(['link', 'navigate'])('%s loads the lazy chunk in-router', async (mode) => {
  setup(); open('/console/overview'); await screen.findByTestId('console-tenant-inventory-summary', {}, timeout)
  const link = screen.getByRole('link', { name: es.title }); expect(link).toHaveAttribute('href', '/next/console/functions-registry')
  if (mode === 'link') expect(fireEvent.click(link)).toBe(false)
  else fireEvent.click(screen.getByRole('button', { name: 'Navigate registry' }))
  await screen.findByRole('table', {}, timeout); expect(screen.getByTestId('location')).toHaveTextContent('/console/functions-registry')
})
test('workspace error retry reloads only shell workspaces and the picker activates a workspace', async () => {
  login(); let attempt = 0; const workspace = buildWorkspaceCollectionFixture().items[0]
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: () => ++attempt === 1 ? Response.json({}, { status: 500 }) : Response.json({ items: [workspace, { ...workspace, workspaceId: 'synthetic-other', displayName: 'Other workspace' }] }), [`GET ${functionsPath}`]: functionRows })
  open(); const heading = await screen.findByRole('heading', { name: es.workspaceError }, timeout)
  fireEvent.click(within(heading.closest('section')!).getByRole('button', { name: es.retry }))
  const picker = await screen.findByRole('combobox', { name: es.workspaceLabel }, timeout)
  expect(requests.mock.mock.calls.map(([path]) => path)).toEqual([tenantUrl, workspaceUrl('synthetic-tenant'), workspaceUrl('synthetic-tenant')])
  fireEvent.click(picker); const option = await screen.findByRole('option', { name: workspace.displayName }); fireEvent.pointerDown(option); fireEvent.click(option)
  await screen.findByRole('table'); await waitFor(() => expect(requests.mock.mock.calls.filter(([path]) => path === functionsPath)).toHaveLength(1))
})
