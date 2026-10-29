import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { appRoutes } from '../src/router'
import FixtureRoutes from '../src/shell/fixtures/FixtureRoutes'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { overviewTenant, overviewWorkspace, quotasTenant, quotasWorkspace } from './parity/pages/console-quotas-page.manifest'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const metrics = '/v1/metrics/tenants/synthetic-tenant/quotas'
const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
const children = appRoutes.find((route) => route.path === '/console')!.children!
function setup(extra: Parameters<typeof strictFetch>[0] = {}) {
  login(['superadmin'])
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${metrics}`]: quotasTenant, 'GET /v1/metrics/tenants/synthetic-tenant/overview': overviewTenant,
    'GET /v1/metrics/workspaces/synthetic-workspace/quotas': quotasWorkspace, 'GET /v1/metrics/workspaces/synthetic-workspace/overview': overviewWorkspace,
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(), ...extra })
}
function open(path = '/next/console/quotas') { return render(<MemoryRouter basename="/next" initialEntries={[path]}><App /></MemoryRouter>) }
const fixture = { path: '__fixture/*', element: <FixtureRoutes /> }

test.each(['link', 'navigate'])('the fixture %s reaches the lazy quotas page inside the shell', async (method) => {
  setup(); children.push(fixture)
  try {
    open('/next/console/__fixture/quotas-link')
    if (method === 'link') fireEvent.click(await screen.findByRole('link', { name: 'Enlace diferido' }))
    else fireEvent.click(await screen.findByRole('button', { name: 'Navegar diferido' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Cuotas' })).toBeVisible()
    await screen.findAllByRole('table')
    expect(isMigratedRoute('/console/quotas')).toBe(true)
    expect(requests.mock.mock.calls.filter(([path]) => path === metrics)).toHaveLength(1)
  } finally { cleanup(); children.splice(children.indexOf(fixture), 1) }
})

test.each(['direct', 'link', 'navigate'])('rollback of the branch and flag leaves %s pending with no reachable PUT', async (method) => {
  setup()
  const quotas = children.find((route) => route.path === 'quotas')!
  const flag = pendingConsoleRoutes.find((route) => route.path === 'quotas')!
  const element = quotas.element, migrated = flag.migrated
  // Removing the quotas branch yields the same unguarded pending element as database.
  quotas.element = children.find((route) => route.path === 'database')!.element
  flag.migrated = false
  children.push(fixture)
  try {
    open(method === 'direct' ? '/next/console/quotas' : '/next/console/__fixture/quotas-link')
    if (method === 'link') fireEvent.click(await screen.findByRole('link', { name: 'Enlace diferido' }))
    if (method === 'navigate') fireEvent.click(await screen.findByRole('button', { name: 'Navegar diferido' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Página pendiente' })).toBeVisible()
    expect(isMigratedRoute('/console/quotas')).toBe(false)
    expect(screen.getAllByRole('link', { name: 'Cuotas' }).every((link) => link.getAttribute('href') === '/console/quotas')).toBe(true)
    expect(screen.queryByRole('button', { name: /ajustar cuota/i })).not.toBeInTheDocument()
    expect(requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/metrics/') || String(path).startsWith('/v1/plans/'))).toHaveLength(0)
  } finally { cleanup(); quotas.element = element; flag.migrated = migrated; children.splice(children.indexOf(fixture), 1) }
})

test.each([false, true])('posture 401 refresh rejected=%s preserves shell authorization behavior', async (rejected) => {
  let count = 0
  setup({ [`GET ${metrics}`]: () => ++count === 1 ? Response.json({ code: 'HTTP_401', message: 'synthetic-error' }, { status: 401 }) : Response.json(quotasTenant),
    [`POST ${refresh}`]: () => rejected ? Response.json({ code: 'HTTP_401' }, { status: 401 }) : Response.json(buildConsoleRefreshSessionFixture()),
  })
  open()
  if (rejected) {
    await waitFor(() => expect(readProtectedRouteIntent()).toBe('/next/console/quotas'))
    expect(await screen.findByRole('heading', { name: 'Accede a In Falcone Console' })).toBeVisible()
    expect(count).toBe(1)
  } else { await screen.findAllByRole('table'); expect(count).toBe(2) }
  const calls = requests.mock.mock.calls.filter(([path]) => path === refresh)
  expect(calls).toHaveLength(1)
  expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ refreshToken: 'synthetic-refresh-token' })
})
