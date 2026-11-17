import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import ConsoleFunctionsPage from '../src/pages/consoleFunctions'
import { action, actions60, activationDetail, activationPath, actionPath, actionsPath, activations, counts, createPath, functions3, inventory, inventoryPath, invocation, accepted, logs, query, result, rollbackAccepted, versions3 } from './parity/pages/console-functions-page.manifest'
import { login, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-functions-page.json'
import en from '../src/locales/en/pages.console-functions-page.json'

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => getConsolePermissions(['superadmin']) }))

const detailPath = actionPath(1)
const versionsPath = `${detailPath}/versions${query}`
const activationsPath = `${detailPath}/activations${query}`
const failure = (status: number, extra: Record<string, unknown> = {}) => () => Response.json({ status, code: `HTTP_${status}`, message: 'synthetic-error', requestId: `req_synthetic_${status}`, ...extra }, { status })
// Responses by attempt: the last one repeats.
const sequence = (...items: (Response | (() => Response) | 'network')[]) => { let attempt = 0; return () => { const item = items[Math.min(attempt++, items.length - 1)]; if (item === 'network') throw new TypeError('Failed to fetch'); return typeof item === 'function' ? item() : item.clone() } }
let requests: ReturnType<typeof strictFetch>
const calls = () => requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path), body: init?.body ? JSON.parse(String(init.body)) : undefined }))
const writes = () => requests.mock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET').map(([path, init]) => ({ method: init!.method, path: String(path), body: init?.body ? JSON.parse(String(init.body)) : undefined, key: new Headers(init!.headers).get('Idempotency-Key') }))
const reads = (routes: Record<string, unknown> = {}) => ({
  [`GET ${inventoryPath}`]: inventory({ limit: 50, used: 3, remaining: 47 }),
  [`GET ${detailPath}`]: action(1, 'synthetic-hello'),
  [`GET ${versionsPath}`]: versions3,
  [`GET ${activationsPath}`]: activations(3),
  [`GET ${activationPath()}`]: activationDetail,
  [`GET ${activationPath()}/logs`]: logs,
  [`GET ${activationPath()}/result`]: result,
  ...routes,
})
const setup = (routes: Record<string, unknown> = {}) => { requests = strictFetch(reads(routes)) }
const open = (strict = false) => render(<MemoryRouter>{strict ? <StrictMode><ConsoleFunctionsPage /></StrictMode> : <ConsoleFunctionsPage />}</MemoryRouter>)
const copyNow = () => (i18n.language === 'en' ? en : es)
const ready = () => screen.findByRole('table', { name: copyNow().inventory.caption })
const pick = (name: string) => fireEvent.click(screen.getByRole('radio', { name }))
const tab = (name: string) => screen.getByRole('tab', { name })
const openTab = async (name: string) => { fireEvent.click(tab(name)); await waitFor(() => expect(tab(name)).toHaveAttribute('aria-selected', 'true')) }
const select = async (name = 'synthetic-hello') => { await ready(); pick(name); await screen.findByTestId('functions-detail'); await screen.findByTestId('functions-history'); await waitFor(() => expect(screen.getByTestId('functions-history').querySelector('[aria-busy="true"]')).toBeNull()) }
const button = (name: string | RegExp) => screen.getByRole('button', { name })
const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement
const type = (name: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
const meter = () => screen.getByRole('meter')
const kpi = (label: string) => document.querySelector(`dl[aria-label="${label}"]`) as HTMLElement
const within_ = (id: string) => within(screen.getByTestId(id))

beforeEach(async () => {
  await i18n.changeLanguage('es'); login()
  context.value = { activeTenantId: 'synthetic-tenant', activeWorkspaceId: 'synthetic-workspace', loading: false, error: null, workspaces: [{ workspaceId: 'synthetic-workspace', displayName: 'Workspace one' }], selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn() }
})
afterEach(() => requests?.verify())

test.each(['es', 'en'] as const)('renders the heading, the cross-link, the kpi counts and one radio per function in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open()
  const copy = locale === 'es' ? es : en
  const table = await screen.findByRole('table', { name: copy.inventory.caption })
  expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
  expect(screen.getByRole('link', { name: copy.quickLink })).toHaveAttribute('href', '/console/functions/data')
  const cards = kpi(copy.kpi.label)
  for (const [key, value] of [['actions', counts.actions], ['packages', counts.packages], ['triggers', counts.triggers], ['httpExposures', counts.httpExposures]] as const) expect(cards).toHaveTextContent(`${copy.kpi[key]}${value}`)
  for (const fn of functions3) {
    const row = within(table).getByText(fn.actionName).closest('tr')!
    expect(row).toHaveTextContent('nodejs:20'); expect(row).toHaveTextContent('synthetic-version-3')
    expect(within(row).getByRole('radio', { name: fn.actionName })).not.toBeChecked()
  }
  expect(screen.getByText(copy.detail.empty)).toBeVisible()
  expect(screen.getAllByRole('button', { name: copy.deploy }).length).toBeGreaterThan(0)
  expect(calls()).toEqual([{ method: 'GET', path: inventoryPath, body: undefined }])
})

test('the inventory loads once under StrictMode', async () => {
  setup(); open(true); await ready()
  expect(calls()).toEqual([{ method: 'GET', path: inventoryPath, body: undefined }])
})

test.each([
  ['healthy', { limit: 50, used: 3, remaining: 47 }, 'ok', 3, 47],
  ['warning', { limit: 50, used: 46, remaining: 4 }, 'warning', 46, 4],
  ['destructive', { limit: 50, used: 50, remaining: 0 }, 'critical', 50, 0],
  ['remaining only', { limit: 50, remaining: 4 }, 'warning', 46, 4],
] as const)('the quota meter is %s for %j', async (_name, quotaStatus, level, value, remaining) => {
  setup({ [`GET ${inventoryPath}`]: inventory(quotaStatus) }); open(); await ready()
  const gauge = meter()
  expect(gauge).toHaveAttribute('data-level', level); expect(gauge).toHaveAttribute('aria-valuenow', String(value)); expect(gauge).toHaveAttribute('aria-valuemax', '50')
  expect(gauge).toHaveTextContent(es.quota.value.replace('{remaining}', String(remaining)).replace('{limit}', '50'))
})

test('the meter is hidden when the inventory has no quota status', async () => {
  setup({ [`GET ${inventoryPath}`]: inventory() }); open(); await ready()
  expect(screen.queryByRole('meter')).toBeNull()
})

test('the inventory falls back to the actions collection and shows all 60 rows without paging', async () => {
  setup({ [`GET ${inventoryPath}`]: failure(500), [`GET ${actionsPath}${query}`]: actions60 }); open(); await ready()
  expect(screen.getAllByRole('radio')).toHaveLength(60)
  expect(screen.queryByRole('navigation', { name: /pagin/i })).toBeNull()
  expect(calls()).toEqual([{ method: 'GET', path: inventoryPath, body: undefined }, { method: 'GET', path: `${actionsPath}${query}`, body: undefined }])
  expect(kpi(es.kpi.label)).toHaveTextContent(`${es.kpi.actions}60`)
})

