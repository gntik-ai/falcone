import { StrictMode, useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConsoleFlowHistoryPage from '../src/pages/consoleFlowHistory'
import { emptyFilters, executionsPath, listExecutions } from '../src/pages/consoleFlowHistory/api'
import { firstPage, lastPage, executionId, historyPath, historyResponse } from './parity/pages/console-flow-history-page.manifest'
import { login, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-flow-history-page.json'
import en from '../src/locales/en/pages.console-flow-history-page.json'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installSession } from './browser-session.mjs'

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
let canCreate = true
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => getConsolePermissions([canCreate ? 'superadmin' : 'tenant_viewer']) }))
let requests: ReturnType<typeof strictFetch>
const path = (filters = {}, token?: string) => executionsPath('synthetic-workspace', 'f1', { ...emptyFilters, ...filters }, token)
const calls = () => requests.mock.mock.calls.map(([url, options]) => ({ url: String(url), method: options?.method, body: options?.body }))
function setup(routes: Record<string, unknown> = {}) {
  requests = strictFetch({ [`GET ${historyPath}`]: firstPage, ...routes })
}
function open(state?: unknown, route = '/console/flows/f1/runs') {
  return render(<StrictMode><MemoryRouter initialEntries={[{ pathname: route, state }]}><Routes>
    <Route path="/console/flows/:flowId/runs" element={<ConsoleFlowHistoryPage />} />
    <Route path="/missing" element={<ConsoleFlowHistoryPage />} />
  </Routes></MemoryRouter></StrictMode>)
}
async function ready(id = executionId) { await screen.findByTitle(id) }
async function select(label: string, option: string) {
  const control = screen.getByRole('combobox', { name: label })
  control.focus(); fireEvent.click(control)
  const item = await screen.findByRole('option', { name: option })
  fireEvent.pointerDown(item); fireEvent.click(item)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
beforeEach(() => {
  login(); canCreate = true
  context.value = { activeWorkspaceId: 'synthetic-workspace', loading: false, error: null, workspaces: [], selectWorkspace: vi.fn(), reloadTenants: vi.fn() }
})
afterEach(() => requests?.verify())

test.each(['es', 'en'] as const)('renders the legacy fields, links and localized controls in %s without sample copy', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open(); await ready()
  const copy = locale === 'es' ? es : en
  expect(calls()).toEqual([{ url: historyPath, method: 'GET', body: undefined }])
  expect(screen.getByRole('heading', { name: copy.title })).toBeVisible()
  const table = screen.getByRole('table', { name: copy.caption })
  const row = within(table).getAllByRole('row')[1]
  expect(row).toHaveTextContent(executionId.slice(0, 32) + '…')
  expect(row).toHaveTextContent(copy.status.Completed)
  expect(row).toHaveTextContent(copy.trigger.manual)
  expect(row).toHaveTextContent('2026-01-01T00:00:00Z')
  expect(within(row).getByRole('link', { name: i18n.t('openExecution', { ns: 'pages.console-flow-history-page', id: executionId }) })).toHaveAttribute('href', `/console/flows/f1/runs/${encodeURIComponent(executionId)}`)
  for (const name of [copy.version, copy.statusLabel, copy.triggerLabel, copy.startedAfter, copy.startedBefore]) expect(screen.getByLabelText(name)).toBeVisible()
  expect(screen.getByText(locale === 'es' ? '1 ejecuciones' : '1 executions')).toBeVisible()
  expect(document.documentElement.lang).toBe(locale)
})

test('keeps a single query per filter change, omits empties and resets the token stack for all five filters', async () => {
  const filters = { flowVersion: '2', status: 'Failed', triggerType: 'webhook', startedAfter: '2026-01-01T00:00', startedBefore: '2026-01-02T00:00' }
  const routes: Record<string, unknown> = { [`GET ${path({}, 'tok-2')}`]: lastPage }
  const current: Record<string, string> = {}
  for (const [key, value] of Object.entries(filters)) { current[key] = value; routes[`GET ${path(current)}`] = firstPage }
  setup(routes); open(); await ready()
  fireEvent.click(screen.getByRole('button', { name: es.next })); await ready('synthetic-run-page2')
  fireEvent.change(screen.getByLabelText(es.version), { target: { value: '2' } }); await ready()
  await select(es.statusLabel, es.status.Failed)
  await select(es.triggerLabel, es.trigger.webhook)
  fireEvent.change(screen.getByLabelText(es.startedAfter), { target: { value: filters.startedAfter } })
  await waitFor(() => expect(calls()).toHaveLength(6))
  fireEvent.change(screen.getByLabelText(es.startedBefore), { target: { value: filters.startedBefore } })
  await waitFor(() => expect(calls()).toHaveLength(7))
  expect(calls().slice(2).every(({ url }) => !url.includes('page%5Bafter%5D'))).toBe(true)
  expect(calls().at(-1)?.url).toBe(historyPath + '?status=Failed&query=flowVersion+%3D+%272%27+AND+triggerType+%3D+%27webhook%27+AND+StartTime+%3E%3D+%272026-01-01T00%3A00%27+AND+StartTime+%3C%3D+%272026-01-02T00%3A00%27')
  expect(screen.getByRole('button', { name: es.previous })).toHaveAttribute('aria-disabled', 'true')
})

