import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession, readProtectedRouteIntent, subscribeConsoleSessionInvalidated } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { eventsPath, executionPath, executionVariants, flowPath, flowRecord, runRoute } from './parity/pages/console-flow-run-page.manifest'
import { animations, sseResponse } from './consoleFlowRun-support'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { isMigratedRoute } from '../src/shell/navigation'

let requests: ReturnType<typeof strictFetch>
beforeEach(() => animations())
afterEach(() => requests?.verify())
const calls = () => requests.mock.mock.calls
const routeWait = { timeout: 5000 }
// Variants: ok (401 once, then the run), rejected (every 401, refresh rejected), repeat (every 401, refresh ok).
function setup(variant = 'success', roles = ['superadmin'], status: keyof typeof executionVariants = 'completed', events: () => Response = () => sseResponse()) {
  const initial = login(roles)
  const fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let count = 0
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(),
    [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${flowPath}`]: flowRecord,
    [`GET ${executionPath}`]: () => ++count === 1 && variant !== 'success' || variant === 'repeat' || variant === 'rejected'
      ? Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) : Response.json(executionVariants[status]),
    [`GET ${eventsPath}`]: events,
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({ code: 'REFRESH_REJECTED' }, { status: 401 }) : Response.json(fresh),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
  })
  return { initial, fresh }
}
function open(basename?: string) { return render(<MemoryRouter basename={basename} initialEntries={[`${basename ?? ''}${runRoute}`]}><App /></MemoryRouter>) }
const runs = () => calls().filter(([url]) => url === executionPath)

test.each(['superadmin', 'tenant_viewer', 'workspace_viewer'])('the run route has no role gate for %s, renders the page (not the pending one) and resolves under /next', async (role) => {
  setup('success', [role])
  open('/next'); await screen.findByTestId('console-flow-run-page', {}, routeWait)
  expect(screen.queryByRole('heading', { name: 'Página pendiente' })).toBeNull()
  expect(runs()).toHaveLength(1)
  expect(calls().filter(([url]) => url === eventsPath)).toHaveLength(0)
  expect(pendingConsoleRoutes.find(({ path }) => path === 'flows/:flowId/runs/:executionId')?.migrated).toBe(true)
})

test('isMigratedRoute is true for the run path and unchanged for its siblings', () => {
  expect(isMigratedRoute('/console/flows/f1/runs/e1')).toBe(true)
  expect(isMigratedRoute('/console/flows')).toBe(true)
  expect(isMigratedRoute('/console/flows/f1')).toBe(true)
  expect(isMigratedRoute('/console/flows/f1/runs')).toBe(true)
  expect(isMigratedRoute('/console/flows/f1/runs/e1/extra')).toBe(false)
})

test('the shell breadcrumb and the page both link back to the flow list and run history', async () => {
  setup(); open(); await screen.findByTestId('console-flow-run-page', {}, routeWait)
  expect(screen.getAllByRole('link', { name: 'Ejecuciones' }).every((link) => link.getAttribute('href') === '/console/flows/f1/runs')).toBe(true)
})

test('a running run streams through the router with the session bearer', async () => {
  const { initial } = setup('success', ['superadmin'], 'running')
  open(); await screen.findByTestId('console-flow-run-page', {}, routeWait)
  await waitFor(() => expect(calls().filter(([url]) => url === eventsPath)).toHaveLength(1))
  const [, init] = calls().find(([url]) => url === eventsPath)!
  expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
  for (const [url] of calls()) expect(String(url)).not.toMatch(/apikey/i)
})

test.each(['ok', 'rejected', 'repeat'])('401 %s on the execution request refreshes once and replays at most once', async (variant) => {
  const { initial, fresh } = setup(variant)
  let invalidations = 0
  const unsubscribe = subscribeConsoleSessionInvalidated(() => invalidations++)
  try {
    open()
    if (variant === 'ok') await screen.findByTestId('console-flow-run-page', {}, routeWait)
    else {
      // Refresh rejected, or the replay is rejected again: the shell ends the session and returns to login.
      await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, routeWait)
      expect(readProtectedRouteIntent()).toBe(runRoute)
      expect(readConsoleShellSession()).toBeNull()
      expect(invalidations).toBe(1)
    }
    expect(runs()).toHaveLength(variant === 'rejected' ? 1 : 2)
    expect(new Headers(runs()[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
    if (runs()[1]) expect(new Headers(runs()[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
    const refresh = calls().filter(([url]) => String(url).endsWith('/refresh'))
    expect(refresh).toHaveLength(1)
    expect(JSON.parse(String(refresh[0][1]?.body))).toEqual({ refreshToken: initial.tokenSet?.refreshToken })
    expect(calls().filter(([url]) => url === eventsPath)).toHaveLength(0)
  } finally { unsubscribe() }
})

test('a refresh rejected on the stream sends no replay, redirects to login with the run path and closes the stream', async () => {
  setup('rejected-stream', ['superadmin'], 'running', () => Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }))
  // Only the stream request fails; the refresh is rejected.
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${flowPath}`]: flowRecord, [`GET ${executionPath}`]: executionVariants.running,
    [`GET ${eventsPath}`]: () => Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => Response.json({ code: 'REFRESH_REJECTED' }, { status: 401 }),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
  })
  open()
  await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, routeWait)
  expect(readProtectedRouteIntent()).toBe(runRoute)
  expect(calls().filter(([url]) => url === eventsPath)).toHaveLength(1)
  expect(calls().filter(([url]) => String(url).endsWith('/refresh'))).toHaveLength(1)
  const [, init] = calls().find(([url]) => url === eventsPath)!
  expect((init?.signal as AbortSignal).aborted).toBe(true)
})
