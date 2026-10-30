import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import ConsoleFlowsPage from '../src/pages/consoleFlows'
import { createFlowDraft, designerNavigation, flowsPath as pathFor, listFlows, triggerFlowSchedule } from '../src/pages/consoleFlows/api'
import { flowRows, flowsPath, triggerPath } from './parity/pages/console-flows-page.manifest'
import { login, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-flows-page.json'
import en from '../src/locales/en/pages.console-flows-page.json'
const context = vi.hoisted(() => ({ value: {} as Record<string, unknown>, roles: ['superadmin'] }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => getConsolePermissions(context.roles) }))
let requests: ReturnType<typeof strictFetch>
const calls = () => requests.mock.mock.calls.map(([url, init]) => ({ method: init?.method, path: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined }))
function setup(routes: Record<string, unknown> = {}) { requests = strictFetch({ [`GET ${flowsPath}`]: flowRows, ...routes }) }
function Probe() { const location = useLocation(); return <output data-testid="location">{JSON.stringify(location)}</output> }
function open() { return render(<StrictMode><MemoryRouter initialEntries={['/console/flows']}><ConsoleFlowsPage /><Probe /></MemoryRouter></StrictMode>) }
async function ready() { await screen.findByTitle(flowRows.items[0].name) }
async function confirm() { fireEvent.click(screen.getByRole('button', { name: 'Ejecutar ahora Synthetic published flow' })); const dialog = await screen.findByRole('alertdialog'); fireEvent.click(within(dialog).getByRole('button', { name: es.run })) }
beforeEach(() => { login(); context.roles = ['superadmin']; context.value = { activeWorkspaceId: 'synthetic-workspace', loading: false, error: null, workspaces: [], selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn() } })
afterEach(() => requests?.verify())

test.each(['es', 'en'] as const)('renders all unpaged flows and localized controls in %s without a capability gate', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open(); await ready()
  const copy = locale === 'es' ? es : en
  expect(calls()).toEqual([{ method: 'GET', path: flowsPath, body: undefined }])
  expect(screen.getByRole('heading', { name: copy.title })).toBeVisible()
  expect(screen.getAllByRole('rowheader')).toHaveLength(2)
  expect(screen.getByRole('table')).toHaveTextContent(copy.status.published)
  expect(screen.getByRole('table')).toHaveTextContent(copy.status.draft)
  expect(screen.getAllByRole('group', { name: /Synthetic/ })).toHaveLength(2)
  expect(screen.getByLabelText(copy.newName)).toBeVisible()
  expect(screen.getByRole('link', { name: i18n.t('designerNamed', { ns: 'pages.console-flows-page', name: flowRows.items[1].name }) })).toHaveAttribute('href', '/console/flows/draft%2F1')
  const dates = screen.getByRole('table').querySelectorAll('time')
  expect(dates[0]).toHaveAttribute('datetime', new Date(flowRows.items[0].updatedAt!).toISOString())
  expect(dates[1]).toHaveAttribute('datetime', new Date(flowRows.items[1].createdAt!).toISOString())
  expect(document.documentElement.lang).toBe(locale)
})

test('create is click-only, trims its body and sends once while pending before a legacy document load', async () => {
  let resolve!: (response: Response) => void
  const assign = vi.spyOn(designerNavigation, 'assign').mockImplementation(() => {})
  setup({ [`POST ${flowsPath}`]: () => new Promise<Response>((done) => { resolve = done }) }); open(); await ready()
  const input = screen.getByLabelText(es.newName), create = screen.getByRole('button', { name: es.create })
  expect(create).toBeDisabled(); fireEvent.change(input, { target: { value: '  Trimmed  ' } })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' }); expect(calls()).toHaveLength(1)
  fireEvent.click(create); fireEvent.click(create)
  await waitFor(() => expect(calls()).toHaveLength(2)); expect(create).toBeDisabled()
  expect(calls()[1]).toEqual({ method: 'POST', path: flowsPath, body: { name: 'Trimmed' } })
  await act(async () => resolve(Response.json({ flowId: 'created/1' })))
  expect(assign).toHaveBeenCalledExactlyOnceWith('/console/flows/created%2F1')
  expect(screen.queryByText('Borrador creado')).toBeNull()
})

