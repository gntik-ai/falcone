import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import ConsoleFunctionRegistryPage from '../src/pages/consoleFunctionRegistry'
import { functionRows, functionRows4, functionsPath, functionFixtures } from './parity/pages/console-function-registry-page.manifest'
import { login, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-function-registry-page.json'
import en from '../src/locales/en/pages.console-function-registry-page.json'
const context = vi.hoisted(() => ({ value: {} as Record<string, unknown>, roles: ['superadmin'] }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => getConsolePermissions(context.roles) }))
let requests: ReturnType<typeof strictFetch>
const calls = () => requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method, path: String(path), body: init?.body ? JSON.parse(String(init.body)) : undefined }))
function setup(routes: Record<string, unknown> = {}) { requests = strictFetch({ [`GET ${functionsPath}`]: functionRows, ...routes }) }
function open() { return render(<StrictMode><MemoryRouter><ConsoleFunctionRegistryPage /></MemoryRouter></StrictMode>) }
const field = (label: string) => screen.getByRole('textbox', { name: label })
function form() { return field(es.name).closest('form')! }
async function ready() { await screen.findByRole('table') }
const change = (label: string, value: string) => fireEvent.change(field(label), { target: { value } })
const send = () => fireEvent.submit(form())
const legacyWorkspaceCopy = {
  es: {
    loading: 'Cargando áreas de trabajo',
    loadingDescription: 'Consultando las áreas de trabajo accesibles de la organización activa.',
    label: 'Seleccionar área de trabajo',
    placeholder: 'Selecciona un área de trabajo…',
    denied: 'Esta organización todavía no tiene áreas de trabajo. Pide a un propietario o administrador de la organización (o del área de trabajo) que cree la primera.',
  },
  en: {
    loading: 'Loading workspaces',
    loadingDescription: 'Loading accessible workspaces for the active organization.',
    label: 'Select workspace',
    placeholder: 'Select a workspace…',
    denied: 'This organization has no workspaces yet. Ask an organization or workspace owner or administrator to create the first one.',
  },
}
beforeEach(() => {
  login(); context.roles = ['superadmin']
  context.value = { activeWorkspaceId: 'synthetic-workspace', loading: false, error: null, workspaces: [{ workspaceId: 'synthetic-workspace', displayName: 'Synthetic Workspace' }], selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn() }
})
afterEach(() => requests?.verify())

test.each(['es', 'en'] as const)('renders every raw data value and kit fields in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open(); await ready(); const copy = locale === 'es' ? es : en
  expect(screen.getByRole('heading', { name: copy.title })).toBeVisible()
  expect(screen.getByText('Synthetic Workspace')).toBeVisible()
  for (const fn of functionRows.items) {
    const row = screen.getByText(fn.name).closest('tr')!
    for (const value of [fn.runtime, fn.handler ?? 'main', fn.status, fn.runtime_status]) expect(row).toHaveTextContent(value)
  }
  for (const label of [copy.name, copy.runtime, copy.handler]) expect(field(label).parentElement).toHaveClass('border-border', 'rounded-md')
  expect(screen.queryByText('Deployments')).toBeNull()
  expect(calls()).toEqual([{ method: 'GET', path: functionsPath, body: undefined }])
})

test.each(['default', 'empty', 'trimmed'])('registration sends the legacy %s payload then refetches, clears and focuses the name', async (variant) => {
  let count = 0
  setup({ [`GET ${functionsPath}`]: () => Response.json(++count === 1 ? functionRows : functionRows4), [`POST ${functionsPath}`]: functionFixtures['register-accepted'].body })
  open(); await ready(); change(es.name, '  on-user-created  ')
  if (variant !== 'default') { change(es.runtime, variant === 'empty' ? '' : ' nodejs:20 '); change(es.handler, variant === 'empty' ? '' : ' main ') }
  send(); await screen.findByText('on-user-created')
  expect(calls()).toEqual([{ method: 'GET', path: functionsPath, body: undefined }, { method: 'POST', path: functionsPath, body: { name: 'on-user-created', runtime: 'nodejs:20', handler: 'main' } }, { method: 'GET', path: functionsPath, body: undefined }])
  expect(field(es.name)).toHaveValue(''); expect(field(es.name)).toHaveFocus()
  await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(es.registered))
  expect(document.body).toHaveTextContent(es.registered)
})

