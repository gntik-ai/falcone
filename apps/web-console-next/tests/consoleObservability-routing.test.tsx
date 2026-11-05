import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { appRoutes } from '../src/router'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { firstPage, overviewMixed, series24h, usageSnapshot } from './parity/pages/console-observability-page.manifest'

let requests: ReturnType<typeof strictFetch>
afterEach(() => { requests?.verify(); cleanup() })
const workspace = '/v1/metrics/workspaces/synthetic-workspace'
const reads = { [`GET ${workspace}/overview`]: overviewMixed, [`GET ${workspace}/usage`]: usageSnapshot,
  [`GET ${workspace}/series?metricKey=api_requests&window=24h`]: series24h, [`GET ${workspace}/audit-records?page%5Bsize%5D=50&sort=-eventTimestamp`]: firstPage }
const children = appRoutes.find((route) => route.path === '/console')!.children!
function setup(role = 'tenant_viewer', extra: Parameters<typeof strictFetch>[0] = {}, withReads = true) {
  login([role])
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(), ...(withReads ? reads : {}), ...extra })
}
function open(path = '/next/console/observability') { return render(<MemoryRouter basename="/next" initialEntries={[path]}><App /></MemoryRouter>) }

test('the migrated route renders inside the shell with the page reads', async () => {
  setup(); open()
  expect(await screen.findByRole('heading', { level: 1, name: 'Observabilidad' }, { timeout: 10000 })).toBeVisible()
  expect(await screen.findByRole('heading', { level: 3, name: 'Synthetic API Keys' })).toBeVisible()
  expect(isMigratedRoute('/console/observability')).toBe(true)
  expect(pendingConsoleRoutes.find((route) => route.path === 'observability')?.migrated).toBe(true)
})

test('the read-only landing at /console reaches the migrated page', async () => {
  setup(); open('/next/console')
  expect(await screen.findByRole('heading', { level: 3, name: 'Synthetic API Keys' }, { timeout: 10000 })).toBeVisible()
})

test.each(['direct', 'landing'])('rollback of the branch and flag leaves %s pending with no metrics or audit request', async (method) => {
  setup('tenant_viewer', {}, false)
  const page = children.find((route) => route.path === 'observability')!
  const flag = pendingConsoleRoutes.find((route) => route.path === 'observability')!
  const element = page.element, migrated = flag.migrated
  page.element = children.find((route) => route.path === 'database')!.element
  flag.migrated = false
  try {
    open(method === 'direct' ? '/next/console/observability' : '/next/console')
    expect(await screen.findByRole('heading', { level: 1, name: 'Página pendiente' }, { timeout: 10000 })).toBeVisible()
    expect(isMigratedRoute('/console/observability')).toBe(false)
    expect(requests.mock.mock.calls.filter(([path]) => String(path).startsWith('/v1/metrics/'))).toHaveLength(0)
  } finally { page.element = element; flag.migrated = migrated }
})

test.each([false, true])('metrics 401 with refresh rejected=%s keeps the shell authorization behaviour', async (rejected) => {
  let count = 0
  const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
  setup('tenant_viewer', { [`GET ${workspace}/overview`]: () => ++count === 1 ? Response.json({ code: 'HTTP_401', message: 'synthetic-error' }, { status: 401 }) : Response.json(overviewMixed),
    [`POST ${refresh}`]: () => rejected ? Response.json({ code: 'HTTP_401' }, { status: 401 }) : Response.json(buildConsoleRefreshSessionFixture()) })
  open()
  if (rejected) {
    await waitFor(() => expect(readProtectedRouteIntent()).toBe('/next/console/observability'))
    expect(await screen.findByRole('heading', { name: 'Accede a In Falcone Console' })).toBeVisible()
  } else expect(await screen.findByRole('heading', { level: 3, name: 'Synthetic API Keys' })).toBeVisible()
  expect(requests.mock.mock.calls.filter(([path]) => path === refresh)).toHaveLength(1)
})
