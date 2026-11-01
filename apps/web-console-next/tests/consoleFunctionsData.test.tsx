import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import ConsoleFunctionsDataPage from '../src/pages/consoleFunctionsData'
import { actions2, actions3, actions60, activations3, activationsRefreshed, deployAccepted, invokeResult } from './parity/pages/console-functions-data-page.manifest'
import { login, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-functions-data-page.json'
import en from '../src/locales/en/pages.console-functions-data-page.json'

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown>, roles: ['superadmin'] }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => getConsolePermissions(context.roles) }))

const list = '/v1/functions/workspaces/ws-1/actions'
const deploy = '/v1/functions/actions'
const invokePath = '/v1/functions/actions/synthetic-function-2/invocations'
const activationsPath = '/v1/functions/actions/synthetic-function-2/activations'
const failure = (status: number, requestId: string) => () => Response.json({ status, code: `HTTP_${status}`, message: 'synthetic-error', requestId }, { status })
let requests: ReturnType<typeof strictFetch>
const calls = () => requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path), body: init?.body ? JSON.parse(String(init.body)) : undefined }))
const setup = (routes: Record<string, unknown> = {}) => { requests = strictFetch({ [`GET ${list}`]: actions2, ...routes }) }
const open = () => render(<StrictMode><MemoryRouter><ConsoleFunctionsDataPage /></MemoryRouter></StrictMode>)
const textbox = (label: string) => screen.getByRole('textbox', { name: label }) as HTMLTextAreaElement
const button = (name: string) => screen.getByRole('button', { name })
const ready = () => screen.findByRole('table', { name: es.listLegend })
const type = (label: string, value: string) => fireEvent.change(textbox(label), { target: { value } })
const radios = () => screen.getAllByRole('radio') as HTMLInputElement[]
const pick = (index: number) => fireEvent.click(radios()[index])
const polite = () => Array.from(document.querySelectorAll('[aria-live="polite"]')).map((node) => node.textContent).join('|')
const workspaceCopy = es

beforeEach(async () => {
  await i18n.changeLanguage('es'); login(); context.roles = ['superadmin']
  context.value = { activeTenantId: 't1', activeWorkspaceId: 'ws-1', loading: false, error: null, workspaces: [{ workspaceId: 'ws-1', displayName: 'Workspace one' }, { workspaceId: 'ws-2', displayName: 'Workspace two' }], selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn() }
})
afterEach(() => requests?.verify())

test.each(['es', 'en'] as const)('lists every function with one radio per row and the count in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open()
  const copy = locale === 'es' ? es : en
  const table = await screen.findByRole('table', { name: copy.listLegend })
  expect(screen.getByRole('heading', { name: copy.title })).toBeVisible()
  expect(screen.getByRole('heading', { name: copy.listTitle.replace('{count}', '2') })).toBeVisible()
  expect(screen.getByRole('group', { name: copy.listLegend })).toBeVisible()
  for (const fn of actions2.items) {
    const row = within(table).getByText(fn.actionName).closest('tr')!
    expect(row).toHaveTextContent(fn.execution.runtime); expect(row).toHaveTextContent(fn.resourceId)
    expect(within(row).getByRole('radio', { name: `${fn.actionName} (${fn.execution.runtime})` })).not.toBeChecked()
  }
  expect(radios()).toHaveLength(2)
  expect(screen.getByRole('link', { name: copy.adminLink })).toHaveAttribute('href', '/console/functions')
  expect(calls()).toEqual([{ method: 'GET', path: list, body: undefined }])
})

