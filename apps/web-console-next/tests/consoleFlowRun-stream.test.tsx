import { StrictMode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession } from '@in-falcone/console-api/session'
import ConsoleFlowRunPage from '../src/pages/consoleFlowRun'
import { eventsPath, executionPath, executionVariants, flowPath, flowRecord, frame, sse } from './parity/pages/console-flow-run-page.manifest'
import { animations, openStream, sseResponse } from './consoleFlowRun-support'
import { login, strictFetch } from './shell-support'
import es from '../src/locales/es/pages.console-flow-run-page.json'

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown>, announce: vi.fn() }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => ({ can: () => false }) }))
vi.mock('@gntik-ai/ui', async (original) => ({ ...await original<typeof import('@gntik-ai/ui')>(), useAnnounce: () => context.announce }))
vi.mock('@xyflow/react', async (original) => (await import('./consoleFlowRun-support')).xyflowStub(await original<typeof import('@xyflow/react')>()))

let requests: ReturnType<typeof strictFetch>
const calls = () => requests.mock.mock.calls.map(([url, init]) => ({ path: String(url), method: init?.method ?? 'GET', headers: new Headers(init?.headers), signal: init?.signal }))
const eventCalls = () => calls().filter((call) => call.path === eventsPath)
const node = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!
const statusOf = (id: string) => within(node(id)).getByTestId('node-status-badge').getAttribute('data-status')
function setup(variant: keyof typeof executionVariants, routes: Record<string, unknown>) {
  requests = strictFetch({ [`GET ${flowPath}`]: flowRecord, [`GET ${executionPath}`]: executionVariants[variant], ...routes })
}
function open(strict = false) {
  const tree = <MemoryRouter initialEntries={['/console/flows/f1/runs/e1']}><Routes><Route path="/console/flows/:flowId/runs/:executionId" element={<ConsoleFlowRunPage />} /></Routes></MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}
beforeEach(() => {
  animations(); login(); context.announce.mockClear()
  context.value = { activeWorkspaceId: 'synthetic-workspace', loading: false, error: null, workspaces: [], selectWorkspace: vi.fn() }
})
afterEach(() => requests?.verify())

test('a terminal run opens no events request', async () => {
  setup('completed', {}); open(true); await screen.findByTestId('react-flow-stub')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
  expect(eventCalls()).toHaveLength(0)
})

test('a running run streams with the session bearer, no query string and no credential in any URL, and live frames win', async () => {
  const stream = openStream()
  setup('running', { [`GET ${eventsPath}`]: () => stream.response })
  open(true); await screen.findByTestId('react-flow-stub')
  expect(statusOf('review')).toBe('scheduled')
  await waitFor(() => expect(eventCalls()).toHaveLength(1))
  const [call] = eventCalls()
  expect(call.path).toBe(eventsPath)
  expect(call.path).not.toContain('?')
  expect(call.headers.get('Authorization')).toBe(`Bearer ${readConsoleShellSession()?.tokenSet?.accessToken}`)
  expect(call.headers.get('Accept')).toBe('text/event-stream')
  expect(call.headers.has('Last-Event-ID')).toBe(false)
  expect(await screen.findByTestId('run-streaming-indicator')).toHaveTextContent(es.live)
  expect(screen.queryByRole('textbox')).toBeNull()
  stream.push(frame('1', 'node-status', { nodeId: 'review', status: 'started', attemptNumber: 1 }))
  await waitFor(() => expect(statusOf('review')).toBe('started'))
  expect(node('review')).toHaveAccessibleName(expect.stringContaining(es.nodeStatus.started))
  // A repeated status is not announced again, a new one is.
  stream.push(frame('2', 'node-status', { nodeId: 'review', status: 'started', attemptNumber: 1 }))
  stream.push(frame('3', 'node-status', { nodeId: 'review', status: 'waiting-approval', attemptNumber: 1 }))
  await waitFor(() => expect(statusOf('review')).toBe('waiting-approval'))
  expect(context.announce.mock.calls.filter(([message]) => String(message).includes('review'))).toEqual([
    [es.nodeStatusChanged.replace('{node}', 'review').replace('{status}', es.nodeStatus.started), 'polite'],
    [es.nodeStatusChanged.replace('{node}', 'review').replace('{status}', es['nodeStatus']['waiting-approval']), 'polite'],
  ])
  await waitFor(() => expect(screen.getByTestId('run-approve-button')).toBeVisible())
  for (const { path } of calls()) expect(path).not.toMatch(/apikey/i)
  stream.end()
})