test.each([403, 404, 409, 429, 500, 502, 418, 'network'] as const)('create %s retains the name and announces a localized failure', async (status) => {
  setup({ [`POST ${flowsPath}`]: () => { if (status === 'network') throw new TypeError('Raw transport failure'); return Response.json({ message: 'Raw backend failure' }, { status }) } }); open(); await ready()
  fireEvent.change(screen.getByLabelText(es.newName), { target: { value: 'Keep this name' } }); fireEvent.click(screen.getByRole('button', { name: es.create }))
  const expected = status === 403 ? es.createDenied : typeof status === 'number' && status >= 500 ? es.errors.server : [404, 409, 429].includes(Number(status)) ? es.errors[String(status) as '404'] : es.createError
  await waitFor(() => expect(document.body).toHaveTextContent(expected))
  expect(screen.getByLabelText(es.newName)).toHaveValue('Keep this name')
  expect(screen.getByRole('button', { name: es.create })).toBeEnabled()
  await waitFor(() => expect([...document.querySelectorAll('[aria-live="assertive"], [role="alert"]')].filter((region) => region.textContent?.includes(expected))).toHaveLength(1))
  expect(screen.queryByText('Raw backend failure')).toBeNull()
  if (status === 403) expect(screen.getByText(es.restricted)).toBeVisible()
})

test.each(['tenant_viewer', 'workspace_viewer', 'tenant_developer'])('read-only %s hides create and renders the no-CTA empty state and role reason', async (role) => {
  context.roles = [role]; setup({ [`GET ${flowsPath}`]: { items: [] } }); open()
  await screen.findByRole('heading', { name: es.empty })
  expect(screen.queryByLabelText(es.newName)).toBeNull()
  expect(screen.queryByRole('button', { name: es.emptyAction })).toBeNull()
  expect(screen.getByText(es.emptyReadOnly)).toBeVisible()
  expect(screen.getByTestId('flows-read-only-indicator')).toHaveAttribute('title', getConsolePermissions([role]).denyReason('workspace.write'))
})

test('the writer empty action focuses the name field and does not send a request', async () => {
  setup({ [`GET ${flowsPath}`]: { items: [] } }); open(); fireEvent.click(await screen.findByRole('button', { name: es.emptyAction }))
  expect(screen.getByLabelText(es.newName)).toHaveFocus(); expect(calls()).toHaveLength(1)
})

test.each([403, 404, 500, 'network'] as const)('list %s renders the approved state with diagnostics and no stale table', async (status) => {
  let attempt = 0
  setup({ [`GET ${flowsPath}`]: () => { if (++attempt > 1) return Response.json(flowRows); if (status === 'network') throw new TypeError('Do not display'); return Response.json({ message: 'synthetic-backend-reason', requestId: 'req_synthetic_flows' }, { status }) } }); open()
  await screen.findByRole('heading', { name: status === 403 ? es.noAccess : status === 404 ? es.notFound : es.errorTitle })
  expect(screen.queryByRole('table')).toBeNull()
  if (status === 403) { expect(screen.getByText('synthetic-backend-reason')).toBeVisible(); expect(screen.queryByRole('button', { name: /Solicitar acceso/ })).toBeNull() }
  if (status === 404) expect(screen.getByRole('link', { name: es.backWorkspaces })).toHaveAttribute('href', '/console/workspaces')
  if (status === 500) { expect(screen.getByText('500')).toBeVisible(); expect(screen.getByText('req_synthetic_flows')).toBeVisible() }
  if (status === 500 || status === 'network') { fireEvent.click(screen.getByRole('button', { name: es.retry })); await ready(); expect(calls()).toHaveLength(2) }
})

test('loading uses a labelled skeleton and one request even under StrictMode', async () => {
  setup({ [`GET ${flowsPath}`]: () => new Promise<Response>(() => {}) }); open()
  expect(screen.getByRole('status', { name: es.loading })).toBeVisible()
  await waitFor(() => expect(calls()).toHaveLength(1))
})

test('run-now describes draft disablement, confirms once and navigates with trigger state', async () => {
  setup({ [`POST ${triggerPath}`]: { status: 'triggered', scheduleId: 'synthetic-schedule' } }); open(); await ready()
  const draft = screen.getByRole('button', { name: /Ejecutar ahora no disponible/ })
  expect(draft).toBeDisabled(); expect(draft).toHaveAttribute('title', es.disabledReason)
  expect(document.getElementById(draft.getAttribute('aria-describedby')!)).toHaveTextContent(es.disabledReason)
  fireEvent.click(screen.getByRole('button', { name: 'Ejecutar ahora Synthetic published flow' }))
  expect(calls()).toHaveLength(1)
  const dialog = await screen.findByRole('alertdialog'); fireEvent.click(within(dialog).getByRole('button', { name: es.run })); fireEvent.click(within(dialog).getByRole('button', { name: es.run }))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('synthetic-schedule'))
  const location = JSON.parse(screen.getByTestId('location').textContent!)
  expect(location.pathname).toBe('/console/flows/f1/runs'); expect(location.state.flowTrigger).toEqual({ flowId: 'f1', scheduleId: 'synthetic-schedule', triggeredAt: expect.any(String) })
  expect(calls()[1]).toEqual({ method: 'POST', path: triggerPath, body: undefined }); expect(calls()).toHaveLength(2)
})