test('pages forward and backward, retains the pressed control and refreshes the current token', async () => {
  setup({ [`GET ${path({}, 'tok-2')}`]: lastPage }); open({ flowTrigger: { flowId: 'f1', scheduleId: 'synthetic-schedule' } }); await ready()
  const previous = screen.getByRole('button', { name: es.previous }), next = screen.getByRole('button', { name: es.next })
  expect(previous).toHaveAttribute('aria-disabled', 'true')
  next.focus(); fireEvent.click(next); await ready('synthetic-run-page2')
  expect(next).toHaveFocus(); expect(next).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(screen.getByRole('button', { name: es.refresh })); await waitFor(() => expect(calls()).toHaveLength(3))
  expect(calls().slice(-2).map(({ url }) => url)).toEqual([path({}, 'tok-2'), path({}, 'tok-2')])
  await waitFor(() => expect(previous).not.toHaveAttribute('aria-disabled', 'true'))
  previous.focus(); fireEvent.click(previous); await ready()
  expect(previous).toHaveFocus(); expect(previous).toHaveAttribute('aria-disabled', 'true')
  expect(calls().at(-1)?.url).toBe(historyPath)
})

test('shows the trigger notice only for this flow and preserves its schedule id', async () => {
  setup(); const view = open({ flowTrigger: { flowId: 'another', scheduleId: 'hidden-schedule' } }); await ready()
  expect(screen.queryByTestId('flow-trigger-success')).toBeNull(); view.unmount()
  open({ flowTrigger: { flowId: 'f1', scheduleId: 'synthetic-schedule' } }); await ready()
  expect(screen.getByTestId('flow-trigger-success')).toHaveAttribute('role', 'status')
  expect(screen.getByTestId('flow-trigger-success')).toHaveTextContent('synthetic-schedule')
})

test('first-run opens the designer, filtered empty clears filters and restores the first query', async () => {
  setup({ [`GET ${historyPath}`]: { items: [] }, [`GET ${path({ status: 'Failed' })}`]: { items: [] } }); open()
  expect(await screen.findByRole('link', { name: es.designer })).toHaveAttribute('href', '/console/flows/f1')
  await select(es.statusLabel, es.status.Failed)
  expect(screen.getByRole('heading', { name: es.noResults })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: es.clear }))
  expect(await screen.findByRole('link', { name: es.designer })).toBeVisible()
  expect(calls().map(({ url }) => url)).toEqual([historyPath, path({ status: 'Failed' }), historyPath])
  expect(screen.getByLabelText(es.version)).toHaveFocus()
})

test.each(['403', '404', '500', 'network'])('renders the %s state with safe copy, diagnostics and recovery', async (variant) => {
  const response = historyResponse(variant)
  setup({ [`GET ${historyPath}`]: () => { if (response.network) throw new TypeError('Do not render this raw network error'); return Response.json(response.body, { status: response.status }) } }); open()
  const title = variant === '403' ? es.noAccess : variant === '404' ? es.notFound : es.errorTitle
  expect(await screen.findByRole('heading', { name: title })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.queryByText('Do not render this raw network error')).toBeNull()
  expect(screen.queryByText('Request access')).toBeNull()
  if (variant === '403') expect(screen.getByText('synthetic-backend-reason')).toBeVisible()
  if (variant === '404') expect(screen.getByRole('link', { name: es.back })).toHaveAttribute('href', '/console/flows')
  if (variant === '500') { expect(screen.getByText('req_synthetic_history')).toBeVisible(); expect(screen.getByText('500')).toBeVisible() }
})