test('es renders no raw keys and none of the English copy', async () => {
  setup(); open(); await ready()
  const text = document.body.textContent ?? ''
  expect(text).not.toMatch(/pages\.console-functions-data-page|\b(listTitle|deployTitle|invokeTitle)\b/)
  for (const key of ['title', 'deployTitle', 'invokeTitle', 'resultTitle', 'activationsTitle', 'resultEmpty', 'activationsIdle', 'listLegend'] as const) {
    if (en[key] !== es[key]) expect(text).not.toMatch(new RegExp(`(^|[^\\p{L}])${en[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u'))
  }
  expect(text).not.toMatch(/\bNo results\b|\bLoading\b|\bSearch\b/)
})

test('60 functions render as 60 rows with no paging control', async () => {
  setup({ [`GET ${list}`]: actions60 }); open(); await ready()
  expect(radios()).toHaveLength(60)
  expect(screen.getByRole('heading', { name: es.listTitle.replace('{count}', '60') })).toBeVisible()
  expect(screen.queryByRole('navigation', { name: /pagin/i })).toBeNull()
})

test('selecting a row keeps exactly one checked radio, clears the output and announces politely', async () => {
  setup({ [`POST ${invokePath}`]: invokeResult, [`GET ${activationsPath}`]: activations3 }); open(); await ready()
  pick(1)
  expect(radios().filter((radio) => radio.checked)).toEqual([radios()[1]])
  expect(screen.getByText(es.selectedBadge.replace('{name}', 'synthetic-billing'))).toBeVisible()
  fireEvent.click(button(es.invoke)); await screen.findByText('synthetic-hello', { exact: false })
  fireEvent.click(button(es.viewActivations)); await screen.findByRole('table', { name: es.activationsLabel })
  pick(0)
  expect(radios().filter((radio) => radio.checked)).toEqual([radios()[0]])
  expect(screen.queryByText('synthetic-hello', { exact: false })).toBeNull()
  expect(screen.queryByRole('table', { name: es.activationsLabel })).toBeNull()
  expect(screen.getByText(es.resultEmpty)).toBeVisible(); expect(screen.getByText(es.activationsIdle)).toBeVisible()
  await waitFor(() => expect(polite()).toContain(es.selectedSummary.replace('{label}', 'synthetic-user-hook (nodejs:20)')))
})

const defaultSpec = { name: 'hello', runtime: 'nodejs', code: 'module.exports=async()=>({ok:true})' }
const defaultBody = {
  tenantId: 't1', workspaceId: 'ws-1', actionName: 'hello',
  source: { kind: 'inline_code', language: 'javascript', inlineCode: defaultSpec.code, entryFile: 'index.js' },
  execution: { runtime: 'nodejs:20', entrypoint: 'main', parameters: {}, environment: {}, limits: { timeoutSeconds: 60, memoryMb: 256 }, webAction: { enabled: false, requireAuthentication: true, rawHttpResponse: false } },
  activationPolicy: { logsAccess: 'workspace_developers', resultAccess: 'workspace_developers', rerunPolicy: 'manual_only', retentionHours: 168 },
}

test('the default deploy sends the literal legacy body, refetches once, selects the deployed function and announces', async () => {
  let count = 0
  setup({ [`GET ${list}`]: () => Response.json(++count === 1 ? actions2 : actions3), [`POST ${deploy}`]: deployAccepted }); open(); await ready()
  fireEvent.click(button(es.deploy))
  await waitFor(() => expect(radios()).toHaveLength(3))
  await waitFor(() => expect(radios()[2]).toBeChecked())
  expect(calls()).toEqual([{ method: 'GET', path: list, body: undefined }, { method: 'POST', path: deploy, body: defaultBody }, { method: 'GET', path: list, body: undefined }])
  expect(radios().filter((radio) => radio.checked)).toHaveLength(1)
  expect(document.body).toHaveTextContent(es.deployed); await waitFor(() => expect(polite()).toContain(es.deployed))
  expect(button(es.deploy)).toHaveFocus()
})

test('a structured deploy keeps source, execution and extra keys and forces tenant, workspace and action name', async () => {
  setup({ [`POST ${deploy}`]: deployAccepted, [`GET ${list}`]: actions2 }); open(); await ready()
  const source = { kind: 'inline_code', language: 'javascript', inlineCode: 'c2', entryFile: 'index.js' }, execution = { runtime: 'nodejs:20', entrypoint: 'main' }
  type(es.deploySpecLabel, JSON.stringify({ name: 'x', runtime: 'nodejs', code: 'c', main: 'm', entrypoint: 'e', tenantId: 'other', workspaceId: 'other', source, execution, extra: 1 }))
  fireEvent.click(button(es.deploy)); await waitFor(() => expect(calls().filter((call) => call.method === 'POST')).toHaveLength(1))
  expect(calls().find((call) => call.method === 'POST')?.body).toEqual({ source, execution, extra: 1, tenantId: 't1', workspaceId: 'ws-1', actionName: 'x' })
})

test.each([
  ['{"a":1}', { parameters: { a: 1 } }],
  ['5', { parameters: 5 }],
  ['{"parameters":{},"responseMode":"wait_for_result"}', { parameters: {}, responseMode: 'wait_for_result' }],
])('invoke input %s is sent as %j and the result renders in the JSON viewer', async (value, body) => {
  setup({ [`POST ${invokePath}`]: invokeResult }); open(); await ready(); pick(1)
  type(es.inputLabel, value); fireEvent.click(button(es.invoke))
  await screen.findByText('synthetic-hello', { exact: false })
  expect(calls().slice(1)).toEqual([{ method: 'POST', path: invokePath, body }])
  expect(screen.getByRole('tree', { name: es.resultLabel })).toBeVisible()
  expect(button(es.invoke)).toHaveFocus(); expect(document.body).toHaveTextContent(es.invoked)
  await waitFor(() => expect(polite()).toContain(es.invoked))
})

test('view activations lists the returned window with status and duration', async () => {
  setup({ [`GET ${activationsPath}`]: activations3 }); open(); await ready(); pick(1)
  fireEvent.click(button(es.viewActivations))
  const table = await screen.findByRole('table', { name: es.activationsLabel })
  expect(screen.getByRole('heading', { name: es.activationsTitle })).toBeVisible()
  for (const item of activations3.items) expect(within(table).getByText(item.activationId).closest('tr')).toHaveTextContent(item.status)
  expect(within(table).getByText('12 ms')).toBeVisible(); expect(within(table).getByText('340 ms')).toBeVisible()
  expect(calls()[1]).toEqual({ method: 'GET', path: activationsPath, body: undefined })
  expect(button(es.viewActivations)).toHaveFocus(); await waitFor(() => expect(polite()).toContain(es.activationsLoaded))
})

test('an empty activation window explains itself for the selected function', async () => {
  setup({ [`GET ${activationsPath}`]: { items: [] } }); open(); await ready(); pick(1)
  fireEvent.click(button(es.viewActivations))
  expect(await screen.findByText(es.activationsEmpty)).toBeVisible()
  expect(screen.getByText(es.activationsEmptyNamed.replace('{name}', 'synthetic-billing'))).toBeVisible()
})

test.each([
  ['not JSON', 'deploy', '{', `${es.specPrefix}: ${es.jsonInvalid}`],
  ['a non-object', 'deploy', '[1]', `${es.specPrefix}: ${es.jsonObjectExpected}`],
  ['no action name', 'deploy', '{"runtime":"nodejs"}', es.actionNameRequired],
  ['invalid input', 'invoke', '{', es.inputInvalid],
])('%s sends nothing and shows the exact message', async (_name, target, value, message) => {
  setup(); open(); await ready(); pick(1)
  const label = target === 'deploy' ? es.deploySpecLabel : es.inputLabel
  type(label, value); fireEvent.click(button(target === 'deploy' ? es.deploy : es.invoke))
  expect(await screen.findByText(message)).toBeVisible()
  const invalid = target === 'invoke' || message !== es.actionNameRequired
  if (invalid) expect(textbox(label)).toHaveAttribute('aria-invalid', 'true'); else expect(textbox(label)).not.toHaveAttribute('aria-invalid', 'true')
  expect(textbox(label)).toHaveValue(value); expect(calls()).toHaveLength(1)
})

test('invoke and activations need a selection', async () => {
  setup(); open(); await ready()
  fireEvent.click(button(es.invoke)); expect(await screen.findByText(es.selectToInvoke)).toBeVisible()
  fireEvent.click(button(es.viewActivations)); expect(await screen.findByText(es.selectForActivations)).toBeVisible()
  expect(calls()).toHaveLength(1)
})

test('formatting rewrites valid JSON and reports invalid JSON', async () => {
  setup(); open(); await ready()
  type(es.inputLabel, '{"a":1}'); fireEvent.click(screen.getAllByRole('button', { name: es.format })[1])
  expect(textbox(es.inputLabel)).toHaveValue('{\n  "a": 1\n}')
  fireEvent.click(screen.getAllByRole('button', { name: es.format })[0])
  expect(textbox(es.deploySpecLabel).value).toContain('\n  "name": "hello"')
  type(es.deploySpecLabel, '{'); fireEvent.click(screen.getAllByRole('button', { name: es.format })[0])
  expect(await screen.findByText(`${es.specPrefix}: ${es.jsonInvalid}`)).toBeVisible()
  expect(calls()).toHaveLength(1)
})

test('buttons and textareas are disabled with busy labels while an operation runs', async () => {
  let release!: (response: Response) => void
  setup({ [`POST ${invokePath}`]: () => new Promise<Response>((done) => { release = done }) }); open(); await ready(); pick(1)
  fireEvent.click(button(es.invoke))
  const busy = await screen.findByRole('button', { name: es.invoking }); expect(busy).toBeDisabled()
  for (const control of [button(es.deploy), button(es.viewActivations), ...screen.getAllByRole('button', { name: es.format }), textbox(es.deploySpecLabel), textbox(es.inputLabel)]) expect(control).toBeDisabled()
  await act(async () => release(Response.json(invokeResult)))
  expect(button(es.invoke)).toBeEnabled(); expect(textbox(es.inputLabel)).toBeEnabled()
})

test('a failed deploy keeps the spec, shows the request id and Reintentar resends the same POST', async () => {
  let attempt = 0
  setup({ [`POST ${deploy}`]: () => ++attempt === 1 ? failure(500, 'req_deploy_500')() : Response.json(deployAccepted), [`GET ${list}`]: actions3 }); open(); await ready()
  fireEvent.click(button(es.deploy))
  const panel = await screen.findByRole('heading', { name: es.deployError })
  expect(panel).toBeVisible(); expect(document.body).toHaveTextContent('req_deploy_500'); expect(document.body).toHaveTextContent('500')
  expect(textbox(es.deploySpecLabel)).toHaveValue('{"name":"hello","runtime":"nodejs","code":"module.exports=async()=>({ok:true})"}')
  expect(button(es.deploy)).toHaveFocus()
  fireEvent.click(button(es.retry))
  await waitFor(() => expect(screen.queryByRole('heading', { name: es.deployError })).toBeNull())
  const posts = calls().filter((call) => call.method === 'POST'); expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0])
})

test('a failed invoke keeps the input, shows the earlier result only as stale, and a retry replaces it', async () => {
  let attempt = 0
  setup({ [`POST ${invokePath}`]: () => ++attempt === 2 ? failure(500, 'req_invoke_500')() : Response.json(attempt === 1 ? invokeResult : { result: { fresh: true } }) }); open(); await ready(); pick(1)
  type(es.inputLabel, '{"a":1}'); fireEvent.click(button(es.invoke)); await screen.findByText('synthetic-hello', { exact: false })
  expect(screen.queryByText(es.resultStale)).toBeNull()
  fireEvent.click(button(es.invoke))
  expect(await screen.findByRole('heading', { name: es.invokeError })).toBeVisible()
  expect(screen.getByText(es.resultStale)).toBeVisible(); expect(screen.getByText(es.staleAt, { exact: false })).toBeVisible()
  expect(screen.getByText('synthetic-hello', { exact: false })).toBeVisible()
  expect(textbox(es.inputLabel)).toHaveValue('{"a":1}'); expect(button(es.invoke)).toHaveFocus()
  fireEvent.click(button(es.retry))
  await screen.findByText('true', { exact: false })
  expect(screen.queryByText(es.resultStale)).toBeNull(); expect(screen.queryByText('synthetic-hello', { exact: false })).toBeNull()
  expect(calls().filter((call) => call.method === 'POST').map((call) => call.body)).toEqual(Array(3).fill({ parameters: { a: 1 } }))
})

test('a failed retry returns focus to Reintentar', async () => {
  setup({ [`POST ${invokePath}`]: failure(500, 'req_invoke_500') }); open(); await ready(); pick(1)
  fireEvent.click(button(es.invoke)); fireEvent.click(await screen.findByRole('button', { name: es.retry }))
  await waitFor(() => expect(calls().filter((call) => call.method === 'POST')).toHaveLength(2))
  await waitFor(() => expect(button(es.retry)).toHaveFocus())
})

test('a network failure of invoke shows the panel without a status code', async () => {
  setup({ [`POST ${invokePath}`]: () => { throw new TypeError('network') } }); open(); await ready(); pick(1)
  fireEvent.click(button(es.invoke))
  expect(await screen.findByRole('heading', { name: es.invokeError })).toBeVisible(); expect(button(es.retry)).toBeVisible()
})

test('a failed activations reload keeps the earlier list under Lista anterior until the retry succeeds', async () => {
  let attempt = 0
  setup({ [`GET ${activationsPath}`]: () => ++attempt === 1 ? Response.json(activations3) : attempt === 2 ? failure(500, 'req_act_500')() : Response.json(activationsRefreshed) }); open(); await ready(); pick(1)
  type(es.inputLabel, '{"keep":true}'); type(es.deploySpecLabel, '{"name":"kept"}')
  fireEvent.click(button(es.viewActivations)); await screen.findByRole('table', { name: es.activationsLabel })
  fireEvent.click(button(es.viewActivations))
  expect(await screen.findByRole('heading', { name: es.activationsError })).toBeVisible()
  expect(screen.getByText(es.activationsStale)).toBeVisible(); expect(screen.getByText('synthetic-activation-1')).toBeVisible()
  expect(screen.getByText('req_act_500')).toBeVisible()
  expect(textbox(es.inputLabel)).toHaveValue('{"keep":true}'); expect(textbox(es.deploySpecLabel)).toHaveValue('{"name":"kept"}')
  fireEvent.click(button(es.retry))
  await screen.findByText('synthetic-activation-4')
  expect(screen.queryByText(es.activationsStale)).toBeNull()
  expect(calls().filter((call) => call.path === activationsPath)).toHaveLength(3)
})

test('a missing selected function offers a way back to the list', async () => {
  let count = 0
  setup({ [`GET ${list}`]: () => Response.json(++count === 1 ? actions2 : { items: [actions2.items[0]] }), [`POST ${invokePath}`]: failure(404, 'req_404') }); open(); await ready(); pick(1)
  fireEvent.click(button(es.invoke))
  expect(await screen.findByRole('heading', { name: es.notFound })).toBeVisible()
  fireEvent.click(button(es.backToList))
  await waitFor(() => expect(radios()).toHaveLength(1)); expect(radios()[0]).not.toBeChecked()
  expect(screen.queryByRole('heading', { name: es.notFound })).toBeNull()
})

test('the list shows loading, empty, 403, 500 and network states', async () => {
  let release!: (response: Response) => void
  setup({ [`GET ${list}`]: () => new Promise<Response>((done) => { release = done }) }); open()
  expect(await screen.findByLabelText(es.listLoading)).toBeVisible()
  await act(async () => release(Response.json({ items: [] })))
  expect(await screen.findByText(es.listEmpty)).toBeVisible(); expect(screen.getByText(es.resultEmpty)).toBeVisible(); expect(screen.getByText(es.activationsIdle)).toBeVisible()
})

test('a 403 hides the deploy and invoke panels behind the no-access state', async () => {
  setup({ [`GET ${list}`]: failure(403, 'req_403') }); open()
  expect(await screen.findByRole('heading', { name: es.noAccess })).toBeVisible()
  expect(screen.queryByRole('button', { name: es.deploy })).toBeNull(); expect(screen.queryByRole('button', { name: es.invoke })).toBeNull()
})

test.each([['500', () => failure(500, 'req_list_500')()], ['network', () => { throw new TypeError('network') }]])('a %s list failure shows the panel and Reintentar reloads', async (_name, response) => {
  let attempt = 0
  setup({ [`GET ${list}`]: () => ++attempt === 1 ? (response as () => Response)() : Response.json(actions2) }); open()
  expect(await screen.findByRole('heading', { name: es.listError })).toBeVisible()
  if (_name === '500') expect(screen.getByText('req_list_500')).toBeVisible()
  fireEvent.click(button(es.retry)); await ready(); expect(calls().filter((call) => call.path === list)).toHaveLength(2)
})

test('without a tenant the page is blocked and sends nothing', () => {
  context.value = { ...context.value, activeTenantId: null, activeWorkspaceId: null }; setup(); open()
  expect(screen.getByRole('heading', { name: es.blockedTitle })).toBeVisible(); expect(screen.getByText(es.blockedDescription)).toBeVisible()
  expect(calls()).toEqual([])
})

test('workspace states send no functions request until a workspace is picked', async () => {
  const selectWorkspace = vi.fn(), reloadWorkspaces = vi.fn()
  context.value = { ...context.value, activeWorkspaceId: null, selectWorkspace, reloadWorkspaces }; setup()
  const view = open()
  expect(screen.getByRole('heading', { name: es.workspaceRequired })).toBeVisible(); expect(screen.getByRole('combobox', { name: workspaceCopy.workspaceLabel })).toBeVisible()
  context.value = { ...context.value, workspaces: [] }; view.rerender(<StrictMode><MemoryRouter><ConsoleFunctionsDataPage /></MemoryRouter></StrictMode>)
  expect(screen.getByRole('link', { name: es.createWorkspace })).toHaveAttribute('href', '/console/workspaces')
  context.roles = ['tenant_viewer']; view.rerender(<StrictMode><MemoryRouter><ConsoleFunctionsDataPage /></MemoryRouter></StrictMode>)
  expect(screen.getByText(es.workspaceDenied)).toBeVisible()
  context.value = { ...context.value, loading: true }; view.rerender(<StrictMode><MemoryRouter><ConsoleFunctionsDataPage /></MemoryRouter></StrictMode>)
  expect(screen.getByRole('status', { name: es.workspaceLoading })).toBeVisible()
  context.value = { ...context.value, loading: false, error: { status: 500 } }; view.rerender(<StrictMode><MemoryRouter><ConsoleFunctionsDataPage /></MemoryRouter></StrictMode>)
  fireEvent.click(button(es.retry)); expect(reloadWorkspaces).toHaveBeenCalledTimes(1)
  expect(calls()).toEqual([])
})

test('picking a workspace sends exactly one list request for it', async () => {
  const requested = strictFetch({ 'GET /v1/functions/workspaces/ws-2/actions': actions2 }); requests = requested
  context.value = { ...context.value, activeWorkspaceId: 'ws-2' }; open(); await ready()
  expect(calls()).toEqual([{ method: 'GET', path: '/v1/functions/workspaces/ws-2/actions', body: undefined }])
})

test('only the four page endpoints are ever requested', async () => {
  setup({ [`POST ${deploy}`]: deployAccepted, [`POST ${invokePath}`]: invokeResult, [`GET ${activationsPath}`]: activations3 }); open(); await ready(); pick(1)
  fireEvent.click(button(es.invoke)); await screen.findByText('synthetic-hello', { exact: false })
  fireEvent.click(button(es.viewActivations)); await screen.findByRole('table', { name: es.activationsLabel })
  fireEvent.click(button(es.deploy)); await waitFor(() => expect(calls().filter((call) => call.method === 'POST' && call.path === deploy)).toHaveLength(1))
  for (const call of calls()) expect([`GET ${list}`, `POST ${deploy}`, `POST ${invokePath}`, `GET ${activationsPath}`]).toContain(`${call.method} ${call.path}`)
})
