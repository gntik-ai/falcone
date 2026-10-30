import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession, readProtectedRouteIntent, subscribeConsoleSessionInvalidated } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { firstPage, historyPath, executionId } from './parity/pages/console-flow-history-page.manifest'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { isMigratedRoute } from '../src/shell/navigation'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const calls = () => requests.mock.mock.calls
function setup(variant = 'success', roles = ['superadmin']) {
  const initial = login(roles)
  const fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let count = 0
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(),
    [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${historyPath}`]: () => ++count === 1 && variant !== 'success' || variant === 'repeat' || variant === 'rejected'
      ? Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) : Response.json(firstPage),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({ code: 'REFRESH_REJECTED' }, { status: 401 }) : Response.json(fresh),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
  })
  return { initial, fresh }
}
function open(basename?: string) { return render(<MemoryRouter basename={basename} initialEntries={[`${basename ?? ''}/console/flows/f1/runs`]}><App /></MemoryRouter>) }

test.each(['superadmin', 'tenant_viewer', 'workspace_viewer'])('the history route has no role gate for %s, and resolves under /next', async (role) => {
  setup('success', [role])
  open('/next'); await screen.findByTitle(executionId)
  expect(calls().filter(([url]) => url === historyPath)).toHaveLength(1)
  expect(pendingConsoleRoutes.find(({ path }) => path === 'flows')?.migrated).not.toBe(true)
  expect(isMigratedRoute('/console/flows/f1/runs')).toBe(true)
  expect(isMigratedRoute('/console/flows/f1/runs/e1')).toBe(false)
})

test.each(['ok', 'rejected', 'repeat'])('401 %s refreshes once with the correct guard behavior', async (variant) => {
  const { initial, fresh } = setup(variant)
  let invalidations = 0
  const unsubscribe = subscribeConsoleSessionInvalidated(() => invalidations++)
  try {
    open()
    if (variant === 'ok') await screen.findByTitle(executionId)
    else if (variant === 'rejected') {
      await screen.findByRole('heading', { name: 'Accede a In Falcone Console' })
      expect(readProtectedRouteIntent()).toBe('/console/flows/f1/runs')
      expect(readConsoleShellSession()).toBeNull()
      expect(invalidations).toBe(1)
    } else {
      await screen.findByRole('heading', { name: 'No se pudieron cargar las ejecuciones' })
      expect(readConsoleShellSession()?.tokenSet?.accessToken).toBe(fresh.tokenSet?.accessToken)
      expect(invalidations).toBe(0)
      expect(screen.queryByRole('heading', { name: 'Accede a In Falcone Console' })).toBeNull()
    }
    const get = calls().filter(([url]) => url === historyPath)
    expect(get).toHaveLength(variant === 'rejected' ? 1 : 2)
    expect(new Headers(get[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
    if (get[1]) expect(new Headers(get[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
    const refresh = calls().filter(([url]) => String(url).endsWith('/refresh'))
    expect(refresh).toHaveLength(1)
    expect(refresh[0][1]?.method).toBe('POST')
    expect(JSON.parse(String(refresh[0][1]?.body))).toEqual({ refreshToken: initial.tokenSet?.refreshToken })
    expect(calls().filter(([url]) => url === tenantUrl)).toHaveLength(1)
    expect(calls().filter(([url]) => url === workspaceUrl('synthetic-tenant'))).toHaveLength(1)
  } finally { unsubscribe() }
})

// Exercise the actual lazy route through navigate(), including its transient loading boundary.
function TriggerArrival() {
  const navigate = useNavigate()
  return <><button onClick={() => navigate('/console/flows/f1/runs', { state: { flowTrigger: { flowId: 'f1', scheduleId: 'synthetic-schedule' } } })}>Open triggered history</button><App /></>
}
test('navigate arrival preserves the trigger state without a synchronous suspension error', async () => {
  setup(); render(<MemoryRouter initialEntries={['/console/profile']}><TriggerArrival /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Open triggered history' }))
  await waitFor(() => expect(screen.getByTestId('flow-trigger-success')).toHaveTextContent('synthetic-schedule'))
  await screen.findByTitle(executionId)
})

test('workspace retry recovers the shell bootstrap and waits for a picker before listing executions', async () => {
  setup()
  const workspace = buildWorkspaceCollectionFixture().items[0]
  let loads = 0
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(),
    [`GET ${workspaceUrl('synthetic-tenant')}`]: () => ++loads === 1
      ? Response.json({}, { status: 500 })
      : Response.json({ items: [workspace, { ...workspace, workspaceId: 'synthetic-other', displayName: 'Other workspace' }], page: { after: null } }),
    [`GET ${historyPath}`]: firstPage,
  })
  open()
  const pageTitle = await screen.findByRole('heading', { name: 'No se pudieron cargar las áreas de trabajo' })
  const panel = pageTitle.closest('section')!
  fireEvent.click(within(panel).getByRole('button', { name: 'Reintentar' }))
  const picker = await screen.findByRole('combobox', { name: 'Seleccionar área de trabajo' })
  expect(calls().filter(([url]) => url === historyPath)).toHaveLength(0)
  fireEvent.click(picker)
  const item = await screen.findByRole('option', { name: 'Synthetic Workspace' })
  fireEvent.pointerDown(item); fireEvent.click(item)
  await screen.findByTitle(executionId)
  expect(calls().filter(([url]) => url === historyPath)).toHaveLength(1)
  expect(loads).toBe(2)
})
