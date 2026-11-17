import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConsoleFlowRunPage from '../src/pages/consoleFlowRun'
import { PAYLOAD_DISPLAY_CAP, renderCappedPayload } from '../src/pages/consoleFlowRun/status'
import { cancelPath, executionPath, executionVariants, eventsPath, flowPath, flowRecord, retryPath, signalPath, sse } from './parity/pages/console-flow-run-page.manifest'
import { animations, canvas, sseResponse, xyflowStub } from './consoleFlowRun-support'
import { login, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-flow-run-page.json'
import en from '../src/locales/en/pages.console-flow-run-page.json'

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => ({ can: () => false }) }))
vi.mock('@xyflow/react', async (original) => (await import('./consoleFlowRun-support')).xyflowStub(await original<typeof import('@xyflow/react')>()))

let requests: ReturnType<typeof strictFetch>
const calls = () => requests.mock.mock.calls.map(([url, init]) => ({ path: String(url), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }))
const count = (path: string, method = 'GET') => calls().filter((call) => call.path === path && call.method === method).length
function setup(variant: keyof typeof executionVariants = 'completed', routes: Record<string, unknown> = {}) {
  requests = strictFetch({ [`GET ${flowPath}`]: flowRecord, [`GET ${executionPath}`]: executionVariants[variant], ...routes })
}
function Probe() { const location = useLocation(); return <output data-testid="location">{location.pathname}</output> }
function open(path = '/console/flows/f1/runs/e1') {
  return render(<StrictMode><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/console/flows/:flowId/runs/:executionId" element={<><ConsoleFlowRunPage /><Probe /></>} />
    <Route path="/missing" element={<ConsoleFlowRunPage />} />
  </Routes></MemoryRouter></StrictMode>)
}
const node = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!
async function ready() { await screen.findByTestId('react-flow-stub') }
beforeEach(() => {
  animations(); login()
  context.value = { activeWorkspaceId: 'synthetic-workspace', loading: false, error: null, workspaces: [], selectWorkspace: vi.fn() }
})
afterEach(() => requests?.verify())

test.each(['es', 'en'] as const)('renders a completed run statically with its persisted statuses in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open(); await ready()
  const copy = locale === 'es' ? es : en
  expect(calls().map(({ method, path }) => `${method} ${path}`).sort()).toEqual([`GET ${flowPath}`, `GET ${executionPath}`].sort())
  expect(screen.getByRole('heading', { name: 'Synthetic flow' })).toBeVisible()
  expect(screen.getByTestId('run-status-badge')).toHaveTextContent(copy.status.Completed)
  expect(screen.getByTestId('run-static-indicator')).toHaveTextContent(copy.staticIndicator)
  expect(screen.queryByTestId('run-streaming-indicator')).toBeNull()
  expect(screen.queryByTestId('run-apikey-input')).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(count(eventsPath)).toBe(0)
  expect(node('start')).toHaveAccessibleName(`${copy.nodeTypes.task}: synthetic-task, ${locale === 'es' ? 'estado' : 'status'} ${copy.nodeStatus.completed}`)
  expect(within(node('start')).getByTestId('node-status-badge')).toHaveTextContent(copy.nodeStatus.completed)
  expect(screen.getByRole('link', { name: copy.flows })).toHaveAttribute('href', '/console/flows')
  expect(screen.getByRole('link', { name: copy.runs })).toHaveAttribute('href', '/console/flows/f1/runs')
  expect(canvas.ariaLabelConfig).toMatchObject({ 'controls.ariaLabel': copy.controls.ariaLabel, 'controls.zoomIn.ariaLabel': copy.zoomIn, 'controls.fitView.ariaLabel': copy.fitView })
})

test('selecting a node shows its payloads in code-blocks, its attempts in a timeline, and moves focus to the heading', async () => {
  setup('failed'); open(); await ready()
  fireEvent.click(node('done'))
  const heading = await screen.findByRole('heading', { name: 'done' })
  await waitFor(() => expect(heading).toHaveFocus())
  const panel = screen.getByTestId('run-node-detail-panel')
  expect(within(screen.getByTestId('run-node-error')).getByText('synthetic failure')).toBeVisible()
  expect(within(screen.getByTestId('run-node-error')).getByRole('region', { name: es.stack })).toHaveTextContent('Error: synthetic failure')
  const attempts = within(screen.getByTestId('run-node-attempts')).getByRole('list', { name: es.attempts })
  expect(within(attempts).getAllByRole('listitem')).toHaveLength(1)
  expect(within(panel).getByTestId('run-node-entrada-empty')).toHaveTextContent(es.payloadEmpty.replace('{name}', es.input))
  fireEvent.click(node('start'))
  await screen.findByRole('heading', { name: 'start' })
  expect(within(screen.getByTestId('run-node-payload-entrada')).getByRole('region', { name: es.input })).toHaveTextContent('"synthetic": "input"')
  expect(within(screen.getByTestId('run-node-payload-salida')).getByRole('region', { name: es.output })).toHaveTextContent('"synthetic": "output"')
  expect(within(screen.getByTestId('run-node-attempts')).getAllByRole('listitem')).toHaveLength(2)
  expect(screen.queryByTestId('run-node-entrada-truncated')).toBeNull()
})