test.each(['es', 'en'] as const)('both inventory sources failing with 5xx shows one panel with the request id and a retry that resends both in %s', async (locale) => {
  await i18n.changeLanguage(locale); const copy = locale === 'es' ? es : en
  setup({ [`GET ${inventoryPath}`]: failure(500), [`GET ${actionsPath}${query}`]: failure(500) }); open()
  const panel = await screen.findByRole('alert')
  expect(panel).toHaveTextContent(copy.errors['5xx']); expect(panel).toHaveTextContent('req_synthetic_500')
  expect(screen.queryByText(copy.errors.inventory)).toBeNull()
  fireEvent.click(within(panel).getByRole('button', { name: copy.retry }))
  await waitFor(() => expect(calls()).toHaveLength(4))
})

test.each([[undefined, 'inventory'], [400, 'inventory'], [402, 'inventory']] as const)('status %s uses the page fallback for the inventory', async (status, key) => {
  const bad = status === undefined ? () => { throw new TypeError('Failed to fetch') } : failure(status)
  setup({ [`GET ${inventoryPath}`]: bad, [`GET ${actionsPath}${query}`]: bad }); open()
  expect(await screen.findByText(es.errors[key])).toBeVisible(); expect(screen.queryByText(es.errors['5xx'])).toBeNull()
})

test('a 403 inventory shows the in-page no-access state and no retry', async () => {
  setup({ [`GET ${inventoryPath}`]: failure(403), [`GET ${actionsPath}${query}`]: failure(403) }); open()
  expect(await screen.findByText(es.noAccess.inventory)).toBeVisible(); expect(screen.getByText(es.errors['403'])).toBeVisible(); expect(screen.queryByRole('button', { name: es.retry })).toBeNull()
})

test('an empty workspace shows the empty copy and no table', async () => {
  setup({ [`GET ${inventoryPath}`]: { workspaceId: 'synthetic-workspace', actions: [], counts: { actions: 0 } } }); open()
  expect(await screen.findByText(es.inventory.empty)).toBeVisible(); expect(screen.queryByRole('table')).toBeNull()
})

test('selecting a function loads its detail and versions, and the detail shows every field', async () => {
  setup(); open(); await select()
  expect(calls().slice(1)).toEqual([{ method: 'GET', path: detailPath, body: undefined }, { method: 'GET', path: versionsPath, body: undefined }])
  const panel = screen.getByTestId('functions-detail')
  for (const text of ['synthetic-hello', 'synthetic-function-1', 'synthetic-package', 'synthetic-namespace', 'synthetic-version-3', 'sha256:synthetic-digest', 'nodejs:20', 'main', '30000', '256', '5', '7', 'inline_code', 'https://synthetic.example.test/hello', 'bearer', 'synthetic-secret', '2026-05-01T10:00:00Z', '2026-05-30T10:00:00Z']) expect(panel).toHaveTextContent(text)
  expect(panel).toHaveTextContent(es.fields.yes)
  for (const heading of [es.identity.title, es.execution.title, es.advanced.title, es.secrets.title, es.snippets.title]) expect(within(panel).getByRole('heading', { name: heading })).toBeVisible()
  expect(screen.getByRole('radio', { name: 'synthetic-hello' })).toBeChecked()
})

test('the status history has exactly one event per version, newest first', async () => {
  setup(); open(); await select()
  const items = within(screen.getByRole('list', { name: es.history.label })).getAllByRole('listitem')
  expect(items).toHaveLength(3)
  expect(items.map((item) => /synthetic-version-\d/.exec(item.textContent ?? '')?.[0])).toEqual(['synthetic-version-3', 'synthetic-version-2', 'synthetic-version-1'])
})

test('no kit sample copy or kpi deltas render', async () => {
  setup(); open(); await select()
  const text = document.body.textContent ?? ''
  const found = /deployment|acme|Searching|vs\. previous|\+12\.4%/i.exec(text); expect(found && text.slice(Math.max(0, found.index - 30), found.index + 30)).toBeNull()
  expect(document.querySelector('[data-delta]')).toBeNull()
})

test('the six tabs follow the arrow, Home and End keys', async () => {
  setup(); open(); await select()
  const names = Object.values(es.tabs)
  expect(screen.getAllByRole('tab').map((node) => node.textContent)).toEqual(names)
  tab('Detalle').focus()
  fireEvent.keyDown(tab('Detalle'), { key: 'ArrowRight' }); await waitFor(() => expect(tab('Versiones')).toHaveAttribute('aria-selected', 'true'))
  fireEvent.keyDown(tab('Versiones'), { key: 'End' }); await waitFor(() => expect(tab('Desplegar')).toHaveAttribute('aria-selected', 'true'))
  fireEvent.keyDown(tab('Desplegar'), { key: 'Home' }); await waitFor(() => expect(tab('Detalle')).toHaveAttribute('aria-selected', 'true'))
  fireEvent.keyDown(tab('Detalle'), { key: 'ArrowLeft' }); await waitFor(() => expect(tab('Desplegar')).toHaveAttribute('aria-selected', 'true'))
})

test('the versions tab preselects the first eligible version and ineligible ones are disabled', async () => {
  setup(); open(); await select(); await openTab('Versiones')
  const radios = within(screen.getByTestId('functions-versions')).getAllByRole('radio') as HTMLInputElement[]
  expect(radios).toHaveLength(3)
  expect(radios.map((node) => node.checked)).toEqual([true, false, false]); expect(radios.map((node) => node.disabled)).toEqual([false, false, true])
  expect(calls().filter(({ path }) => path === versionsPath)).toHaveLength(1)
})

test('rollback posts the selected version with an Idempotency-Key and reloads detail and versions', async () => {
  setup({ [`POST ${detailPath}/rollback`]: rollbackAccepted }); open(); await select(); await openTab('Versiones')
  fireEvent.click(within_('functions-versions').getAllByRole('radio')[1]); fireEvent.click(button(es.versions.rollback))
  await screen.findByText(es.versions.accepted.replace('{status}', 'accepted'))
  expect(writes()).toEqual([{ method: 'POST', path: `${detailPath}/rollback`, body: { versionId: 'synthetic-version-2', reason: 'Reversión iniciada desde la consola' }, key: expect.any(String) }])
  await waitFor(() => expect(calls().filter(({ path }) => path === detailPath)).toHaveLength(2)); expect(calls().filter(({ path }) => path === versionsPath)).toHaveLength(2)
})

test('rollback is disabled when no version is eligible', async () => {
  setup({ [`GET ${versionsPath}`]: { items: versions3.items.map((item) => ({ ...item, rollbackEligible: false })) } }); open(); await select(); await openTab('Versiones')
  expect(button(es.versions.rollback)).toBeDisabled(); expect(screen.getByText(es.versions.noneEligible)).toBeVisible()
})