test.each(['500', 'network'])('keeps old rows while loading, drops stale rows on %s and retries the exact token', async (variant) => {
  let resolve!: (response: Response) => void
  let reject!: (cause: unknown) => void
  let count = 0
  setup({ [`GET ${path({}, 'tok-2')}`]: () => ++count === 1 ? new Promise<Response>((release, fail) => { resolve = release; reject = fail }) : Response.json(lastPage) })
  open(); await ready(); fireEvent.click(screen.getByRole('button', { name: es.next }))
  await waitFor(() => expect(calls()).toHaveLength(2))
  expect(screen.getByTitle(executionId)).toBeVisible()
  expect(screen.getByText(es.loadingCount)).toBeVisible()
  for (const label of [es.previous, es.next]) expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-disabled', 'true')
  await act(async () => {
    if (variant === 'network') reject(new TypeError('Synthetic network failure'))
    else resolve(Response.json({ requestId: 'req_synthetic_history' }, { status: 500 }))
  })
  expect(screen.queryByTitle(executionId)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: es.retry })); await ready('synthetic-run-page2')
  expect(calls().slice(-2).map(({ url }) => url)).toEqual([path({}, 'tok-2'), path({}, 'tok-2')])
})

test('labels the initial skeleton and ignores an obsolete filter response', async () => {
  let resolve!: (response: Response) => void
  setup({ [`GET ${historyPath}`]: () => new Promise<Response>((release) => { resolve = release }), [`GET ${path({ flowVersion: '2' })}`]: lastPage })
  open(); expect(screen.getByRole('status', { name: es.loading })).toBeVisible()
  await waitFor(() => expect(calls()).toHaveLength(1))
  fireEvent.change(screen.getByLabelText(es.version), { target: { value: '2' } }); await ready('synthetic-run-page2')
  await act(async () => resolve(Response.json(firstPage)))
  expect(screen.queryByTitle(executionId)).toBeNull()
})

test.each(['loading', 'error', 'picker', 'create', 'denied'])('keeps the workspace %s state actionable without executions requests', async (state) => {
  setup(); context.value.activeWorkspaceId = null
  context.value.loading = state === 'loading'
  context.value.error = state === 'error' ? { status: 500 } : null
  context.value.workspaces = state === 'picker' ? [{ workspaceId: 'synthetic-workspace', displayName: 'Synthetic Workspace' }] : []
  canCreate = state !== 'denied'
  open()
  if (state === 'loading') expect(screen.getByRole('status', { name: es.workspaceLoading })).toBeVisible()
  if (state === 'error') { fireEvent.click(screen.getByRole('button', { name: es.retry })); expect(context.value.reloadTenants).toHaveBeenCalledTimes(1) }
  if (state === 'picker') { await select(es.workspaceLabel, 'Synthetic Workspace'); expect(context.value.selectWorkspace).toHaveBeenCalledWith('synthetic-workspace') }
  if (state === 'create') expect(screen.getByRole('link', { name: es.createWorkspace })).toHaveAttribute('href', '/console/workspaces')
  if (state === 'denied') { expect(screen.getByText(es.workspaceDenied)).toBeVisible(); expect(screen.queryByRole('link', { name: es.createWorkspace })).toBeNull() }
  expect(calls()).toHaveLength(0)
})

test('activating a workspace makes exactly one executions request', async () => {
  setup()
  function Activation() {
    const [activeWorkspaceId, selectWorkspace] = useState<string | null>(null)
    context.value = { ...context.value, activeWorkspaceId, selectWorkspace, workspaces: [{ workspaceId: 'synthetic-workspace', displayName: 'Synthetic Workspace' }] }
    return <ConsoleFlowHistoryPage />
  }
  render(<MemoryRouter initialEntries={['/console/flows/f1/runs']}><Routes><Route path="/console/flows/:flowId/runs" element={<Activation />} /></Routes></MemoryRouter>)
  expect(calls()).toHaveLength(0); await select(es.workspaceLabel, 'Synthetic Workspace'); await ready()
  expect(calls()).toHaveLength(1)
})

test('defensively blocks a missing flow id before fetching', () => {
  setup(); open(undefined, '/missing')
  expect(screen.getByRole('heading', { name: es.blocked })).toBeVisible()
  expect(screen.getByText(es.missingFlow)).toBeVisible(); expect(calls()).toHaveLength(0)
})