test.each([['payload-4095', false], ['payload-4096', false], ['payload-4097', true]] as const)('the display cap at %s truncates only past 4096 characters', async (variant, truncated) => {
  setup(variant); open(); await ready(); fireEvent.click(node('start')); await screen.findByRole('heading', { name: 'start' })
  const output = screen.getByTestId('run-node-payload-salida')
  const full = JSON.stringify(executionVariants[variant].nodes![0].output, null, 2)
  expect(full.length).toBe(Number(variant.slice(-4)))
  const text = Array.from(output.querySelectorAll('[data-line]')).map((line) => line.textContent).join('\n')
  if (truncated) {
    expect(text).toBe(`${full.slice(0, PAYLOAD_DISPLAY_CAP)}…`)
    expect(screen.getByTestId('run-node-salida-truncated')).toHaveTextContent(es.truncated)
    expect(within(output).getByRole('region', { name: es.payloadTruncated.replace('{name}', es.output) })).toBeVisible()
  } else {
    expect(text).toBe(full); expect(screen.queryByTestId('run-node-salida-truncated')).toBeNull()
  }
  expect(screen.queryByTestId('run-node-entrada-truncated')).toBeNull()
})

test('the truncation badge is translated and the full payload stays in memory', async () => {
  await i18n.changeLanguage('en'); setup('payload-4097'); open(); await ready(); fireEvent.click(node('start'))
  expect(await screen.findByTestId('run-node-salida-truncated')).toHaveTextContent('truncated · 4 KB display limit')
  const value = executionVariants['payload-4097'].nodes![0].output as { value: string }
  expect(renderCappedPayload(value as never).text.length).toBe(PAYLOAD_DISPLAY_CAP + 1)
  expect(JSON.stringify(value, null, 2).length).toBe(4097)
})

test('a string payload renders unquoted and a null payload shows the muted dash', () => {
  expect(renderCappedPayload('plain')).toEqual({ text: 'plain', truncated: false })
  expect(renderCappedPayload(null)).toEqual({ text: '', truncated: false })
  expect(renderCappedPayload({ a: [1] })).toEqual({ text: '{\n  "a": [\n    1\n  ]\n}', truncated: false })
})

test('string and null payloads in the inspector, and a node with no attempts', async () => {
  setup('payload-string-and-null'); open(); await ready(); fireEvent.click(node('start')); await screen.findByRole('heading', { name: 'start' })
  expect(within(screen.getByTestId('run-node-payload-entrada')).getByRole('region', { name: es.input })).toHaveTextContent(/^plain synthetic text/)
  expect(screen.getByTestId('run-node-salida-empty')).toHaveTextContent('—')
  expect(within(screen.getByTestId('run-node-attempts')).getByText(es.noAttempts)).toBeVisible()
})

test('Cancelar is disabled on a terminal run, Reintentar is hidden on a running one, approval buttons need a waiting node', async () => {
  setup('completed'); const first = open(); await ready()
  expect(screen.getByTestId('run-cancel-button')).toBeDisabled()
  expect(screen.getByTestId('run-retry-button')).toBeVisible()
  expect(screen.queryByTestId('run-approve-button')).toBeNull()
  first.unmount()
  setup('running', { [`GET ${eventsPath}`]: () => sseResponse() }); open(); await ready()
  expect(screen.getByTestId('run-cancel-button')).toBeEnabled()
  expect(screen.queryByTestId('run-retry-button')).toBeNull()
  expect(screen.queryByTestId('run-approve-button')).toBeNull()
  expect(screen.queryByTestId('run-reject-button')).toBeNull()
})