test('activations list the returned window and selecting one requests metadata, logs and result', async () => {
  setup({ [`GET ${activationsPath}`]: activations(50) }); open(); await select(); await openTab('Activaciones')
  const section = await screen.findByTestId('functions-activations')
  expect(await within(section).findAllByRole('radio')).toHaveLength(50)
  expect(within(section).getByRole('heading', { name: es.activations.title })).toBeVisible()
  expect(screen.queryByRole('navigation', { name: /pagin/i })).toBeNull()
  fireEvent.click(within(section).getAllByRole('radio')[0])
  await screen.findByTestId('functions-activation-result'); await screen.findByTestId('functions-activation-logs')
  expect(calls().slice(-3)).toEqual([activationPath(), `${activationPath()}/logs`, `${activationPath()}/result`].map((path) => ({ method: 'GET', path, body: undefined })))
  expect(section).toHaveTextContent('synthetic-invocation-1'); expect(section).toHaveTextContent('synthetic log line one'); expect(section).toHaveTextContent('synthetic-hello')
})

test.each([
  ['truncated', { ...logs, truncated: true }, result, es.activations.logsTruncated],
  ['no logs', { ...logs, lines: [] }, result, es.activations.logsEmpty],
  ['no result', logs, { ...result, result: null }, es.activations.resultNone],
  ['binary', logs, { ...result, contentType: 'application/octet-stream' }, es.activations.resultBinary],
  ['running without logs or result', null, null, es.activations.logsRunning],
] as const)('activation states: %s', async (name, logsBody, resultBody, text) => {
  setup({ [`GET ${activationPath()}`]: name.startsWith('running') ? { ...activationDetail, status: 'running' } : activationDetail, [`GET ${activationPath()}/logs`]: logsBody, [`GET ${activationPath()}/result`]: resultBody })
  open(); await select(); await openTab('Activaciones'); fireEvent.click((await within_('functions-activations').findAllByRole('radio'))[0])
  expect(await screen.findByText(text)).toBeVisible()
  if (name.startsWith('running')) expect(screen.getByText(es.activations.resultRunning)).toBeVisible()
})

test('an activation 404 shows the unavailable copy and logs 403 shows its own copy while metadata and result render', async () => {
  setup({ [`GET ${activationPath()}`]: failure(404), [`GET ${activationPath()}/logs`]: failure(403) }); open(); await select(); await openTab('Activaciones'); fireEvent.click((await within_('functions-activations').findAllByRole('radio'))[0])
  expect(await screen.findByText(es.errors.activationGone)).toBeVisible(); expect(screen.getByText(es.errors.logsForbidden)).toBeVisible()
  expect(await screen.findByTestId('functions-activation-result')).toHaveTextContent('synthetic-hello')
})

test('each activation request fails and retries on its own', async () => {
  for (const part of ['', '/logs', '/result']) {
    const path = `${activationPath()}${part}`
    const retry = sequence(Response.json({ status: 500, message: 'synthetic-error', requestId: 'req_synthetic_part' }, { status: 500 }), Response.json(part === '/logs' ? logs : part === '/result' ? result : activationDetail))
    setup({ [`GET ${path}`]: retry, [`GET ${activationsPath}`]: activations(3) }); const view = open(); await select(); await openTab('Activaciones'); fireEvent.click((await within_('functions-activations').findAllByRole('radio'))[0])
    const panel = await screen.findByRole('alert'); expect(panel).toHaveTextContent(es.errors['5xx']); expect(panel).toHaveTextContent('req_synthetic_part')
    const before = calls().length
    fireEvent.click(within(panel).getByRole('button', { name: es.retry }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(calls().slice(before)).toEqual([{ method: 'GET', path, body: undefined }])
    requests.verify(); view.unmount()
  }
})

test('versions failing leaves the detail in place and retries only the versions request', async () => {
  const retry = sequence(failure(500), Response.json(versions3))
  setup({ [`GET ${versionsPath}`]: retry }); open(); await ready(); pick('synthetic-hello')
  const panel = await screen.findByRole('alert'); expect(panel).toHaveTextContent(es.errors['5xx'])
  expect(screen.getByTestId('functions-detail')).toHaveTextContent('synthetic-package')
  const before = calls().length; fireEvent.click(within(panel).getByRole('button', { name: es.retry }))
  await screen.findByRole('list', { name: es.history.label }); expect(calls().slice(before)).toEqual([{ method: 'GET', path: versionsPath, body: undefined }])
})

test('a detail 403 and 404 replace only the detail pane', async () => {
  setup({ [`GET ${detailPath}`]: failure(403) }); const view = open(); await ready(); pick('synthetic-hello')
  expect(await screen.findByText(es.noAccess.detail)).toBeVisible(); expect(screen.getByRole('table', { name: es.inventory.caption })).toBeVisible(); view.unmount(); requests.verify()
  setup({ [`GET ${detailPath}`]: failure(404) }); open(); await ready(); pick('synthetic-hello')
  expect(await screen.findByRole('heading', { name: es.notFound.title })).toBeVisible(); expect(screen.getByText(es.errors['404'])).toBeVisible()
  fireEvent.click(button(es.notFound.back)); expect(document.activeElement).toBe(document.getElementById('functions-inventory-title'))
})

test('a network failure after load replaces the loaded detail with a panel, never stale data, and retry reloads only it', async () => {
  const detailReads = sequence(Response.json(action(1, 'synthetic-hello')), 'network', Response.json(action(1, 'synthetic-hello')))
  setup({ [`GET ${detailPath}`]: detailReads, [`PATCH ${detailPath}`]: accepted() }); open(); await update()
  expect(field(es.form.entrypoint)).toHaveValue('main')
  fireEvent.change(field(es.form.entrypoint), { target: { value: 'main2' } }); fireEvent.click(screen.getByRole('button', { name: es.form.update }))
  const panel = await screen.findByRole('alert'); expect(panel).toHaveTextContent(es.errors.detail)
  expect(screen.queryByTestId('functions-deploy')).toBeNull(); expect(screen.queryByLabelText(es.form.entrypoint)).toBeNull(); expect(screen.queryByTestId('functions-detail')).toBeNull()
  await waitFor(() => expect(calls().filter(({ path }) => path === versionsPath)).toHaveLength(2))
  const before = calls().length; fireEvent.click(within(panel).getByRole('button', { name: es.retry }))
  await screen.findByTestId('functions-deploy'); expect(calls().slice(before)).toEqual([{ method: 'GET', path: detailPath, body: undefined }])
})

test('a network failure after the activation list loaded replaces it with a panel, never stale data, and retry reloads only it', async () => {
  const activationReads = sequence(Response.json(activations(3)), 'network', Response.json(activations(3)))
  setup({ [`GET ${activationsPath}`]: activationReads, [`POST ${detailPath}/invocations`]: invocation }); open(); await select(); await openTab('Activaciones')
  const list = await within_('functions-activations').findAllByRole('radio'); expect(list.length).toBeGreaterThan(0)
  await openTab('Invocar'); fireEvent.click(button(es.invoke.action)); await screen.findByText(es.invoke.resultTitle)
  await openTab('Activaciones')
  const panel = await within_('functions-activations').findByRole('alert'); expect(panel).toHaveTextContent(es.errors.activations)
  expect(within_('functions-activations').queryAllByRole('radio')).toHaveLength(0)
  const before = calls().length; fireEvent.click(within(panel).getByRole('button', { name: es.retry }))
  await waitFor(() => expect(within_('functions-activations').queryByRole('alert')).toBeNull())
  expect(calls().slice(before)).toEqual([{ method: 'GET', path: activationsPath, body: undefined }])
  expect((await within_('functions-activations').findAllByRole('radio')).length).toBeGreaterThan(0)
})

test('the invoke tab sends the parameters, the response mode and an Idempotency-Key, then opens the activation', async () => {
  setup({ [`POST ${detailPath}/invocations`]: invocation }); open(); await select(); await openTab('Invocar')
  type(es.invoke.payload, '{"ping":true}'); fireEvent.click(button(es.invoke.action))
  await screen.findByText(es.invoke.resultTitle); await waitFor(() => expect(tab('Activaciones')).toHaveAttribute('aria-selected', 'true'))
  expect(writes()).toEqual([{ method: 'POST', path: `${detailPath}/invocations`, body: { parameters: { ping: true }, responseMode: 'accepted', idempotencyScope: 'request' }, key: expect.any(String) }])
  expect(calls().slice(-4).map(({ path }) => path)).toEqual([activationsPath, activationPath(), `${activationPath()}/logs`, `${activationPath()}/result`])
})

test.each([['{', es.invoke.invalidJson], ['[1]', es.invoke.invalidObject], ['"text"', es.invoke.invalidObject]])('invoke payload %s is rejected without a request', async (payload, message) => {
  setup(); open(); await select(); await openTab('Invocar'); type(es.invoke.payload, payload); fireEvent.click(button(es.invoke.action))
  expect(await screen.findByText(message)).toBeVisible(); expect(textbox(es.invoke.payload)).toHaveAttribute('aria-invalid', 'true'); expect(writes()).toEqual([])
})

test('an empty invoke payload sends an empty object', async () => {
  setup({ [`POST ${detailPath}/invocations`]: invocation }); open(); await select(); await openTab('Invocar'); type(es.invoke.payload, '  '); fireEvent.click(button(es.invoke.action))
  await screen.findByText(es.invoke.resultTitle); expect(writes()[0].body).toEqual({ parameters: {}, responseMode: 'accepted', idempotencyScope: 'request' })
})

test.each([
  ['429', failure(429), es.errors['429'], true], ['QUOTA_EXCEEDED 402', failure(402, { code: 'QUOTA_EXCEEDED' }), es.errors.invoke, true],
  ['500', failure(500), es.errors['5xx'], false], ['400 with quota in the message', failure(400, { message: 'synthetic quota message' }), es.errors.invoke, false],
] as const)('invoke %s shows its message and the limits hint follows the status and code', async (_name, response, message, hint) => {
  setup({ [`POST ${detailPath}/invocations`]: response }); open(); await select(); await openTab('Invocar'); fireEvent.click(button(es.invoke.action))
  const panel = await screen.findByTestId('functions-invoke').then(() => screen.findByRole('alert')); expect(panel).toHaveTextContent(message)
  if (hint) expect(screen.getByText(es.errors.limitsHint)).toBeVisible(); else expect(screen.queryByText(es.errors.limitsHint)).toBeNull()
})

// The kit select highlights an option on hover before a click selects it, as a pointer does.
const chooseOption = async (name: string) => { const option = await screen.findByRole('option', { name }); fireEvent.pointerMove(option); fireEvent.mouseMove(option); fireEvent.click(option) }
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement
const update = async () => { await select(); await openTab('Desplegar'); await screen.findByTestId('functions-deploy') }

test('the deploy form is filled from the function and shows no unsaved changes until a field differs', async () => {
  setup(); open(); await update()
  expect(field(es.form.actionName)).toHaveValue('synthetic-hello'); expect(field(es.form.actionName)).toBeDisabled(); expect(field(es.form.entrypoint)).toHaveValue('main')
  expect(screen.getByText(es.form.clean)).toBeVisible(); expect(screen.getByRole('button', { name: es.form.update })).toBeDisabled(); expect(screen.getByRole('button', { name: es.form.discard })).toBeDisabled()
  fireEvent.change(field(es.form.entrypoint), { target: { value: 'main2' } })
  expect(screen.getByText(es.form.dirty)).toBeVisible(); expect(screen.getByRole('button', { name: es.form.update })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: es.form.discard }))
  expect(field(es.form.entrypoint)).toHaveValue('main'); expect(screen.getByText(es.form.clean)).toBeVisible(); expect(writes()).toEqual([])
})