test('encodes identifiers and legacy quotes exactly without converting datetimes', async () => {
  const url = executionsPath('synthetic/ws', 'f/1', { flowVersion: "x'", status: '', triggerType: '', startedAfter: '2026-01-01T01:23', startedBefore: '' }, 'a+/=')
  setup({ [`GET ${url}`]: firstPage })
  await listExecutions('synthetic/ws', 'f/1', { ...emptyFilters, flowVersion: "x'", startedAfter: '2026-01-01T01:23' }, 'a+/=')
  expect(calls()).toEqual([{ url: "/v1/flows/workspaces/synthetic%2Fws/flows/f%2F1/executions?query=flowVersion+%3D+%27x%27%27+AND+StartTime+%3E%3D+%272026-01-01T01%3A23%27&page%5Bafter%5D=a%2B%2F%3D", method: 'GET', body: undefined }])
})

test('CSP bootstrap fixtures accept only the on-load executions GET and reject all other requests', async () => {
  setup(); let handle!: (route: unknown) => Promise<void>
  const unmatched = await installSession({ addInitScript: vi.fn(), route: vi.fn((_pattern, callback) => { handle = callback }) })
  for (const [method, path] of [['GET', historyPath], ['GET', historyPath + '?status=Failed'], ['POST', historyPath], ['GET', historyPath + '/run']]) {
    const route = { request: () => ({ method: () => method, url: () => 'http://localhost' + path, postDataJSON: () => undefined }), fulfill: vi.fn(), abort: vi.fn() }
    await handle(route)
    expect(route.fulfill).toHaveBeenCalledTimes(method === 'GET' && path === historyPath ? 1 : 0)
  }
  expect(unmatched).toEqual([`GET ${historyPath}?status=Failed`, `POST ${historyPath}`, `GET ${historyPath}/run`])
})

test('Flow C: legacy and migrated clients emit identical queries for the same fixtures', async () => {
  const legacy = await import('../../web-console/src/services/flowsMonitoringApi')
  const cases = [
    {}, { status: 'Failed' }, { flowVersion: '2' }, { triggerType: 'platform_event' },
    { startedAfter: '2026-01-01T08:15', startedBefore: '2026-01-02T09:20' },
    { status: 'Completed', flowVersion: '2', triggerType: 'webhook', startedAfter: '2026-01-01T08:15', startedBefore: '2026-01-02T09:20' },
  ]
  for (const filters of cases) for (const pageToken of [undefined, 'opaque+token/=']) {
    setup({ [`GET ${path(filters, pageToken)}`]: firstPage })
    const old = await legacy.listExecutions('synthetic-workspace', { flowId: 'f1', ...filters, pageToken })
    const next = await listExecutions('synthetic-workspace', 'f1', { ...emptyFilters, ...filters }, pageToken)
    expect(next).toEqual(old)
    expect(calls()).toHaveLength(2)
    expect(calls()[0]).toEqual(calls()[1])
    requests.verify()
  }
})

test('legacy status aliases, missing statuses and unknown backend values do not become raw translation keys', async () => {
  setup({ [`GET ${historyPath}`]: { items: ['Cancelled', null, 'NewBackendStatus'].map((status, index) => ({ executionId: 'synthetic-run-' + index, workflowId: 'synthetic-workflow', status })) } })
  open(); await ready('synthetic-run-0')
  expect(screen.getByRole('table')).toHaveTextContent(es.status.Cancelled)
  expect(screen.getByRole('table')).toHaveTextContent(es.status.unknown)
  expect(screen.getByRole('table')).toHaveTextContent('NewBackendStatus')
})

test('walks a multi-page cursor stack back through the previous tokens', async () => {
  setup({
    [`GET ${path({}, 'tok-2')}`]: { ...lastPage, nextPageToken: 'tok-3' },
    [`GET ${path({}, 'tok-3')}`]: { items: [{ ...firstPage.items[0], executionId: 'synthetic-run-page3' }] },
  })
  open(); await ready()
  fireEvent.click(screen.getByRole('button', { name: es.next })); await ready('synthetic-run-page2')
  fireEvent.click(screen.getByRole('button', { name: es.next })); await ready('synthetic-run-page3')
  fireEvent.click(screen.getByRole('button', { name: es.previous })); await ready('synthetic-run-page2')
  fireEvent.click(screen.getByRole('button', { name: es.previous })); await ready()
  expect(calls().map(({ url }) => url)).toEqual([historyPath, path({}, 'tok-2'), path({}, 'tok-3'), path({}, 'tok-2'), historyPath])
})