test('cancel restores focus to the run button without triggering', async () => {
  setup(); open(); await ready()
  const trigger = screen.getByRole('button', { name: 'Ejecutar ahora Synthetic published flow' }); trigger.focus(); fireEvent.click(trigger)
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: es.cancel }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); await waitFor(() => expect(trigger).toHaveFocus()); expect(calls()).toHaveLength(1)
})

test.each(['server', 'fallback', 'network'])('trigger %s failure stays inline and is announced', async (variant) => {
  setup({ [`POST ${triggerPath}`]: () => { if (variant === 'network') throw new TypeError('Raw network'); return Response.json(variant === 'server' ? { message: 'Server trigger reason' } : {}, { status: 500 }) } }); open(); await ready(); await confirm()
  const expected = variant === 'server' ? 'Server trigger reason' : variant === 'network' ? es.triggerError : es.errors.server
  expect(await screen.findByTestId('flow-run-now-error')).toHaveTextContent(expected)
  await waitFor(() => expect([...document.querySelectorAll('[aria-live="assertive"], [role="alert"]')].filter((region) => region.textContent?.includes(expected))).toHaveLength(1))
  expect(screen.getByTestId('location')).toHaveTextContent('/console/flows"')
})

test.each(['loading', 'error', 'picker', 'create', 'denied'])('workspace %s sends no flows request', async (state) => {
  setup(); context.value.activeWorkspaceId = null; context.value.loading = state === 'loading'; context.value.error = state === 'error' ? { status: 500 } : null
  context.value.workspaces = state === 'picker' ? [{ workspaceId: 'synthetic-workspace', displayName: 'Synthetic Workspace' }] : []; context.roles = state === 'denied' ? ['tenant_viewer'] : ['superadmin']
  open()
  if (state === 'loading') expect(screen.getByRole('status', { name: es.workspaceLoading })).toBeVisible()
  if (state === 'error') { fireEvent.click(screen.getByRole('button', { name: es.retry })); expect(context.value.reloadWorkspaces).toHaveBeenCalledTimes(1) }
  if (state === 'picker') { fireEvent.click(screen.getByRole('combobox', { name: es.workspaceLabel })); const option = await screen.findByRole('option', { name: 'Synthetic Workspace' }); fireEvent.pointerDown(option); fireEvent.click(option); expect(context.value.selectWorkspace).toHaveBeenCalledWith('synthetic-workspace') }
  if (state === 'create') expect(screen.getByRole('link', { name: es.createWorkspace })).toHaveAttribute('href', '/console/workspaces')
  if (state === 'denied') expect(screen.getByText(es.workspaceDenied)).toBeVisible()
  expect(screen.queryByRole('heading', { name: es.notFound })).toBeNull(); expect(calls()).toEqual([])
})

test('the extracted legacy client and migrated client send identical methods, encoded paths and bodies', async () => {
  // Keep the legacy app’s path aliases outside this app’s TypeScript program.
  const legacyPath = new URL('../../web-console/src/services/flowsApi.ts', import.meta.url).pathname
  const legacy = await import(/* @vite-ignore */ legacyPath)
  const path = pathFor('ws/1'), trigger = `${path}/f%2F1/schedule/trigger`
  setup({ [`GET ${path}`]: flowRows, [`POST ${path}`]: { flowId: 'f1' }, [`POST ${trigger}`]: { status: 'triggered', scheduleId: 'schedule' } })
  await legacy.listFlows('ws/1'); await listFlows('ws/1')
  await legacy.createFlowDraft('ws/1', { name: 'Trimmed' }); await createFlowDraft('ws/1', 'Trimmed')
  await legacy.triggerFlowSchedule('ws/1', 'f/1'); await triggerFlowSchedule('ws/1', 'f/1')
  for (let index = 0; index < 6; index += 2) expect(calls()[index]).toEqual(calls()[index + 1])
})

test('missing names and statuses use legacy fallbacks while unknown statuses and invalid dates remain data', async () => {
  setup({ [`GET ${flowsPath}`]: { items: [
    { flowId: 'synthetic-unnamed', name: '', createdAt: 'invalid-date' },
    { flowId: 'synthetic-unknown', name: 'Unknown status', status: 'NewBackendStatus' },
  ] } }); open()
  expect(await screen.findByRole('rowheader', { name: 'synthetic-unnamed' })).toBeVisible()
  expect(screen.getByRole('table')).toHaveTextContent(es.status.draft)
  expect(screen.getByRole('table')).toHaveTextContent('NewBackendStatus')
  expect(screen.getByRole('table')).toHaveTextContent('invalid-date')
})