test('update patches the function with the legacy body and an Idempotency-Key, then reloads inventory and detail', async () => {
  setup({ [`PATCH ${detailPath}`]: accepted() }); open(); await update()
  fireEvent.change(field(es.form.entrypoint), { target: { value: 'main2' } }); fireEvent.click(screen.getByRole('button', { name: es.form.update }))
  await screen.findByTestId('functions-deploy-result')
  expect(writes()).toEqual([{ method: 'PATCH', path: detailPath, key: expect.any(String), body: {
    tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace', actionName: 'synthetic-hello', activationPolicy: { mode: 'workspace_default', retentionDays: 7 },
    execution: { runtime: 'nodejs:20', entrypoint: 'main2', limits: { timeoutMs: 30000, memoryMb: 256 } }, source: { kind: 'inline_code', inlineCode: 'exports.main = () => ({ ok: true })', entryFile: 'index.js' } } }])
  await waitFor(() => expect(calls().filter(({ path }) => path === inventoryPath)).toHaveLength(2)); await waitFor(() => expect(calls().filter(({ method, path }) => method === 'GET' && path === detailPath)).toHaveLength(2))
})

test('create posts the legacy body, selects the new function and reloads inventory and detail', async () => {
  const created = { ...accepted(), resourceId: 'synthetic-function-4' }
  setup({ [`POST ${createPath}`]: created, [`GET ${actionPath(4)}`]: action(4, 'synthetic-new'), [`GET ${actionPath(4)}/versions${query}`]: { items: [] }, [`GET ${inventoryPath}`]: sequence(Response.json(inventory()), Response.json({ ...inventory(), actions: [...functions3, action(4, 'synthetic-new')] })) })
  open(); await ready(); fireEvent.click(screen.getAllByRole('button', { name: es.deploy })[0])
  expect(await screen.findByRole('heading', { name: es.detail.newFunction })).toBeVisible(); expect(tab('Desplegar')).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: es.form.create })).toBeDisabled()
  fireEvent.change(field(es.form.actionName), { target: { value: 'synthetic-new' } }); fireEvent.change(field(es.form.entrypoint), { target: { value: 'main' } }); fireEvent.click(screen.getByRole('button', { name: es.form.create }))
  expect(await screen.findByText(es.form.validationTitle)).toBeVisible(); expect(writes()).toEqual([])
  fireEvent.click(screen.getByRole('link', { name: es.form.required })); expect(document.activeElement).toBe(document.getElementById('functions-runtime'))
})

