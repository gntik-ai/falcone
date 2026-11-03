import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import ConsoleRealtimePage, { mapChannelTypes } from '../src/pages/consoleRealtime'
import { CapabilitiesProvider } from '../src/shell/capabilities'
import { login, renderWithSession, strictFetch } from './shell-support'
import { ready, realtimePath, capabilitiesPath, realtimeFixtures } from './parity/pages/console-realtime-page.manifest'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-realtime-page.json'
import en from '../src/locales/en/pages.console-realtime-page.json'

const context = vi.hoisted(() => ({ activeWorkspaceId: 'ws-stored' as string | null, activeTenantId: 't1' as string | null, loading: false }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context }))
let requests: ReturnType<typeof strictFetch>
afterEach(() => { requests?.verify(); context.activeWorkspaceId = 'ws-stored'; context.activeTenantId = 't1'; vi.unstubAllGlobals() })
const calls = (path = realtimePath) => requests.mock.mock.calls.filter(([input]) => input === path)
function mock(value: unknown = ready, capabilities: unknown = { capabilities: { realtime: true } }, path = realtimePath) {
  requests = strictFetch({ [`GET ${path}`]: value, [`GET ${capabilitiesPath}`]: capabilities })
}
function open(route = '/console/workspaces/ws-1/realtime', strict = false) {
  login(['member'])
  const page = <CapabilitiesProvider><Routes><Route path="/console/workspaces/:workspaceId/realtime" element={<ConsoleRealtimePage />} /><Route path="*" element={<ConsoleRealtimePage />} /></Routes></CapabilitiesProvider>
  return renderWithSession(strict ? <StrictMode>{page}</StrictMode> : page, { route })
}
const settled = () => screen.findByRole('tab', { name: 'JavaScript' })