test('registration stays busy through held POST and held GET while standalone GET allows submit', async () => {
  let finishPost!: (response: Response) => void, finishGet!: (response: Response) => void
  let count = 0
  setup({ [`GET ${functionsPath}`]: () => ++count === 1 ? Response.json(functionRows) : new Promise<Response>((done) => { finishGet = done }), [`POST ${functionsPath}`]: () => new Promise<Response>((done) => { finishPost = done }) })
  open(); await ready(); change(es.name, 'on-user-created'); send()
  change(es.name, 'during-post'); expect(within(form()).getByRole('button', { name: es.registering })).toBeDisabled()
  await waitFor(() => expect(calls()).toHaveLength(2))
  await act(async () => finishPost(Response.json(functionFixtures['register-accepted'].body)))
  await waitFor(() => expect(calls()).toHaveLength(3))
  change(es.name, 'during-refetch'); expect(within(form()).getByRole('button', { name: es.registering })).toBeDisabled()
  send(); expect(calls()).toHaveLength(3)
  await act(async () => finishGet(Response.json(functionRows4)))
  expect(within(form()).getByRole('button', { name: es.register })).toBeEnabled(); expect(field(es.name)).toHaveValue('during-refetch')
})

test.each(['initial', 'retry'])('standalone %s loading enables submission only for a trimmed name', async (variant) => {
  let count = 0
  setup({ [`GET ${functionsPath}`]: () => ++count === 1 && variant === 'retry' ? Promise.resolve(Response.json({}, { status: 500 })) : new Promise<Response>(() => {}) })
  open()
  if (variant === 'retry') fireEvent.click(await screen.findByRole('button', { name: es.retry }))
  expect(within(form()).getByRole('button')).toBeDisabled(); change(es.name, '   '); expect(within(form()).getByRole('button')).toBeDisabled()
  change(es.name, 'new-function'); expect(within(form()).getByRole('button')).toBeEnabled()
  expect(document.querySelector('[aria-busy="true"]')).toBeVisible()
})

for (const locale of ['es', 'en'] as const) test.each(['list-empty', 'list-403', 'list-404', 'list-500', 'list-network', 'list-pending'])(`renders %s in ${locale} with recovery and no stale list`, async (variant) => {
  await i18n.changeLanguage(locale); const copy = locale === 'es' ? es : en, fixture = functionFixtures[variant]
  setup({ [`GET ${functionsPath}`]: () => { if (variant === 'list-pending') return new Promise<Response>(() => {}); if (fixture.network) throw new TypeError('Synthetic network failure'); return Response.json(fixture.body, { status: fixture.status ?? 200 }) } }); open()
  if (variant === 'list-pending') await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeVisible())
  else if (variant === 'list-empty') { expect(await screen.findByText(copy.empty)).toBeVisible(); expect(field(copy.name)).toBeVisible() }
  else {
    await screen.findByRole('heading', { name: variant === 'list-403' ? copy.noAccess : variant === 'list-404' ? copy.notFound : copy.listError })
    if (variant === 'list-403') expect(screen.queryByRole('textbox', { name: copy.name })).toBeNull()
    if (variant === 'list-404') expect(screen.getByRole('link', { name: copy.backOverview })).toHaveAttribute('href', '/console/overview')
    if (variant === 'list-500') expect(screen.getByText('req_synthetic_functions')).toBeVisible()
    if (['list-500', 'list-network'].includes(variant)) expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
  }
  expect(screen.queryByRole('table')).toBeNull()
})

test.each(['register-500', 'register-network'])('%s retains all values, focuses retry and retries the exact body', async (variant) => {
  let count = 0
  setup({ [`POST ${functionsPath}`]: () => { if (++count > 1) return Response.json(functionFixtures['register-accepted'].body); if (variant === 'register-network') throw new TypeError('Synthetic network failure'); return Response.json(functionFixtures[variant].body, { status: 500 }) } })
  open(); await ready(); change(es.name, 'billing-sync'); change(es.runtime, 'nodejs:18'); change(es.handler, 'run'); send()
  const heading = await screen.findByRole('heading', { name: es.registerError })
  const retry = screen.getByRole('button', { name: es.retry }); expect(retry).toHaveFocus()
  expect(form().parentElement).toContainElement(heading)
  for (const [label, value] of [[es.name, 'billing-sync'], [es.runtime, 'nodejs:18'], [es.handler, 'run']]) expect(field(label)).toHaveValue(value)
  await waitFor(() => expect(document.querySelector('[aria-live="assertive"]')).toHaveTextContent(es.registerError))
  if (variant === 'register-500') expect(screen.getByText('req_synthetic_register')).toBeVisible()
  fireEvent.click(retry); await waitFor(() => expect(field(es.name)).toHaveValue('')); await waitFor(() => expect(field(es.name)).toHaveFocus())
  expect(calls().filter((call) => call.method === 'POST')).toEqual(Array(2).fill({ method: 'POST', path: functionsPath, body: { name: 'billing-sync', runtime: 'nodejs:18', handler: 'run' } }))
  expect(calls().map((call) => call.method)).toEqual(['GET', 'POST', 'POST', 'GET'])
})

