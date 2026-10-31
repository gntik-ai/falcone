import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession, readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { flowPath, flowRecord, taskTypesPath, taskTypes } from './parity/pages/console-flow-designer-page.manifest'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
beforeEach(() => { Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] }); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
function Probe() { return <output data-testid="designer-route">{useLocation().pathname}</output> }
function setup(variant = 'success', roles = ['superadmin']) {
  const initial = login(roles), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let attempts = 0
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), [`GET ${flowPath}`]: () => variant !== 'success' && ++attempts === 1 ? Response.json({}, { status: 401 }) : Response.json({ ...flowRecord, definition: {} }), [`GET ${taskTypesPath}`]: { items: taskTypes }, 'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({}, { status: 401 }) : Response.json(fresh), 'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture() })
  return { initial, fresh }
}
function open() { return render(<MemoryRouter basename="/next" initialEntries={['/next/console/flows/f1']}><App /><Probe /></MemoryRouter>) }
const options = { timeout: 10000 }

test('designer is the most-specific migrated route and lazy-loads below /next', async () => {
  setup(); open(); await screen.findByRole('heading', { name: 'Synthetic flow' }, options)
  expect(isMigratedRoute('/console/flows/f1')).toBe(true)
  expect(isMigratedRoute('/console/flows/f1/runs/unknown')).toBe(false)
  expect(pendingConsoleRoutes.find(({ path }) => path === 'flows/:flowId')?.migrated).toBe(true)
  expect(screen.getByTestId('console-flow-designer-page')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Ver historial de ejecuciones para Synthetic flow' })).toHaveAttribute('href', '/next/console/flows/f1/runs')
})

test.each(['tenant_viewer', 'workspace_viewer'])('designer has no save or publish role guard for %s', async (role) => {
  setup('success', [role]); open(); await screen.findByRole('heading', { name: 'Synthetic flow' }, options)
  expect(screen.getByTestId('save-draft-button')).toBeEnabled()
  expect(screen.getByTestId('publish-button')).toBeEnabled()
})

test('401 refresh-ok issues exactly one refresh and one replay using the new token', async () => {
  const { initial, fresh } = setup('ok'); open(); await screen.findByRole('heading', { name: 'Synthetic flow' }, options)
  const calls = requests.mock.mock.calls, flow = calls.filter(([url]) => url === flowPath)
  expect(flow).toHaveLength(2)
  expect(new Headers(flow[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
  expect(new Headers(flow[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
  const refresh = calls.filter(([url]) => String(url).endsWith('/refresh')); expect(refresh).toHaveLength(1)
  expect(JSON.parse(String(refresh[0][1]?.body))).toEqual({ refreshToken: initial.tokenSet?.refreshToken })
})

test('401 refresh-rejected makes no replay and redirects to login with the designer return path', async () => {
  setup('rejected'); open(); await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, options)
  expect(requests.mock.mock.calls.filter(([url]) => url === flowPath)).toHaveLength(1)
  expect(requests.mock.mock.calls.filter(([url]) => String(url).endsWith('/refresh'))).toHaveLength(1)
  expect(readConsoleShellSession()).toBeNull(); expect(readProtectedRouteIntent()).toBe('/next/console/flows/f1')
})
