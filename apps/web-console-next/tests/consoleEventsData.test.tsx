import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import ConsoleEventsDataPage from '../src/pages/consoleEventsData'
import { topics, createdTopics, messages } from './parity/pages/console-events-data-page.manifest'
import { login, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-events-data-page.json'
import en from '../src/locales/en/pages.console-events-data-page.json'
const context = vi.hoisted(() => ({ value: {} as Record<string, unknown>, roles: ['superadmin'] }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => getConsolePermissions(context.roles) }))
const list = '/v1/events/workspaces/ws-1/topics', publish = `${list}/synthetic-orders/publish`, consume = `${list}/synthetic-orders/messages?maxMessages=10`
let requests: ReturnType<typeof strictFetch>
const setup = (routes: Record<string, unknown> = {}) => { requests = strictFetch({ [`GET ${list}`]: topics, ...routes }) }
const open = () => render(<StrictMode><MemoryRouter><ConsoleEventsDataPage /></MemoryRouter></StrictMode>)
const calls = () => requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path), body: init?.body ? JSON.parse(String(init.body)) : undefined }))
const ready = () => screen.findByRole('table', { name: es.listLegend })
const pick = (name = 'synthetic-orders') => fireEvent.click(screen.getByRole('radio', { name }))
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const type = (name: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
const jsonLabel = es.messageJson.replace('{example}', '{ "value": { ... } }')
const failure = (status: number) => () => Response.json({ status, message: 'synthetic-error', requestId: 'req_synthetic_events' }, { status })
const polite = () => Array.from(document.querySelectorAll('[aria-live="polite"]')).map((node) => node.textContent).join('|')
async function expectSuccess(title: string, copy = es) {
  await waitFor(() => {
    expect(screen.getByRole('region', { name: copy.notifications })).toHaveTextContent(title)
    expect(document.querySelector('[data-live-announcer="polite"]')).toHaveTextContent(title)
  })
}
beforeEach(async () => {
  await i18n.changeLanguage('es'); login(); context.roles = ['superadmin']
  context.value = { activeTenantId: 't1', activeWorkspaceId: 'ws-1', loading: false, error: null, workspaces: [{ workspaceId: 'ws-1', displayName: 'Workspace one' }], selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn() }
})
afterEach(() => requests?.verify())
test.each(['es', 'en'] as const)('renders every topic, partitions and polled JSON metadata in %s', async (locale) => {
  await i18n.changeLanguage(locale); const copy = locale === 'es' ? es : en
  setup({ [`GET ${consume}`]: messages }); open()
  const table = await screen.findByRole('table', { name: copy.listLegend })
  expect(screen.getByRole('heading', { name: copy.listTitle.replace('{count}', '3') })).toBeVisible()
  for (const topic of topics.items) {
    const row = within(table).getByText(topic.topic).closest('tr')!
    if (topic.partitions != null) expect(row).toHaveTextContent(String(topic.partitions))
    else expect(within(row).getAllByRole('cell').at(-1)?.textContent).toBe('')
  }
  expect(screen.getAllByRole('radio')).toHaveLength(3)
  pick(); click(copy.consume)
  await screen.findByRole('tree', { name: copy.messageValue.replace('{index}', '1') })
  expect(screen.getByText(copy.messageKey.replace('{key}', 'synthetic-key'))).toBeVisible()
  for (const message of messages.items) {
    expect(screen.getByText(copy.messagePartition.replace('{partition}', String(message.partition)))).toBeVisible()
    expect(screen.getByText(copy.messageOffset.replace('{offset}', message.offset))).toBeVisible()
    expect(screen.getByText(message.timestamp)).toBeVisible()
  }
  expect(calls()).toEqual([{ method: 'GET', path: list, body: undefined }, { method: 'GET', path: consume, body: undefined }])
  expect(screen.queryByRole('navigation', { name: /pagin/i })).toBeNull()
  await expectSuccess(copy.consumed.replace('{count}', '2').replace('{topic}', 'synthetic-orders'), copy)
})
test('create trims its name, posts once, reloads, selects and announces the topic', async () => {
  let attempt = 0
  setup({ [`GET ${list}`]: () => Response.json(++attempt === 1 ? topics : createdTopics), [`POST ${list}`]: { topic: 'synthetic-new' } }); open(); await ready()
  expect(screen.getByRole('button', { name: es.create })).toBeDisabled()
  type(es.newTopic, ' synthetic-new '); click(es.create)
  await waitFor(() => expect(screen.getByRole('radio', { name: 'synthetic-new' })).toBeChecked())
  expect(calls()).toEqual([{ method: 'GET', path: list, body: undefined }, { method: 'POST', path: list, body: { name: 'synthetic-new' } }, { method: 'GET', path: list, body: undefined }])
  await expectSuccess(es.created.replace('{topic}', 'synthetic-new'))
})
test.each(['{"foo":1}', 'null', '5', '[1]', '{"key":"k","value":{}}'])('syntax-only publish sends %s unchanged', async (value) => {
  setup({ [`POST ${publish}`]: { offset: 4 } }); open(); await ready(); pick(); type(jsonLabel, value); click(es.publish)
  await waitFor(() => expect(calls()).toHaveLength(2))
  expect(calls()[1]).toEqual({ method: 'POST', path: publish, body: JSON.parse(value) })
  await expectSuccess(es.published.replace('{topic}', 'synthetic-orders'))
})
test('invalid JSON is announced and marked invalid without a request', async () => {
  setup(); open(); await ready(); pick(); type(jsonLabel, '{'); click(es.publish)
  expect(within(screen.getByTestId('console-events-data-page')).getByText(es.invalidJson)).toBeVisible(); expect(screen.getByRole('textbox', { name: jsonLabel })).toHaveAttribute('aria-invalid', 'true'); expect(calls()).toHaveLength(1)
})
test.each(['publish', 'consume', 'create'] as const)('%s locks operations but allows changing the selection', async (op) => {
  let release!: (response: Response) => void
  let loads = 0
  setup({ [`GET ${list}`]: () => Response.json(++loads === 1 || op !== 'create' ? topics : createdTopics), [`${op === 'consume' ? 'GET' : 'POST'} ${op === 'consume' ? consume : op === 'publish' ? publish : list}`]: () => new Promise<Response>((resolve) => { release = resolve }) })
  open(); await ready(); pick(); type(es.newTopic, 'synthetic-new'); click(es[op])
  await waitFor(() => expect(release).toBeTypeOf('function'))
  pick('synthetic-audit'); expect(screen.getByRole('radio', { name: 'synthetic-audit' })).toBeChecked()
  expect(document.getElementById('events-selected')).toBeVisible()
  expect(screen.getByRole('textbox', { name: jsonLabel })).toBeDisabled(); expect(screen.getByRole('textbox', { name: es.newTopic })).toBeDisabled()
  for (const button of ['events-create-button', 'events-publish-button', 'events-consume-button']) expect(document.getElementById(button)).toBeDisabled()
  expect(calls()).toHaveLength(2)
  expect(calls()[1]).toEqual({ method: op === 'consume' ? 'GET' : 'POST', path: op === 'consume' ? consume : op === 'publish' ? publish : list, body: op === 'consume' ? undefined : op === 'publish' ? { value: {} } : { name: 'synthetic-new' } })
  await act(async () => release(Response.json(op === 'consume' ? messages : op === 'create' ? { topic: 'synthetic-new' } : {})))
  await expectSuccess(op === 'create' ? es.created.replace('{topic}', 'synthetic-new') : op === 'publish' ? es.published.replace('{topic}', 'synthetic-orders') : es.consumed.replace('{count}', '2').replace('{topic}', 'synthetic-orders'))
  expect(screen.getByRole('radio', { name: op === 'create' ? 'synthetic-new' : 'synthetic-audit' })).toBeChecked()
  expect(calls()).toHaveLength(op === 'create' ? 3 : 2)
})
test.each(['tenant_developer', 'tenant_viewer', 'workspace_viewer', 'platform_operator', 'platform_team'])('%s sees read-only copy and can consume without write panels', async (role) => {
  login([role]); setup({ [`GET ${consume}`]: { items: [], status: 'empty' } }); open(); await ready()
  expect(screen.getByText(es.readDescription)).toBeVisible(); expect(screen.getAllByText(es.readBadge).length).toBeGreaterThan(0); expect(screen.getByText(es.readNote)).toBeVisible()
  expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByRole('button', { name: es.create })).toBeNull()
  pick(); click(es.consume); await screen.findByText(es.noMessages)
})
test.each(['superadmin', 'platform_admin', 'tenant_owner', 'tenant_admin', 'workspace_owner', 'workspace_admin'])('%s sees the legacy structural-write controls', async (role) => {
  login([role]); setup(); open(); await ready()
  expect(screen.getByText(es.description)).toBeVisible()
  expect(screen.getByText(es.writeBadge)).toBeVisible()
  expect(screen.getByRole('textbox', { name: es.newTopic })).toBeVisible()
  expect(screen.getByRole('textbox', { name: jsonLabel })).toBeVisible()
  expect(screen.queryByText(es.readNote)).toBeNull()
  expect(calls()).toEqual([{ method: 'GET', path: list, body: undefined }])
})
test('empty topics, before poll, empty poll and timeout preserve the legacy states', async () => {
  setup({ [`GET ${list}`]: { items: [] } }); const view = open(); await screen.findByText(es.empty); view.unmount()
  let count = 0; setup({ [`GET ${consume}`]: () => Response.json(++count === 1 ? { items: [], status: 'empty' } : { items: [], status: 'timeout', reason: 'assignment' }) }); open(); await ready()
  expect(screen.getByText(es.beforePoll)).toBeVisible(); pick(); click(es.consume); await screen.findByText(es.noMessages)
  click(es.consume); await screen.findByText(es.timeout); expect(screen.queryByText(es.noMessages)).toBeNull(); expect(screen.queryByText(es.beforePoll)).toBeNull()
})
test.each([403, 500, 0])('topic load %s renders the migration error state and retries once where available', async (status) => {
  let attempt = 0
  setup({ [`GET ${list}`]: () => ++attempt > 1 ? Response.json(topics) : status ? failure(status)() : Promise.reject(new TypeError('synthetic-network')) }); open()
  await screen.findByRole('heading', { name: status === 403 ? es.noAccess : status ? es.listError : es.networkError })
  expect(screen.queryByRole('table')).toBeNull()
  if (status === 403) { expect(screen.getByText('synthetic-error')).toBeVisible(); expect(screen.queryByRole('button', { name: es.retry })).toBeNull(); expect(screen.queryByRole('textbox')).toBeNull() }
  else { if (status) expect(screen.getByText('req_synthetic_events')).toBeVisible(); click(es.retry); await ready(); expect(calls()).toHaveLength(2) }
})
test.each(['publish', 'consume'] as const)('%s 404 replaces both panels and back reloads and focuses the table', async (op) => {
  setup({ [`${op === 'publish' ? 'POST' : 'GET'} ${op === 'publish' ? publish : consume}`]: failure(404) }); open(); await ready(); pick(); click(es[op]); await screen.findByRole('heading', { name: es.notFound })
  expect(screen.queryByRole('textbox', { name: jsonLabel })).toBeNull(); expect(screen.queryByRole('button', { name: es.consume })).toBeNull()
  click(es.back); const table = await ready(); await waitFor(() => expect(table).toHaveFocus())
  expect(screen.getByText(es.noneSelected)).toBeVisible(); expect(calls().filter((call) => call.path === list)).toHaveLength(2)
})
test.each(['publish', 'create'] as const)('%s 403 keeps the input and shows the backend reason inline', async (op) => {
  setup({ [`POST ${op === 'publish' ? publish : list}`]: failure(403) }); open(); await ready(); pick(); type(es.newTopic, 'keep'); type(jsonLabel, '{"keep":true}'); click(es[op])
  await screen.findByText('synthetic-error'); expect(screen.getByText(es.errorTitle)).toBeVisible(); expect(screen.getByRole('textbox', { name: es.newTopic })).toHaveValue('keep'); expect(screen.getByRole('textbox', { name: jsonLabel })).toHaveValue('{"keep":true}')
})
test('network failure clears previously polled messages and provides retry', async () => {
  let attempt = 0; setup({ [`GET ${consume}`]: () => ++attempt === 1 ? Response.json(messages) : Promise.reject(new TypeError('synthetic-network')) }); open(); await ready(); pick(); click(es.consume)
  await screen.findByRole('tree', { name: es.messageValue.replace('{index}', '1') }); click(es.consume)
  await screen.findByRole('heading', { name: es.networkError }); expect(screen.queryByRole('tree')).toBeNull(); click(es.retry); await ready(); expect(screen.getByText(es.beforePoll)).toBeVisible()
})
test.each(['loading', 'error', 'picker', 'create', 'denied'])('workspace gate %s sends no events requests', async (state) => {
  context.value.activeWorkspaceId = null
  if (state === 'loading') context.value.loading = true
  if (state === 'error') context.value.error = { status: 500, message: 'synthetic-workspace-error' }
  if (state === 'create' || state === 'denied') context.value.workspaces = []
  if (state === 'denied') context.roles = ['tenant_viewer']
  setup(); open()
  if (state === 'loading') expect(screen.getByRole('heading', { name: es.workspaceLoading })).toBeVisible()
  if (state === 'error') { click(es.retry); expect(context.value.reloadWorkspaces).toHaveBeenCalledTimes(1) }
  if (state === 'picker') { fireEvent.click(screen.getByRole('combobox', { name: es.workspaceLabel })); const option = await screen.findByRole('option', { name: 'Workspace one' }); fireEvent.pointerDown(option); fireEvent.click(option); expect(context.value.selectWorkspace).toHaveBeenCalledWith('ws-1') }
  if (state === 'create') expect(screen.getByRole('link', { name: es.createWorkspace })).toHaveAttribute('href', '/console/workspaces')
  if (state === 'denied') expect(screen.getByText(es.workspaceDenied)).toBeVisible()
  expect(calls()).toEqual([])
})
test('workspace and topic segments are encoded and JSON remains unchanged', async () => {
  context.value.activeWorkspaceId = 'ws /1'; const base = '/v1/events/workspaces/ws%20%2F1/topics'
  requests = strictFetch({ [`GET ${base}`]: { items: [{ topic: 'a/b c' }] }, [`POST ${base}/a%2Fb%20c/publish`]: {} })
  open(); await ready(); pick('a/b c'); click(es.publish); await waitFor(() => expect(calls()).toHaveLength(2)); expect(calls()[1].body).toEqual({ value: {} })
})
test.each(['es', 'en'] as const)('loading exposes a named region, announces once and disables actions until selection in %s', async (locale) => {
  await i18n.changeLanguage(locale); const copy = locale === 'es' ? es : en
  let release!: (response: Response) => void
  setup({ [`GET ${list}`]: () => new Promise<Response>((resolve) => { release = resolve }) }); open()
  await waitFor(() => expect(release).toBeTypeOf('function'))
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.getByRole('region', { name: copy.loading })).toHaveAttribute('aria-busy', 'true')
  await waitFor(() => expect(polite()).toContain(copy.loading))
  expect(calls()).toHaveLength(1)
  await act(async () => release(Response.json(topics))); await screen.findByRole('table', { name: copy.listLegend })
  expect(screen.queryByRole('region', { name: copy.loading })).toBeNull()
  expect(screen.getByRole('button', { name: copy.publish })).toBeDisabled(); expect(screen.getByRole('button', { name: copy.consume })).toBeDisabled()
})
test('an operation 500 keeps earlier messages, announces the failure and preserves the typed JSON', async () => {
  setup({ [`GET ${consume}`]: messages, [`POST ${publish}`]: failure(500) }); open(); await ready(); pick(); click(es.consume)
  await screen.findByRole('tree', { name: es.messageValue.replace('{index}', '1') }); type(jsonLabel, '{"keep":true}'); click(es.publish)
  await screen.findByText('synthetic-error'); expect(screen.getByText(es.errorTitle)).toBeVisible()
  expect(screen.getByRole('tree', { name: es.messageValue.replace('{index}', '1') })).toBeVisible(); expect(screen.getByRole('textbox', { name: jsonLabel })).toHaveValue('{"keep":true}')
  await waitFor(() => expect(document.querySelector('[data-live-announcer="assertive"]')).toHaveTextContent(es.errorTitle))
})