test('a failed refetch clears the previously loaded list and releases registration busy', async () => {
  let count = 0
  setup({ [`GET ${functionsPath}`]: () => ++count === 1 ? Response.json(functionRows) : Promise.reject(new TypeError('Synthetic failure')), [`POST ${functionsPath}`]: functionFixtures['register-accepted'].body })
  open(); await ready(); change(es.name, 'on-user-created'); send(); await screen.findByRole('heading', { name: es.listError })
  expect(screen.queryByRole('table')).toBeNull(); change(es.name, 'next'); expect(within(form()).getByRole('button', { name: es.register })).toBeEnabled()
})

test('list retry and toolbar focus send only their intended requests', async () => {
  let count = 0
  setup({ [`GET ${functionsPath}`]: () => ++count === 1 ? Response.json({}, { status: 500 }) : Response.json(functionRows) }); open()
  fireEvent.click(await screen.findByRole('button', { name: es.retry })); await ready()
  fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: es.register })); expect(field(es.name)).toHaveFocus()
  expect(calls().map((call) => call.method)).toEqual(['GET', 'GET'])
})

for (const locale of ['es', 'en'] as const) test.each(['loading', 'error', 'picker', 'create', 'denied'])(`workspace %s in ${locale} sends no functions request`, async (state) => {
  await i18n.changeLanguage(locale); const copy = locale === 'es' ? es : en
  const workspaceCopy = legacyWorkspaceCopy[locale]
  setup(); context.value.activeWorkspaceId = null; context.value.loading = state === 'loading'; context.value.error = state === 'error' ? { status: 500 } : null
  context.value.workspaces = state === 'picker' ? [{ workspaceId: 'synthetic-workspace', displayName: 'Synthetic Workspace' }] : []; context.roles = state === 'denied' ? ['tenant_viewer'] : ['superadmin']; open()
  if (state === 'loading') {
    const status = screen.getByRole('status', { name: workspaceCopy.loading })
    expect(within(status).getByText(workspaceCopy.loading, { exact: true })).toBeVisible()
    expect(within(status).getByText(workspaceCopy.loadingDescription, { selector: 'p' })).toBeVisible()
  }
  if (state === 'error') { fireEvent.click(screen.getByRole('button', { name: copy.retry })); expect(context.value.reloadWorkspaces).toHaveBeenCalledTimes(1) }
  if (state === 'picker') {
    const picker = screen.getByRole('combobox', { name: workspaceCopy.label })
    expect(picker).toHaveTextContent(workspaceCopy.placeholder)
    fireEvent.click(picker); const option = await screen.findByRole('option', { name: 'Synthetic Workspace' }); fireEvent.pointerDown(option); fireEvent.click(option); expect(context.value.selectWorkspace).toHaveBeenCalledWith('synthetic-workspace')
  }
  if (state === 'create') expect(screen.getByRole('link', { name: copy.createWorkspace })).toHaveAttribute('href', '/console/workspaces')
  if (state === 'denied') expect(screen.getByText(workspaceCopy.denied)).toBeVisible()
  expect(screen.queryByRole('textbox', { name: copy.name })).toBeNull(); expect(calls()).toEqual([])
})

test('encodes workspace identifiers and registers for any authenticated role', async () => {
  context.roles = ['tenant_viewer']; context.value.activeWorkspaceId = 'synthetic/workspace'
  const path = '/v1/workspaces/synthetic%2Fworkspace/functions'
  setup({ [`GET ${path}`]: functionRows, [`POST ${path}`]: {} }); open(); await ready(); change(es.name, 'allowed'); send()
  await waitFor(() => expect(calls()).toHaveLength(3)); expect(calls()[1]).toEqual({ method: 'POST', path, body: { name: 'allowed', runtime: 'nodejs:20', handler: 'main' } })
})

test('Spanish interface copy has no English labels, untranslated keys or kit samples', async () => {
  setup(); open(); await ready()
  const page = screen.getByTestId('console-function-registry-page')
  const forbidden = Object.entries(en).filter(([key, value]) => value !== es[key as keyof typeof es] && !value.includes('{')).map(([, value]) => value)
  const values = [...page.querySelectorAll('*')].flatMap((element) => [
    ...['aria-label', 'title', 'placeholder'].map((attribute) => element.getAttribute(attribute) ?? ''),
    ...[...element.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent?.trim() ?? ''),
  ])
  expect(values.filter((value) => forbidden.includes(value) || /pages\.console-function-registry-page\./.test(value))).toEqual([])
  for (const sample of ['Deployments', 'New project', 'Search projects…', 'req_8f2c41d07a9b']) expect(page).not.toHaveTextContent(sample)
  expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
})