test('stream-end reloads the run once for its final render, turns the indicator off and closes the stream', async () => {
  let loads = 0
  setup('running', {
    [`GET ${eventsPath}`]: () => sseResponse(sse.nodeStatusFrames),
    [`GET ${executionPath}`]: () => Response.json(++loads === 1 ? executionVariants.running : executionVariants.completed),
  })
  open(); await screen.findByTestId('react-flow-stub')
  await waitFor(() => expect(screen.getByTestId('run-static-indicator')).toBeVisible())
  expect(loads).toBe(2)
  expect(eventCalls()).toHaveLength(1)
  expect(screen.queryByTestId('run-streaming-indicator')).toBeNull()
  expect(statusOf('review')).toBe('completed')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1300)) })
  expect(eventCalls()).toHaveLength(1)
  expect(eventCalls()[0].signal?.aborted).toBe(true)
})

test('after a drop the node keeps its live status, the live indicator turns off and the reconnect resumes once per frame', async () => {
  const resumed = openStream()
  let connections = 0
  setup('running', { [`GET ${eventsPath}`]: () => ++connections === 1 ? sseResponse(sse.dropFirst) : resumed.response })
  open(); await screen.findByTestId('react-flow-stub')
  await waitFor(() => expect(statusOf('review')).toBe('started'))
  expect(await screen.findByTestId('run-stream-notice', {}, { timeout: 4000 })).toHaveTextContent(es.reconnectingTitle)
  expect(screen.queryByTestId('run-streaming-indicator')).toBeNull()
  expect(screen.getByTestId('run-not-live-indicator')).toHaveTextContent(es.notLive)
  expect(statusOf('review')).toBe('started')
  await waitFor(() => expect(eventCalls()).toHaveLength(2), { timeout: 4000 })
  expect(eventCalls()[1].headers.get('Last-Event-ID')).toBe('1')
  // The resumed stream repeats frame 1 and adds frame 2: the repeat is not applied or announced again.
  resumed.push(frame('1', 'node-status', { nodeId: 'review', status: 'started' }))
  resumed.push(frame('2', 'node-status', { nodeId: 'review', status: 'completed' }))
  await waitFor(() => expect(statusOf('review')).toBe('completed'))
  expect(await screen.findByTestId('run-streaming-indicator')).toBeVisible()
  expect(screen.queryByTestId('run-stream-notice')).toBeNull()
  expect(context.announce.mock.calls.filter(([message]) => String(message).includes('review'))).toHaveLength(2)
  resumed.end()
}, 15000)

test('a stream the client gives up on shows a non-blocking notice and keeps the persisted statuses', async () => {
  setup('running', { [`GET ${eventsPath}`]: () => Response.json({ code: 'FORBIDDEN' }, { status: 403 }) })
  open(); await screen.findByTestId('react-flow-stub')
  expect(await screen.findByTestId('run-stream-notice')).toHaveTextContent(es.unavailableTitle)
  expect(screen.getByTestId('run-stream-notice')).toHaveTextContent(es.unavailableDescription)
  expect(screen.getByTestId('run-cancel-button')).toBeEnabled()
  expect(statusOf('start')).toBe('completed')
  expect(eventCalls()).toHaveLength(1)
})

test('unmounting closes the stream', async () => {
  const stream = openStream()
  setup('running', { [`GET ${eventsPath}`]: () => stream.response })
  const view = open(); await waitFor(() => expect(eventCalls()).toHaveLength(1))
  expect(eventCalls()[0].signal?.aborted).toBe(false)
  view.unmount()
  expect(eventCalls()[0].signal?.aborted).toBe(true)
  stream.end()
})

test('a 401 on the stream refreshes once and resumes with the new token', async () => {
  const initial = login(), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let connections = 0
  setup('running', {
    [`GET ${eventsPath}`]: () => ++connections === 1 ? Response.json({ code: 'UNAUTHORIZED' }, { status: 401 }) : sseResponse(frame('1', 'node-status', { nodeId: 'review', status: 'started' }), frame('2', 'stream-end', {})),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': fresh,
  })
  open(); await screen.findByTestId('react-flow-stub')
  await waitFor(() => expect(statusOf('review')).toBe('started'))
  expect(calls().filter((call) => call.path.endsWith('/refresh'))).toHaveLength(1)
  expect(eventCalls()).toHaveLength(2)
  expect(eventCalls()[0].headers.get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
  expect(eventCalls()[1].headers.get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
  // The replay after the refresh is not shown as a dropped connection.
  expect(screen.queryByTestId('run-stream-notice')).toBeNull()
})