test('Cancelar confirms, POSTs the cancellation, reloads and announces the result', async () => {
  setup('running', { [`GET ${eventsPath}`]: () => sseResponse(), [`POST ${cancelPath}`]: { executionId: 'e1', status: 'Canceled' } }); open(); await ready()
  fireEvent.click(screen.getByTestId('run-cancel-button'))
  expect(await screen.findByRole('alertdialog')).toHaveTextContent(es.dialog.cancel.description)
  expect(count(cancelPath, 'POST')).toBe(0)
  fireEvent.click(screen.getByTestId('confirm-action-confirm'))
  await waitFor(() => expect(count(cancelPath, 'POST')).toBe(1))
  expect(calls().find((call) => call.path === cancelPath)!.body).toBeUndefined()
  await waitFor(() => expect(count(executionPath)).toBe(2))
  expect(count(flowPath)).toBe(2)
  expect((await screen.findAllByText(es.cancelledResult)).length).toBeGreaterThan(0)
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(screen.getByTestId('run-cancel-button')).toHaveFocus()
})

test('dismissing a confirmation sends nothing and returns focus to its button', async () => {
  setup('failed'); open(); await ready()
  fireEvent.click(screen.getByTestId('run-retry-button')); await screen.findByRole('alertdialog')
  fireEvent.click(screen.getByTestId('confirm-action-cancel'))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(count(retryPath, 'POST')).toBe(0)
  await waitFor(() => expect(screen.getByTestId('run-retry-button')).toHaveFocus())
})

test('Reintentar POSTs the retry, announces it and navigates to the returned execution', async () => {
  setup('failed', { [`POST ${retryPath}`]: { executionId: 'e2', status: 'Running' }, 'GET /v1/flows/workspaces/synthetic-workspace/flows/f1/executions/e2': executionVariants.completed })
  open(); await ready()
  fireEvent.click(screen.getByTestId('run-retry-button')); await screen.findByRole('alertdialog')
  fireEvent.click(screen.getByTestId('confirm-action-confirm'))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/console/flows/f1/runs/e2'))
  expect(calls().find((call) => call.path === retryPath)).toEqual({ path: retryPath, method: 'POST', body: undefined })
  expect((await screen.findAllByText(es.retriedResult.replace('{id}', 'e2'))).length).toBeGreaterThan(0)
  await waitFor(() => expect(count('/v1/flows/workspaces/synthetic-workspace/flows/f1/executions/e2')).toBe(1))
})

test.each([['approve', true], ['reject', false]] as const)('%s signals the waiting node with {approved, nodeId} and reloads', async (action, approved) => {
  setup('waiting-approval', { [`GET ${eventsPath}`]: () => sseResponse(), [`POST ${signalPath}`]: { executionId: 'e1', signal: 'review', delivered: true } }); open(); await ready()
  fireEvent.click(screen.getByTestId(`run-${action}-button`))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent(es.dialog[action].title)
  expect(dialog).toHaveTextContent('review')
  fireEvent.click(screen.getByTestId('confirm-action-confirm'))
  await waitFor(() => expect(count(signalPath, 'POST')).toBe(1))
  expect(calls().find((call) => call.path === signalPath)!.body).toEqual({ approved, nodeId: 'review' })
  await waitFor(() => expect(count(executionPath)).toBe(2))
  expect((await screen.findAllByText(es[approved ? 'approvedResult' : 'rejectedResult'].replace('{node}', 'review'))).length).toBeGreaterThan(0)
})

test('a failed action keeps the view, shows the message beside the toolbar and announces it', async () => {
  setup('running', { [`GET ${eventsPath}`]: () => sseResponse(), [`POST ${cancelPath}`]: () => Response.json({ code: 'FORBIDDEN', message: 'synthetic-backend-reason' }, { status: 403 }) }); open(); await ready()
  fireEvent.click(screen.getByTestId('run-cancel-button')); await screen.findByRole('alertdialog')
  fireEvent.click(screen.getByTestId('confirm-action-confirm'))
  expect(await screen.findByTestId('run-action-error')).toHaveTextContent(`${es.errors['403']} synthetic-backend-reason`)
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(count(executionPath)).toBe(1)
  expect(screen.getByTestId('react-flow-stub')).toBeVisible()
  expect(screen.getByTestId('run-status-badge')).toHaveTextContent(es.status.Running)
})

test('no definition replaces the canvas and hides the toolbar', async () => {
  setup('completed', { [`GET ${flowPath}`]: { ...flowRecord, definition: undefined } }); open()
  expect(await screen.findByRole('heading', { name: es.noDefinition })).toBeVisible()
  expect(screen.queryByTestId('react-flow-stub')).toBeNull()
  expect(screen.queryByTestId('run-action-toolbar')).toBeNull()
})