test('the runtime select keeps the localized empty choice so a chosen runtime can be cleared', async () => {
  setup(); open(); await ready(); fireEvent.click(screen.getAllByRole('button', { name: es.deploy })[0])
  const runtime = await screen.findByRole('combobox', { name: es.form.runtime }); expect(runtime).toHaveTextContent(es.form.runtimePlaceholder)
  fireEvent.click(runtime); expect(await screen.findByRole('option', { name: es.form.runtimePlaceholder })).toBeVisible()
  await chooseOption('nodejs:20'); await waitFor(() => expect(screen.getByRole('combobox', { name: es.form.runtime })).toHaveTextContent('nodejs:20'))
  fireEvent.click(screen.getByRole('combobox', { name: es.form.runtime })); await chooseOption(es.form.runtimePlaceholder)
  await waitFor(() => expect(screen.getByRole('combobox', { name: es.form.runtime })).toHaveTextContent(es.form.runtimePlaceholder))
  fireEvent.change(field(es.form.actionName), { target: { value: 'synthetic-new' } }); fireEvent.change(field(es.form.entrypoint), { target: { value: 'main' } })
  fireEvent.click(screen.getByRole('button', { name: es.form.create })); expect(await screen.findByText(es.form.validationTitle)).toBeVisible(); expect(writes()).toEqual([])
})

test('create with a runtime sends POST /v1/functions/actions with the identity and inline source', async () => {
  const created = { ...accepted(), resourceId: 'synthetic-function-4' }
  setup({ [`POST ${createPath}`]: created, [`GET ${actionPath(4)}`]: action(4, 'synthetic-new'), [`GET ${actionPath(4)}/versions${query}`]: { items: [] }, [`GET ${inventoryPath}`]: sequence(Response.json(inventory()), Response.json({ ...inventory(), actions: [...functions3, action(4, 'synthetic-new')] })) })
  open(); await ready(); fireEvent.click(screen.getAllByRole('button', { name: es.deploy })[0])
  fireEvent.change(await screen.findByLabelText(es.form.actionName), { target: { value: 'synthetic-new' } }); fireEvent.change(field(es.form.entrypoint), { target: { value: 'main' } })
  fireEvent.change(field(es.form.inlineCode), { target: { value: 'exports.main = () => 1' } })
  fireEvent.click(screen.getByRole('combobox', { name: es.form.runtime })); await chooseOption('nodejs:20')
  fireEvent.click(screen.getByRole('button', { name: es.form.create }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]).toEqual({ method: 'POST', path: createPath, key: expect.any(String), body: { tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace', actionName: 'synthetic-new', activationPolicy: { mode: 'workspace_default' },
    execution: { runtime: 'nodejs:20', entrypoint: 'main', limits: {} }, source: { kind: 'inline_code', inlineCode: 'exports.main = () => 1', entryFile: 'index.js' } } })
  expect(await screen.findByRole('heading', { name: 'synthetic-new' })).toBeVisible(); expect(tab('Detalle')).toHaveAttribute('aria-selected', 'true')
  expect(calls().filter(({ path }) => path === actionPath(4))).toHaveLength(1)
})

test('an invalid function name is reported with the pattern message and sends nothing', async () => {
  setup(); open(); await ready(); fireEvent.click(screen.getAllByRole('button', { name: es.deploy })[0])
  fireEvent.change(await screen.findByLabelText(es.form.actionName), { target: { value: 'Bad Name' } }); fireEvent.change(field(es.form.entrypoint), { target: { value: 'main' } })
  fireEvent.click(screen.getByRole('combobox', { name: es.form.runtime })); await chooseOption('nodejs:20')
  fireEvent.click(screen.getByRole('button', { name: es.form.create }))
  expect(await screen.findByRole('link', { name: es.form.pattern })).toBeVisible(); expect(writes()).toEqual([])
})

function ctx(overrides: Record<string, unknown>) { context.value = { ...context.value, ...overrides } }

test('the page never renders raw keys or the English copy in es', async () => {
  setup(); open(); await select()
  const text = document.body.textContent ?? ''
  expect(text).not.toMatch(/pages\.console-functions-page|\b(tabs|errors|kpi)\.[a-z]/)
  for (const key of ['title', 'deploy', 'retry'] as const) if (en[key] !== es[key]) expect(text).not.toContain(en[key])
})

const keys = () => writes().map(({ key }) => key)

test.each([
  ['invoke', 'Invocar', () => button(es.invoke.action), 'POST', `${detailPath}/invocations`, invocation],
  ['rollback', 'Versiones', () => button(es.versions.rollback), 'POST', `${detailPath}/rollback`, rollbackAccepted],
] as const)('%s resends the same Idempotency-Key after an HTTP error, then mints a new one after a success', async (_name, tabName, trigger, method, path, success) => {
  const route = sequence(failure(500), Response.json(success), Response.json(success))
  setup({ [`${method} ${path}`]: route }); open(); await select(); await openTab(tabName)
  fireEvent.click(trigger()); await waitFor(() => expect(writes()).toHaveLength(1)); await screen.findByRole('alert')
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: es.retry })); await waitFor(() => expect(writes()).toHaveLength(2))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  await openTab(tabName)
  fireEvent.click(trigger()); await waitFor(() => expect(writes()).toHaveLength(3))
  expect(keys()[0]).toBe(keys()[1]); expect(keys()[2]).not.toBe(keys()[1])
})

test('a network failure also keeps the key for the retry', async () => {
  setup({ [`POST ${detailPath}/invocations`]: sequence('network', Response.json(invocation)) }); open(); await select(); await openTab('Invocar')
  fireEvent.click(button(es.invoke.action)); await screen.findByText(es.errors.invoke)
  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: es.retry })); await waitFor(() => expect(writes()).toHaveLength(2))
  expect(keys()[0]).toBe(keys()[1])
})

test('deploy and update keep their key after a failure and rotate it after a success', async () => {
  setup({ [`PATCH ${detailPath}`]: sequence(failure(500), Response.json(accepted()), Response.json(accepted())) }); open(); await update()
  fireEvent.change(field(es.form.entrypoint), { target: { value: 'main2' } }); fireEvent.click(screen.getByRole('button', { name: es.form.update }))
  await screen.findByRole('alert'); fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: es.retry })); await waitFor(() => expect(writes()).toHaveLength(2))
  await screen.findByTestId('functions-deploy-result'); await waitFor(() => expect(field(es.form.entrypoint)).toHaveValue('main'))
  fireEvent.change(field(es.form.entrypoint), { target: { value: 'main3' } }); fireEvent.click(screen.getByRole('button', { name: es.form.update })); await waitFor(() => expect(writes()).toHaveLength(3))
  expect(keys()[0]).toBe(keys()[1]); expect(keys()[2]).not.toBe(keys()[1])
})

const typedDelete = async (name = 'synthetic-hello') => {
  fireEvent.click(screen.getByRole('button', { name: es.delete.aria.replace('{name}', name) }))
  const dialog = await screen.findByRole('alertdialog'); return { dialog, input: within(dialog).getByRole('textbox', { name: es.delete.typed }) as HTMLInputElement, confirm: within(dialog).getByRole('button', { name: es.delete.confirm }) as HTMLButtonElement }
}