test('channel types preserve first-seen order, ignore unsupported types, and deduplicate', () => {
  expect(mapChannelTypes([{ type: 'mongodb' }, { type: 'postgresql' }, { type: 'mongodb' }, { type: null }, {}])).toEqual(['mongodb-changes', 'postgresql-changes'])
  expect(mapChannelTypes(undefined)).toEqual([])
})
test.each(['es', 'en'] as const)('configuration, snippets, and the sole bodyless page GET match legacy in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  mock(); open(undefined, true); await settled()
  expect(screen.getByRole('heading', { name: copy.title })).toBeVisible()
  expect(Array.from(document.querySelectorAll('dt'), (node) => node.textContent)).toEqual(Object.values(copy.fields))
  expect(document.querySelectorAll('dd')[3]).toHaveTextContent('postgresql-changes, mongodb-changes')
  expect(document.querySelectorAll('pre')).toHaveLength(3)
  expect(document.querySelectorAll('pre')[0]).toHaveTextContent(ready.realtimeEndpointUrl)
  expect(screen.queryByText(copy.missingEndpoint)).not.toBeInTheDocument()
  expect(calls()).toHaveLength(1); expect(calls(capabilitiesPath)).toHaveLength(1)
  expect(calls()[0][1]).toMatchObject({ method: 'GET', body: undefined })
  expect(document.title).toBe(copy.documentTitle)
})
test.each(['workspace-realtime-dup-unsupported', 'workspace-realtime-null-endpoint'] as const)('legacy fixture mapping: %s', async (fixture) => {
  mock(realtimeFixtures[fixture].body); open(); await settled()
  if (fixture === 'workspace-realtime-null-endpoint') {
    expect(screen.getByText(es.unavailable)).toBeVisible()
    expect(screen.queryByRole('button', { name: es.copyEndpoint })).not.toBeInTheDocument()
    expect(screen.getAllByText(es.missingEndpoint)).toHaveLength(3)
    expect(document.querySelector('pre')).toHaveTextContent('<REALTIME_ENDPOINT>')
  } else expect(document.querySelectorAll('dd')[3]).toHaveTextContent('postgresql-changes, mongodb-changes')
})
test.each(['workspace-realtime-no-sources', 'workspace-realtime-only-unsupported', 'workspace-realtime-disabled'] as const)('unavailable state keeps configuration and provisioning: %s', async (fixture) => {
  mock(realtimeFixtures[fixture].body); open()
  expect(await screen.findByRole('heading', { name: es.emptyTitle })).toBeVisible()
  expect(document.querySelectorAll('dt')).toHaveLength(4)
  expect(screen.getByRole('link', { name: es.provisioning })).toHaveAttribute('href', '/console/workspaces/ws-1/provisioning')
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
})
test('route workspace wins over selection, with selection fallback and no-workspace no-request', async () => {
  mock(ready, undefined, '/v1/workspaces/ws-2/realtime'); const route = open('/console/workspaces/ws-2/realtime'); await settled()
  expect(calls('/v1/workspaces/ws-2/realtime')).toHaveLength(1); route.unmount()
  mock(ready, undefined, '/v1/workspaces/ws-stored/realtime'); const selected = open('/component'); await settled()
  expect(calls('/v1/workspaces/ws-stored/realtime')).toHaveLength(1); selected.unmount()
  context.activeWorkspaceId = null; context.activeTenantId = null
  mock(); open('/component')
  expect(screen.getByRole('heading', { name: es.workspaceRequired })).toBeVisible()
  expect(requests.mock).not.toHaveBeenCalled()
})
test('metadata loading and capabilities loading expose the named busy skeleton', async () => {
  let resolve!: (response: Response) => void
  mock(() => new Promise<Response>((done) => { resolve = done }))
  const first = open()
  expect(screen.getByRole('status', { name: es.loading })).toHaveAttribute('aria-busy', 'true')
  await waitFor(() => expect(resolve).toBeTypeOf('function'))
  await act(async () => resolve(Response.json(ready))); await settled(); first.unmount()
  mock(ready, () => new Promise<Response>((done) => { resolve = done })); open()
  await waitFor(() => expect(calls()).toHaveLength(1))
  expect(screen.getByRole('status', { name: es.loading })).toHaveAttribute('aria-busy', 'true')
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  await act(async () => resolve(Response.json({ capabilities: { realtime: false } })))
  expect(await screen.findByTestId('realtime-restricted')).toHaveAttribute('inert')
})
test.each(['disabled', 'error', 'missing'] as const)('capability %s renders content inert, dimmed and fail-closed', async (variant) => {
  mock(ready, variant === 'error' ? () => Response.json({}, { status: 500 }) : { capabilities: variant === 'missing' ? {} : { realtime: false } })
  open()
  const restricted = await screen.findByTestId('realtime-restricted')
  expect(restricted).toHaveAttribute('inert'); expect(restricted).toHaveClass('opacity-50')
  expect(screen.getByText(es.upgrade)).toBeVisible()
  expect(screen.getByRole('tab', { name: 'Python' })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('button', { name: es.copyEndpoint })).toBeDisabled()
})
test.each(['es', 'en'] as const)('copy endpoint and snippet, clipboard fallback, and tab persistence in %s', async (locale) => {
  await i18n.changeLanguage(locale); const copy = locale === 'es' ? es : en
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  mock(); const view = open(); await settled()
  fireEvent.click(screen.getByRole('button', { name: copy.copyEndpoint }))
  await screen.findByText(copy.copiedEndpoint)
  expect(writeText).toHaveBeenLastCalledWith(ready.realtimeEndpointUrl)
  fireEvent.click(screen.getByRole('tab', { name: 'Python' }))
  expect(sessionStorage.getItem('realtime-snippet-lang')).toBe('python')
  expect(document.querySelector('pre')).toHaveTextContent('import asyncio, json, websockets')
  fireEvent.click(screen.getAllByRole('button', { name: copy.copy })[0]); await screen.findByText(copy.copiedSnippet)
  expect(writeText).toHaveBeenLastCalledWith(copy.entries['realtime-python-backend-basic'].code.replaceAll('{REALTIME_ENDPOINT}', ready.realtimeEndpointUrl).replaceAll('{WORKSPACE_ID}', 'ws-1').replaceAll('{CHANNEL_TYPE}', 'postgresql-changes'))
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  fireEvent.click(screen.getAllByRole('button', { name: copy.copy })[0]); await screen.findByText(copy.manual)
  expect(document.querySelector('pre')).toBeVisible()
  view.unmount(); open(); await screen.findByRole('tab', { name: 'Python' })
  expect(screen.getByRole('tab', { name: 'Python' })).toHaveAttribute('aria-selected', 'true')
})
test.each([403, 404])('HTTP %s has a back link without requesting access', async (status) => {
  mock(() => Response.json({}, { status })); open()
  expect(await screen.findByRole('heading', { name: status === 403 ? es.noAccess : es.notFound })).toBeVisible()
  expect(screen.getByRole('link', { name: es.back })).toHaveAttribute('href', '/console/workspaces')
  expect(screen.queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
})
test('500 retry preserves request id, restores focus on failure, and focuses heading on recovery', async () => {
  let count = 0
  mock(() => ++count < 3 ? Response.json({ requestId: 'synthetic-realtime-request' }, { status: 500 }) : Response.json(ready)); open()
  const retry = await screen.findByRole('button', { name: es.retry })
  expect(screen.getByText('synthetic-realtime-request')).toBeVisible()
  fireEvent.click(retry); await waitFor(() => expect(screen.getByRole('button', { name: es.retry })).toHaveFocus())
  fireEvent.click(screen.getByRole('button', { name: es.retry })); await settled()
  expect(screen.getByRole('heading', { name: es.title })).toHaveFocus()
  expect(calls()).toHaveLength(3)
})
test('network failure has retry and never renders stale configuration', async () => {
  let count = 0
  mock(() => { if (++count === 1) throw new TypeError('offline'); return Response.json(ready) }); open()
  fireEvent.click(await screen.findByRole('button', { name: es.retry })); await settled()
  expect(calls()).toHaveLength(2)
})
