import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { invalidateConsoleShellSession, readConsoleShellSession, readProtectedRouteIntent, setConsoleSessionRetryUnauthorizedHandler } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { designerNavigation } from '../src/pages/consoleFlows/api'
import { ConsoleContextProvider, useConsoleContext } from '../src/shell/context'
import { SessionProvider } from '../src/shell/session'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { firstPage, historyPath, executionId } from './parity/pages/console-flow-history-page.manifest'
import { flowRows, flowsPath, triggerPath } from './parity/pages/console-flows-page.manifest'
import es from '../src/locales/es/pages.console-flows-page.json'
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const routeWait = { timeout: 5000 }
const calls = () => requests.mock.mock.calls
function setup(roles = ['superadmin'], variant = 'success', action = 'GET') {
  const initial = login(roles), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let attempts = 0
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${flowsPath}`]: () => action === 'GET' && (variant === 'repeat' || ++attempts === 1) && variant !== 'success' ? Response.json({}, { status: 401 }) : Response.json(flowRows),
    [`POST ${flowsPath}`]: () => action === 'POST' && (variant === 'repeat' || ++attempts === 1) && variant !== 'success' ? Response.json({}, { status: 401 }) : Response.json({ flowId: 'created/1' }),
    [`POST ${triggerPath}`]: () => action === 'RUN' ? Response.json({ code: 'UNAUTHENTICATED', message: 'Missing tenant identity' }, { status: 401 }) : Response.json({ status: 'triggered', scheduleId: 'synthetic-schedule' }), [`GET ${historyPath}`]: firstPage,
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({}, { status: 401 }) : Response.json(fresh),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
  }); return { initial, fresh }
}
function LocationProbe() { return <output data-testid="flows-location">{useLocation().pathname}</output> }
function open(basename = '') { return render(<MemoryRouter basename={basename || undefined} initialEntries={[`${basename}/console/flows`]}><App /><LocationProbe /></MemoryRouter>) }
async function ready() { await screen.findByTitle(flowRows.items[0].name, {}, routeWait) }

test.each(['superadmin', 'tenant_viewer', 'workspace_viewer'])('flows has no role gate for %s under /next', async (role) => {
  setup([role]); open('/next'); await ready()
  expect(isMigratedRoute('/console/flows')).toBe(true); expect(isMigratedRoute('/console/flows/f1')).toBe(true)
  expect(calls().filter(([url]) => url === flowsPath)).toHaveLength(1)
  if (role !== 'superadmin') expect(screen.queryByLabelText(es.newName)).toBeNull()
})

test('run-now navigates in-router and the migrated history displays its schedule id', async () => {
  setup(); const assign = vi.spyOn(designerNavigation, 'assign'); open('/next'); await ready()
  fireEvent.click(screen.getByRole('button', { name: 'Ejecutar ahora Synthetic published flow' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: es.run }))
  await waitFor(() => expect(screen.getByTestId('flow-trigger-success')).toHaveTextContent('synthetic-schedule'), routeWait)
  await screen.findByTitle(executionId, {}, routeWait)
  expect(calls().filter(([url]) => url === triggerPath)).toHaveLength(1)
  expect(calls().find(([url]) => url === triggerPath)?.[1]?.method).toBe('POST')
  expect(assign).not.toHaveBeenCalled()
})

test('history stays in-router while designer is a root-relative legacy anchor', async () => {
  setup(); open('/next'); await ready()
  const designer = screen.getByRole('link', { name: 'Abrir diseñador para Synthetic published flow' })
  expect(designer).toHaveAttribute('href', '/console/flows/f1')
  // A normal browser activation is not intercepted by React Router.
  let intercepted: boolean | undefined
  window.addEventListener('click', (event) => {
    intercepted = event.defaultPrevented
    // Observe the router first, then stop the document load jsdom cannot perform.
    event.preventDefault()
  }, { once: true })
  designer.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  expect(intercepted).toBe(false)
  const history = screen.getByRole('link', { name: 'Ver historial de ejecuciones para Synthetic published flow' })
  expect(history).toHaveAttribute('href', '/next/console/flows/f1/runs')
  expect(fireEvent.click(history)).toBe(false); await screen.findByTitle(executionId, {}, routeWait)
})

test.each(['GET', 'POST'])('%s 401 refreshes exactly once and replays with the new token', async (method) => {
  const { initial, fresh } = setup(['superadmin'], 'ok', method)
  const assign = vi.spyOn(designerNavigation, 'assign').mockImplementation(() => {})
  open(); await ready()
  if (method === 'POST') { fireEvent.change(screen.getByLabelText(es.newName), { target: { value: '  Trimmed  ' } }); fireEvent.click(screen.getByRole('button', { name: es.create })); await waitFor(() => expect(assign).toHaveBeenCalledWith('/console/flows/created%2F1')) }
  const action = calls().filter(([url, init]) => url === flowsPath && init?.method === method)
  expect(action).toHaveLength(2)
  expect(new Headers(action[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
  expect(new Headers(action[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
  if (method === 'POST') for (const [, init] of action) expect(JSON.parse(String(init?.body))).toEqual({ name: 'Trimmed' })
  const refresh = calls().filter(([url]) => String(url).endsWith('/refresh'))
  expect(refresh).toHaveLength(1); expect(refresh[0][1]?.method).toBe('POST')
  expect(JSON.parse(String(refresh[0][1]?.body))).toEqual({ refreshToken: initial.tokenSet?.refreshToken })
})

test.each(['GET', 'POST'])('%s rejected refresh has no replay and redirects with flows intent', async (method) => {
  setup(['superadmin'], 'rejected', method); const assign = vi.spyOn(designerNavigation, 'assign').mockImplementation(() => {})
  open()
  if (method === 'POST') { await ready(); fireEvent.change(screen.getByLabelText(es.newName), { target: { value: 'Keep' } }); fireEvent.click(screen.getByRole('button', { name: es.create })) }
  await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, routeWait)
  expect(readProtectedRouteIntent()).toBe('/console/flows'); expect(readConsoleShellSession()).toBeNull()
  expect(calls().filter(([url, init]) => url === flowsPath && init?.method === method)).toHaveLength(1)
  expect(calls().filter(([url]) => String(url).endsWith('/refresh'))).toHaveLength(1)
  expect(assign).not.toHaveBeenCalled()
})

test('workspace retry clears the error and fetches workspaces once, without tenants or flows', async () => {
  login(); let attempts = 0; const workspace = buildWorkspaceCollectionFixture().items[0]
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: () => ++attempts === 1 ? Response.json({}, { status: 500 }) : Response.json({ items: [workspace, { ...workspace, workspaceId: 'synthetic-other', displayName: 'Other workspace' }] }) })
  open(); const heading = await screen.findByRole('heading', { name: es.workspaceError }, routeWait)
  fireEvent.click(within(heading.closest('section')!).getByRole('button', { name: es.retry }))
  await screen.findByRole('combobox', { name: es.workspaceLabel }, routeWait)
  expect(screen.queryByRole('heading', { name: es.workspaceError })).toBeNull()
  expect(calls().filter(([url]) => url === tenantUrl)).toHaveLength(1); expect(attempts).toBe(2)
  expect(calls().filter(([url]) => url === flowsPath)).toHaveLength(0)
})

function ContextProbe() {
  const context = useConsoleContext()
  return <><output data-testid="context">{JSON.stringify({ loading: context.loading, error: context.error, workspaces: context.workspaces })}</output><button onClick={() => void context.reloadWorkspaces?.()}>Reload workspaces</button></>
}
test('the provider exposes optional workspace retry and clears its error while the request is pending', async () => {
  const session = login(); let attempts = 0; let complete!: (response: Response) => void
  requests = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: () => ++attempts === 1 ? Response.json({}, { status: 500 }) : new Promise<Response>((resolve) => { complete = resolve }) })
  render(<MemoryRouter><SessionProvider value={session}><ConsoleContextProvider><ContextProbe /></ConsoleContextProvider></SessionProvider></MemoryRouter>)
  await waitFor(() => expect(screen.getByTestId('context')).toHaveTextContent('"status":500'))
  fireEvent.click(screen.getByRole('button', { name: 'Reload workspaces' }))
  await waitFor(() => expect(screen.getByTestId('context')).toHaveTextContent('"loading":true,"error":null'))
  complete(Response.json(buildWorkspaceCollectionFixture()))
  await waitFor(() => expect(screen.getByTestId('context')).toHaveTextContent('"loading":false,"error":null'))
  expect(attempts).toBe(2); expect(calls().filter(([url]) => url === tenantUrl)).toHaveLength(1)
})

test.each(['GET', 'POST', 'RUN'])('%s repeated endpoint 401 keeps the flows route and session after exactly one refresh', async (action) => {
  const { initial, fresh } = setup(['superadmin'], 'repeat', action)
  const retryUnauthorizedHandler = vi.fn(invalidateConsoleShellSession)
  setConsoleSessionRetryUnauthorizedHandler(retryUnauthorizedHandler)
  const assign = vi.spyOn(designerNavigation, 'assign').mockImplementation(() => {})
  open()
  if (action !== 'GET') {
    await ready()
    if (action === 'POST') {
      fireEvent.change(screen.getByLabelText(es.newName), { target: { value: 'Keep' } })
      fireEvent.click(screen.getByRole('button', { name: es.create }))
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Ejecutar ahora Synthetic published flow' }))
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: es.run }))
    }
  }
  const path = action === 'RUN' ? triggerPath : flowsPath
  const method = action === 'GET' ? 'GET' : 'POST'
  await waitFor(() => expect(calls().filter(([url, init]) => url === path && init?.method === method)).toHaveLength(2), routeWait)
  expect(retryUnauthorizedHandler).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByTestId('console-flows-page')).toHaveTextContent(es.errors['401']))
  expect(screen.getByTestId('flows-location')).toHaveTextContent(/^\/console\/flows$/)
  expect(screen.queryByRole('heading', { name: 'Accede a In Falcone Console' })).toBeNull()
  expect(readConsoleShellSession()?.tokenSet?.accessToken).toBe(fresh.tokenSet?.accessToken)
  const requests = calls().filter(([url, init]) => url === path && init?.method === method)
  expect(requests).toHaveLength(2)
  expect(new Headers(requests[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
  expect(new Headers(requests[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
  expect(calls().filter(([url]) => String(url).endsWith('/refresh'))).toHaveLength(1)
  expect(assign).not.toHaveBeenCalled()
})