test('delete stays disabled until the exact name is typed, then sends DELETE with an Idempotency-Key', async () => {
  setup({ [`DELETE ${detailPath}`]: accepted(), [`GET ${inventoryPath}`]: sequence(Response.json(inventory()), Response.json({ ...inventory(), actions: functions3.slice(1) })) }); open(); await select()
  const { input, confirm } = await typedDelete(); expect(confirm).toBeDisabled()
  fireEvent.change(input, { target: { value: 'synthetic-hell' } }); expect(confirm).toBeDisabled(); fireEvent.change(input, { target: { value: 'Synthetic-hello' } }); expect(confirm).toBeDisabled()
  fireEvent.change(input, { target: { value: 'synthetic-hello' } }); expect(confirm).toBeEnabled(); fireEvent.click(confirm)
  await waitFor(() => expect(writes()).toEqual([{ method: 'DELETE', path: detailPath, body: undefined, key: expect.any(String) }]))
  expect((await screen.findAllByText(es.deleted.message.replace('{name}', 'synthetic-hello'))).length).toBeGreaterThan(0)
  await waitFor(() => expect(calls().filter(({ path }) => path === inventoryPath)).toHaveLength(2)); await waitFor(() => expect(screen.getAllByRole('radio')).toHaveLength(2))
  expect(screen.getByText(es.detail.empty)).toBeVisible(); expect(document.activeElement).toBe(document.getElementById('functions-inventory-title'))
})

test('cancelling the delete sends nothing and returns focus to the delete button', async () => {
  setup(); open(); await select()
  const { dialog } = await typedDelete(); fireEvent.click(within(dialog).getByRole('button', { name: es.delete.cancel }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(writes()).toEqual([])
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: es.delete.aria.replace('{name}', 'synthetic-hello') })))
})

test('a failed delete keeps its key for the same function and a different function gets a new key', async () => {
  setup({ [`DELETE ${detailPath}`]: sequence(failure(500), failure(500)), [`GET ${actionPath(2)}`]: action(2, 'synthetic-billing'), [`GET ${actionPath(2)}/versions${query}`]: { items: [] }, [`DELETE ${actionPath(2)}`]: failure(500) })
  open(); await select()
  let { input, confirm } = await typedDelete(); fireEvent.change(input, { target: { value: 'synthetic-hello' } }); fireEvent.click(confirm)
  const panel = await within(screen.getByRole('alertdialog')).findByRole('alert'); expect(panel).toHaveTextContent(es.errors['5xx']); expect(panel).toHaveTextContent('req_synthetic_500')
  fireEvent.click(within(panel).getByRole('button', { name: es.retry })); await waitFor(() => expect(writes()).toHaveLength(2))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: es.delete.cancel })); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  pick('synthetic-billing'); await screen.findByRole('heading', { name: 'synthetic-billing', level: 2 }); await waitFor(() => expect(screen.getByRole('button', { name: es.delete.aria.replace('{name}', 'synthetic-billing') })).toBeEnabled());
  ({ input, confirm } = await typedDelete('synthetic-billing')); fireEvent.change(input, { target: { value: 'synthetic-billing' } }); fireEvent.click(confirm); await waitFor(() => expect(writes()).toHaveLength(3))
  expect(keys()[0]).toBe(keys()[1]); expect(keys()[2]).not.toBe(keys()[1])
})

test.each(['provisioning', 'degraded', 'suspended', 'unavailable', 'deletion_pending'] as const)('%s blocks every write action and describes them with the reason', async (state) => {
  setup({ [`GET ${detailPath}`]: action(1, 'synthetic-hello', state) }); open(); await select()
  const reason = es.write[state]; const notice = await screen.findByTestId('functions-write-disabled'); expect(notice).toHaveTextContent(reason); expect(notice).toHaveTextContent(es.write.blocked)
  const del = screen.getByRole('button', { name: es.delete.aria.replace('{name}', 'synthetic-hello') }); expect(del).toBeDisabled(); expect(del.getAttribute('aria-describedby')).toBe(notice.id)
  await openTab('Versiones'); const rollback = button(es.versions.rollback); expect(rollback).toBeDisabled(); expect(rollback.getAttribute('aria-describedby')).toBe(notice.id)
  await openTab('Invocar'); const invoke = button(es.invoke.action); expect(invoke).toBeDisabled(); expect(invoke.getAttribute('aria-describedby')).toBe(notice.id)
  await openTab('Desplegar'); fireEvent.change(field(es.form.entrypoint), { target: { value: 'changed' } })
  const save = screen.getByRole('button', { name: es.form.update }); expect(save).toBeDisabled(); expect(save.getAttribute('aria-describedby')).toBe(notice.id)
  expect(writes()).toEqual([])
})

test.each(['provisioning', 'degraded', 'suspended', 'unavailable', 'deletion_pending'] as const)('a failed invoke cannot be retried once the function turns %s', async (state) => {
  setup({
    [`POST ${detailPath}/invocations`]: failure(500),
    [`POST ${detailPath}/rollback`]: rollbackAccepted,
    [`GET ${detailPath}`]: sequence(Response.json(action(1, 'synthetic-hello')), Response.json(action(1, 'synthetic-hello', state))),
  })
  open(); await select(); await openTab('Invocar')
  fireEvent.click(button(es.invoke.action)); await waitFor(() => expect(writes()).toHaveLength(1)); await screen.findByRole('alert')
  await openTab('Versiones'); fireEvent.click(button(es.versions.rollback)); await waitFor(() => expect(writes()).toHaveLength(2))
  await screen.findByTestId('functions-write-disabled'); await openTab('Invocar')
  expect(button(es.invoke.action)).toBeDisabled()
  expect(within(screen.getByTestId('functions-invoke')).queryByRole('button', { name: es.retry })).toBeNull()
  expect(writes()).toHaveLength(2)
})

test('the triggers tab lists each association, or the empty copy', async () => {
  setup(); open(); await select(); await openTab('Disparadores')
  const panel = screen.getByTestId('functions-triggers')
  for (const text of ['synthetic-orders · at least once · active', '*/5 * * * * · UTC · active', 'synthetic-bucket · created, deleted · active']) expect(panel).toHaveTextContent(text)
  expect(within(panel).getByRole('heading', { name: 'Kafka' })).toBeVisible()
})

test('the triggers tab shows the empty copy when the function has none', async () => {
  setup({ [`GET ${detailPath}`]: { ...action(1, 'synthetic-hello'), kafkaTriggers: [], cronTriggers: [], storageTriggers: [] } }); open(); await select(); await openTab('Disparadores')
  expect(screen.getByText(es.triggers.empty)).toBeVisible()
})