test('the loading state shows a skeleton while the definition and execution load', async () => {
  let release!: () => void
  setup('completed', { [`GET ${executionPath}`]: () => new Promise<Response>((resolve) => { release = () => resolve(Response.json(executionVariants.completed)) }) }); open()
  expect(await screen.findByTestId('run-loading')).toHaveAttribute('aria-busy', 'true')
  release(); await ready()
})

test('without a workspace the blocked state renders and nothing is requested', async () => {
  context.value = { ...context.value, activeWorkspaceId: null }; setup(); open()
  expect(await screen.findByRole('heading', { name: es.blocked })).toBeVisible()
  expect(screen.getByText(es.workspaceDescription)).toBeVisible()
  expect(calls()).toEqual([])
})

test('a missing identifier shows the blocked state with Volver a Flujos', async () => {
  setup(); open('/missing')
  expect(await screen.findByRole('heading', { name: es.blocked })).toBeVisible()
  expect(screen.getByRole('link', { name: es.backToFlows })).toHaveAttribute('href', '/console/flows')
  expect(calls()).toEqual([])
})

test('403 renders the no-access state with the backend reason and no request-access action', async () => {
  setup('completed', { [`GET ${executionPath}`]: () => Response.json({ code: 'FORBIDDEN', message: 'synthetic-backend-reason' }, { status: 403 }) }); open()
  expect(await screen.findByRole('heading', { name: es.noAccess })).toBeVisible()
  expect(screen.getByText('synthetic-backend-reason')).toBeVisible()
  expect(screen.queryByRole('button', { name: /acceso|access/i })).toBeNull()
})

test('404 renders not-found with a link back to the run history', async () => {
  setup('completed', { [`GET ${executionPath}`]: () => Response.json({ code: 'NOT_FOUND' }, { status: 404 }) }); open()
  expect(await screen.findByRole('heading', { name: es.notFound })).toBeVisible()
  expect(screen.getByRole('link', { name: es.backToRuns })).toHaveAttribute('href', '/console/flows/f1/runs')
})

test.each([[500, 'req_synthetic_run'], [undefined, '']] as const)('status %s renders the error panel with its request id and a working retry', async (status, requestId) => {
  let attempt = 0
  setup('completed', { [`GET ${executionPath}`]: () => {
    if (++attempt === 1) { if (status) return Response.json({ code: 'HTTP_500', requestId }, { status }); throw new TypeError('network') }
    return Response.json(executionVariants.completed)
  } }); open()
  expect(await screen.findByRole('heading', { name: es.errorTitle })).toBeVisible()
  if (requestId) expect(screen.getByText(requestId)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: es.retry })); await ready()
  expect(count(executionPath)).toBe(2)
})

test('a failure while reloading keeps the rendered run and shows an inline notice', async () => {
  let loads = 0
  setup('running', { [`GET ${eventsPath}`]: () => sseResponse(), [`GET ${executionPath}`]: () => ++loads === 1 ? Response.json(executionVariants.running) : Response.json({ code: 'HTTP_500' }, { status: 500 }), [`POST ${cancelPath}`]: { executionId: 'e1', status: 'Canceled' } }); open(); await ready()
  fireEvent.click(screen.getByTestId('run-cancel-button')); await screen.findByRole('alertdialog'); fireEvent.click(screen.getByTestId('confirm-action-confirm'))
  expect(await screen.findByTestId('run-reload-error')).toHaveTextContent(es.loadFailed)
  expect(screen.getByTestId('react-flow-stub')).toBeVisible()
})

test('an execution id with reserved characters is requested encoded', async () => {
  const path = '/v1/flows/workspaces/synthetic-workspace/flows/f1/executions/a%3Ab%2Fc'
  setup('completed', { [`GET ${path}`]: executionVariants.completed }); requests.mock.mockClear()
  vi.stubGlobal('fetch', requests.mock)
  open(`/console/flows/f1/runs/${encodeURIComponent('a:b/c')}`); await ready()
  expect(count(path)).toBe(1)
})

test('both catalogs expose the same keys and the Spanish copy is the default', () => {
  const keys = (value: Record<string, unknown>, prefix = ''): string[] => Object.entries(value).flatMap(([key, child]) => typeof child === 'string' ? [prefix + key] : keys(child as Record<string, unknown>, `${prefix}${key}.`))
  expect(keys(es).sort()).toEqual(keys(en).sort())
  expect(i18n.getFixedT('es', 'pages.console-flow-run-page')('actions.cancel')).toBe('Cancelar')
})