test('the catalogs carry the exact legacy es copy and the en oracle copy', () => {
  const legacy: [string, string][] = [
    ['inventory.empty', 'No hay funciones en esta área de trabajo.'], ['detail.empty', 'Selecciona una función del inventario para revisar su configuración, activaciones y operaciones disponibles.'],
    ['versions.empty', 'No hay versiones anteriores disponibles.'], ['versions.noneEligible', 'No hay versiones anteriores disponibles para revertir.'], ['activations.empty', 'Esta función no tiene activaciones registradas.'],
    ['activations.select', 'Selecciona una activación para ver metadatos, registros y resultado.'], ['activations.logsTruncated', 'Los registros están truncados. Se muestra el contenido disponible.'],
    ['activations.logsRunning', 'La activación sigue en curso. Los registros pueden no estar disponibles aún.'], ['activations.logsEmpty', 'No hay registros disponibles para esta activación.'],
    ['activations.resultBinary', 'El resultado no se puede mostrar en texto.'], ['activations.resultNone', 'Sin resultado disponible.'], ['activations.resultRunning', 'La activación sigue en curso. El resultado puede no estar disponible aún.'],
    ['triggers.empty', 'No hay asociaciones de disparadores configuradas para esta función.'], ['errors.limitsHint', 'Revisa límites o aplicación de límites antes de reintentar.'],
    ['errors.activationGone', 'Esta activación ya no está disponible.'], ['errors.logsForbidden', 'No tienes permisos para ver los registros de esta activación.'],
    ['errors.403', 'No tienes permiso para ver este recurso.'], ['errors.404', 'No se encontró el recurso solicitado.'], ['errors.429', 'Se alcanzó el límite de solicitudes; inténtalo de nuevo en unos momentos.'],
    ['errors.5xx', 'El servicio no está disponible en este momento.'], ['gate.orgRequired', 'Selecciona una organización para continuar.'], ['gate.description', 'Selecciona un área de trabajo para ver las funciones.'],
    ['form.required', 'Completa el nombre de acción, el entorno y el punto de entrada.'], ['form.pattern', 'El nombre de la función debe cumplir el patrón requerido.'],
    ['invoke.invalidObject', 'El payload debe ser un objeto JSON.'], ['invoke.invalidJson', 'El payload debe ser JSON válido.'],
    ['errors.inventory', 'No se pudo cargar el inventario de funciones.'], ['errors.detail', 'No se pudo cargar el detalle de la función.'], ['errors.versions', 'No se pudo cargar el historial de versiones.'],
    ['errors.activations', 'No se pudo cargar las activaciones.'], ['errors.activation', 'No se pudo cargar la activación.'], ['errors.logs', 'No se pudieron cargar los registros.'], ['errors.result', 'No se pudo cargar el resultado.'],
    ['errors.invoke', 'No se pudo invocar la función.'], ['errors.deploy', 'No se pudo desplegar la función.'], ['errors.rollback', 'No se pudo solicitar la reversión.'], ['errors.delete', 'No se pudo eliminar la función.'],
    ['write.provisioning', 'Las acciones de escritura están deshabilitadas mientras la función termina de aprovisionarse.'], ['write.degraded', 'Las acciones de escritura están deshabilitadas porque el aprovisionamiento de la función está degradado.'],
    ['write.suspended', 'Las acciones de escritura están deshabilitadas porque la función está suspendida.'], ['write.unavailable', 'Las acciones de escritura están deshabilitadas porque el runtime de Knative no está disponible.'],
    ['write.deletion_pending', 'Las acciones de escritura están deshabilitadas porque la eliminación de la función está pendiente de limpieza.'],
  ]
  const at = (catalog: unknown, path: string) => path.split('.').reduce<any>((node, key) => node[key], catalog)
  for (const [path, text] of legacy) expect(at(es, path), path).toBe(text)
  const oracle: [string, string][] = [
    ['inventory.empty', 'There are no functions in this workspace.'], ['detail.empty', 'Select a function from the inventory to review its configuration, activations and available operations.'],
    ['versions.empty', 'No previous versions are available.'], ['versions.noneEligible', 'No previous versions are available to roll back to.'], ['activations.empty', 'This function has no recorded activations.'],
    ['activations.select', 'Select an activation to view its metadata, logs and result.'], ['activations.logsTruncated', 'Logs are truncated. Showing the available content.'],
    ['activations.logsRunning', 'The activation is still running. Logs may not be available yet.'], ['activations.logsEmpty', 'No logs are available for this activation.'],
    ['activations.resultBinary', 'The result cannot be displayed as text.'], ['activations.resultNone', 'No result available.'], ['activations.resultRunning', 'The activation is still running. The result may not be available yet.'],
    ['triggers.empty', 'No trigger associations are configured for this function.'], ['errors.limitsHint', 'Review limits or limit enforcement before retrying.'],
    ['errors.activationGone', 'This activation is no longer available.'], ['errors.logsForbidden', 'You do not have permission to view the logs for this activation.'],
    ['errors.403', 'You do not have permission to view this resource.'], ['errors.404', 'The requested resource was not found.'], ['errors.429', 'The request limit was reached; try again in a few moments.'],
    ['errors.5xx', 'The service is unavailable right now.'], ['gate.orgRequired', 'Select an organization to continue.'], ['gate.description', 'Select a workspace to view functions.'],
    ['errors.inventory', 'Could not load the function inventory.'], ['errors.detail', 'Could not load the function detail.'], ['errors.versions', 'Could not load the version history.'], ['errors.activations', 'Could not load the activations.'],
    ['errors.activation', 'Could not load the activation.'], ['errors.logs', 'Could not load the logs.'], ['errors.result', 'Could not load the result.'], ['errors.invoke', 'Could not invoke the function.'],
    ['errors.deploy', 'Could not deploy the function.'], ['errors.rollback', 'Could not request the rollback.'], ['errors.delete', 'Could not delete the function.'],
  ]
  for (const [path, text] of oracle) expect(at(en, path), path).toBe(text)
})

test.each(['es', 'en'] as const)('the empty states render their copy in %s', async (locale) => {
  await i18n.changeLanguage(locale); const copy = locale === 'es' ? es : en
  setup({ [`GET ${versionsPath}`]: { items: [] }, [`GET ${activationsPath}`]: { items: [] }, [`GET ${activationPath()}`]: activationDetail }); open(); await select()
  await openTab(copy.tabs.versions); expect(screen.getByText(copy.versions.empty)).toBeVisible()
  await openTab(copy.tabs.activations); expect(await screen.findByText(copy.activations.empty)).toBeVisible(); expect(screen.getByText(copy.activations.select)).toBeVisible()
  await openTab(copy.tabs.triggers); expect(screen.getByTestId('functions-triggers')).toHaveTextContent('Kafka')
})

test.each(['es', 'en'] as const)('the gate states render their copy in %s and send no request', async (locale) => {
  await i18n.changeLanguage(locale); const copy = locale === 'es' ? es : en
  ctx({ activeTenantId: null, activeWorkspaceId: null }); requests = strictFetch({}); const view = open()
  expect(screen.getByRole('heading', { level: 2, name: copy.gate.orgRequired })).toBeVisible(); view.unmount()
  ctx({ activeTenantId: 'synthetic-tenant', activeWorkspaceId: null }); open()
  expect(screen.getByText(copy.gate.description)).toBeVisible(); expect(calls()).toEqual([])
})

test('the validation summary lists every missing required field, each linked to its field', async () => {
  setup(); open(); await ready(); fireEvent.click(screen.getAllByRole('button', { name: es.deploy })[0])
  // Save stays disabled on a clean form, so one optional field makes the draft dirty while every required one is empty.
  fireEvent.change(await screen.findByLabelText(es.form.inlineCode), { target: { value: 'exports.main = () => 1' } }); fireEvent.click(screen.getByRole('button', { name: es.form.create }))
  const summary = (await screen.findByText(es.form.validationTitle)).closest('section,div[role],[role]') as HTMLElement
  const links = within(summary).getAllByRole('link'); expect(links).toHaveLength(3)
  for (const link of links) expect(link).toHaveTextContent(es.form.required)
  fireEvent.click(links[0]); expect(document.activeElement).toBe(document.getElementById('functions-action-name'))
  fireEvent.click(links[1]); expect(document.activeElement).toBe(document.getElementById('functions-runtime'))
  fireEvent.click(links[2]); expect(document.activeElement).toBe(document.getElementById('functions-entrypoint'))
  expect(writes()).toEqual([])
})

test('an invalid name with a missing entrypoint reports both the pattern and the required message', async () => {
  setup(); open(); await ready(); fireEvent.click(screen.getAllByRole('button', { name: es.deploy })[0])
  fireEvent.change(await screen.findByLabelText(es.form.actionName), { target: { value: 'Bad Name' } }); fireEvent.click(screen.getByRole('button', { name: es.form.create }))
  const summary = (await screen.findByText(es.form.validationTitle)).closest('section,div[role],[role]') as HTMLElement
  expect(within(summary).getAllByRole('link').map((link) => link.textContent)).toEqual([es.form.required, es.form.required, es.form.pattern])
})

test('a failed detail keeps the inventory trigger associations instead of an empty state', async () => {
  setup({ [`GET ${detailPath}`]: failure(500) }); open(); await ready(); pick('synthetic-hello')
  await within_('functions-detail-pane').findByRole('alert'); await openTab('Disparadores')
  const panel = screen.getByTestId('functions-triggers')
  for (const text of ['synthetic-orders · at least once · active', '*/5 * * * * · UTC · active', 'synthetic-bucket · created, deleted · active']) expect(panel).toHaveTextContent(text)
  expect(screen.queryByText(es.triggers.empty)).toBeNull()
})

// Retry matrix for the writes not covered above: the failed attempt's key is resent, a success rotates it.
const createDraft = async () => {
  fireEvent.click(screen.getAllByRole('button', { name: es.deploy })[0])
  fireEvent.change(await screen.findByLabelText(es.form.actionName), { target: { value: 'synthetic-new' } }); fireEvent.change(field(es.form.entrypoint), { target: { value: 'main' } })
  fireEvent.click(screen.getByRole('combobox', { name: es.form.runtime })); await chooseOption('nodejs:20')
}
const created = () => ({ ...accepted(), resourceId: 'synthetic-function-4' })
const createReads = { [`GET ${actionPath(4)}`]: action(4, 'synthetic-new'), [`GET ${actionPath(4)}/versions${query}`]: { items: [] } }
const firstFailures = { http: failure(500), network: 'network' as const }

test.each(['http', 'network'] as const)('create retries after a %s failure with the same key, then mints a new one after the success', async (kind) => {
  setup({ ...createReads, [`POST ${createPath}`]: sequence(firstFailures[kind], Response.json(created()), Response.json(created())) }); open(); await ready()
  await createDraft(); fireEvent.click(screen.getByRole('button', { name: es.form.create })); await waitFor(() => expect(writes()).toHaveLength(1))
  const alert = await screen.findByRole('alert'); fireEvent.click(within(alert).getByRole('button', { name: es.retry })); await waitFor(() => expect(writes()).toHaveLength(2))
  expect(await screen.findByRole('heading', { name: 'synthetic-new', level: 2 })).toBeVisible()
  await createDraft(); fireEvent.click(screen.getByRole('button', { name: es.form.create })); await waitFor(() => expect(writes()).toHaveLength(3))
  expect(keys()[0]).toBeTruthy(); expect(keys()[0]).toBe(keys()[1]); expect(keys()[2]).not.toBe(keys()[1])
})

test('update retries after a network failure with the same key', async () => {
  setup({ [`PATCH ${detailPath}`]: sequence('network', Response.json(accepted()), Response.json(accepted())) }); open(); await update()
  fireEvent.change(field(es.form.entrypoint), { target: { value: 'main2' } }); fireEvent.click(screen.getByRole('button', { name: es.form.update }))
  const alert = await screen.findByRole('alert'); fireEvent.click(within(alert).getByRole('button', { name: es.retry })); await waitFor(() => expect(writes()).toHaveLength(2))
  await screen.findByTestId('functions-deploy-result'); await waitFor(() => expect(field(es.form.entrypoint)).toHaveValue('main'))
  fireEvent.change(field(es.form.entrypoint), { target: { value: 'main3' } }); fireEvent.click(screen.getByRole('button', { name: es.form.update })); await waitFor(() => expect(writes()).toHaveLength(3))
  expect(keys()[0]).toBe(keys()[1]); expect(keys()[2]).not.toBe(keys()[1])
})

test('rollback retries after a network failure with the same key and rotates it after the success', async () => {
  setup({ [`POST ${detailPath}/rollback`]: sequence('network', Response.json(rollbackAccepted), Response.json(rollbackAccepted)) }); open(); await select(); await openTab('Versiones')
  fireEvent.click(button(es.versions.rollback)); await waitFor(() => expect(writes()).toHaveLength(1)); const alert = await screen.findByRole('alert')
  fireEvent.click(within(alert).getByRole('button', { name: es.retry })); await waitFor(() => expect(writes()).toHaveLength(2)); await screen.findByTestId('functions-rollback-result')
  await waitFor(() => expect(button(es.versions.rollback)).toBeEnabled()); fireEvent.click(button(es.versions.rollback)); await waitFor(() => expect(writes()).toHaveLength(3))
  expect(keys()[0]).toBe(keys()[1]); expect(keys()[2]).not.toBe(keys()[1])
})

test('invoke mints a new key for the submit that follows a success after a network failure', async () => {
  setup({ [`POST ${detailPath}/invocations`]: sequence('network', Response.json(invocation), Response.json(invocation)) }); open(); await select(); await openTab('Invocar')
  fireEvent.click(button(es.invoke.action)); await screen.findByText(es.errors.invoke); fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: es.retry })); await waitFor(() => expect(writes()).toHaveLength(2))
  await waitFor(() => expect(tab('Activaciones')).toHaveAttribute('aria-selected', 'true')); await openTab('Invocar'); fireEvent.click(button(es.invoke.action)); await waitFor(() => expect(writes()).toHaveLength(3))
  expect(keys()[0]).toBe(keys()[1]); expect(keys()[2]).not.toBe(keys()[1])
})

test.each(['http', 'network'] as const)('delete retries after a %s failure with the same key, and the next delete after the success gets a new one', async (kind) => {
  setup({ [`DELETE ${detailPath}`]: sequence(firstFailures[kind], Response.json(accepted()), Response.json(accepted())) }); open(); await select()
  let { input, confirm } = await typedDelete(); fireEvent.change(input, { target: { value: 'synthetic-hello' } }); fireEvent.click(confirm)
  const panel = await within(screen.getByRole('alertdialog')).findByRole('alert'); fireEvent.click(within(panel).getByRole('button', { name: es.retry })); await waitFor(() => expect(writes()).toHaveLength(2))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); await select()
  ;({ input, confirm } = await typedDelete()); fireEvent.change(input, { target: { value: 'synthetic-hello' } }); fireEvent.click(confirm); await waitFor(() => expect(writes()).toHaveLength(3))
  expect(keys()[0]).toBeTruthy(); expect(keys()[0]).toBe(keys()[1]); expect(keys()[2]).not.toBe(keys()[1])
})

test('unused request helpers stay referenced', () => { expect([createPath, accepted(), act]).toHaveLength(3) })
