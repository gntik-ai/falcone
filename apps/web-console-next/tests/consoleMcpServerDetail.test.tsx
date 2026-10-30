import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import ConsoleMcpServerDetailPage from '../src/pages/consoleMcpServerDetail'
import { connectionSnippets, fetchMcpServerDetail, invokeMcpTool, toMcpServerDetailViewModel } from '../src/pages/consoleMcpServerDetail/api'
import { callPath, detailPath, detailResponse, server, toolResult } from './parity/pages/console-mcp-server-detail-page.manifest'
import { login, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-mcp-server-detail-page.json'
import en from '../src/locales/en/pages.console-mcp-server-detail-page.json'
import { forbiddenMcpCopy, mcpLocaleValues } from './parity/pages/consoleMcpServerDetail.locale'
const context = vi.hoisted(() => ({ value: {} as Record<string, unknown>, roles: ['superadmin'] }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => getConsolePermissions(context.roles) }))
let requests: ReturnType<typeof strictFetch>
const calls = () => requests.mock.mock.calls.map(([url, init]) => ({ method: init?.method, path: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined }))
function setup(routes: Record<string, unknown> = {}) { requests = strictFetch({ [`GET ${detailPath}`]: server, [`POST ${callPath}`]: toolResult, ...routes }) }
function open(extra = <></>) { return render(<StrictMode><MemoryRouter initialEntries={['/console/mcp/servers/srv_1']}>{extra}<Routes><Route path="/console/mcp/servers/:mcpServerId" element={<ConsoleMcpServerDetailPage />} /></Routes></MemoryRouter></StrictMode>) }
async function ready() { await screen.findByRole('heading', { name: 'Acme Orders' }) }
async function playground(label = es.playground) { await ready(); fireEvent.click(screen.getByRole('tab', { name: label })) }
beforeEach(() => {
  login(); context.roles = ['superadmin']; context.value = { activeWorkspaceId: 'synthetic-workspace', loading: false, error: null, workspaces: [], selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn() }
})
afterEach(() => requests?.verify())

// Legacy ConsoleMcpServerDetailPage.test.tsx:43 and :64.
test.each(['es', 'en'] as const)('renders server metadata, tools, empty history and localized connection snippets in %s', async (locale) => {
  await i18n.changeLanguage(locale); const copy = locale === 'es' ? es : en
  setup(); open(); await ready()
  expect(calls()).toEqual([{ method: 'GET', path: detailPath, body: undefined }])
  expect(screen.getByTestId('mcp-detail-endpoint')).toHaveTextContent(server.endpointUrl!)
  expect(screen.getByText('v3')).toBeVisible(); expect(screen.getByText('running')).toBeVisible()
  expect(screen.getByText(copy.mutates)).toBeVisible(); expect(screen.getByText(locale === 'es' ? '2 publicadas' : '2 published')).toBeVisible()
  expect(screen.getByTestId('mcp-detail-tools')).toHaveTextContent(locale === 'es' ? 'Alcance: mcp:orders:read' : 'Scope: mcp:orders:read')
  expect(screen.getByRole('region', { name: copy.history })).toHaveTextContent(copy.emptyHistory)
  expect(screen.getByRole('region', { name: copy.history }).querySelector('li')).toBeNull()
  expect(screen.getByRole('tabpanel', { name: copy.connect })).toBeVisible()
  expect(screen.getByRole('heading', { name: copy.snippetsTitle })).toBeVisible()
  expect(screen.getByText(copy.snippetsDescription)).toBeVisible()
  const snippets = connectionSnippets(toMcpServerDetailViewModel(server))
  for (const snippet of snippets) {
    const lines = screen.getByRole('region', { name: copy[snippet.id as 'cursor'] }).querySelectorAll('[data-line]')
    expect([...lines].map((line) => line.textContent).join('\n')).toBe(snippet.code)
  }
  expect(screen.getByTestId('mcp-connect-panel').querySelector('a[href]')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: copy.playground }))
  expect(screen.getByRole('tabpanel', { name: copy.playground })).toBeVisible()
  expect(screen.getByLabelText(copy.arguments)).toBeVisible()
  expect(document.documentElement.lang).toBe(locale)
})

test('copies the exact Cursor deeplink, keeps focus and announces localized feedback', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  setup(); open(); await ready()
  const button = screen.getByRole('button', { name: `Copiar ${es.cursor}` }); button.focus(); fireEvent.click(button)
  await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(connectionSnippets(toMcpServerDetailViewModel(server))[0].code))
  expect(button).toHaveFocus()
  await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(es.copyAnnouncement))
})

test.each(['{}', '', '{"limit":2}'])('invokes once with legacy arguments %s, keeps focus and announces the JSON result', async (args) => {
  let resolve!: (value: Response) => void
  setup({ [`POST ${callPath}`]: () => new Promise<Response>((done) => { resolve = done }) }); open(); await playground()
  fireEvent.change(screen.getByLabelText(es.arguments), { target: { value: args } })
  const button = screen.getByRole('button', { name: es.invoke }); button.focus(); fireEvent.click(button); fireEvent.submit(screen.getByTestId('mcp-playground'))
  await waitFor(() => expect(calls()).toHaveLength(2)); expect(button).toBeDisabled()
  expect(calls()[1]).toEqual({ method: 'POST', path: callPath, body: { name: 'list_orders', arguments: JSON.parse(args || '{}') } })
  await act(async () => resolve(Response.json(toolResult)))
  await screen.findByText('"synthetic-tool-result"')
  expect(screen.getByRole('tree', { name: es.result })).toBeVisible(); expect(button).toHaveFocus()
  await waitFor(() => expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(es.resultAnnouncement))
})

test('invalid JSON is marked, associated with its error, announced, and sends no invocation', async () => {
  setup(); open(); await playground(); const args = screen.getByLabelText(es.arguments)
  fireEvent.change(args, { target: { value: '{bad' } }); fireEvent.click(screen.getByRole('button', { name: es.invoke }))
  expect(args).toHaveAttribute('aria-invalid', 'true'); expect(document.getElementById('mcp-invoke-error')).toHaveTextContent(es.invalidJson)
  expect(args).toHaveAttribute('aria-describedby', 'mcp-args-help mcp-invoke-error'); expect(calls()).toHaveLength(1)
  await waitFor(() => expect(document.querySelector('[aria-live="assertive"]')).toHaveTextContent(es.invalidJson))
})

test.each(['es', 'en'] as const)('tool-call 500 stays localized under Invoke and announces an assertive failure in %s', async (locale) => {
  await i18n.changeLanguage(locale); const copy = locale === 'es' ? es : en
  setup({ [`POST ${callPath}`]: () => Response.json({ message: 'Raw backend failure' }, { status: 500 }) }); open(); await playground(copy.playground)
  const button = screen.getByRole('button', { name: copy.invoke }); button.focus(); fireEvent.click(button)
  await waitFor(() => expect(document.getElementById('mcp-invoke-error')).toHaveTextContent(copy.invokeError)); expect(button).toHaveFocus()
  expect(screen.queryByText('Raw backend failure')).toBeNull()
  await waitFor(() => expect(document.querySelector('[aria-live="assertive"]')).toHaveTextContent(copy.invokeError))
})

test.each(['empty', 'no-endpoint', 'runtime-not-ready'])('renders %s without invoking and keeps restriction reasons visible', async (variant) => {
  setup({ [`GET ${detailPath}`]: detailResponse(variant).body }); open(); await playground()
  if (variant === 'empty') { expect(screen.getByText(es.noTools)).toBeVisible(); expect(screen.getByRole('heading', { name: es.playgroundEmpty })).toBeVisible(); expect(screen.queryByRole('button', { name: es.invoke })).toBeNull() }
  else { expect(screen.getByRole('button', { name: es.invoke })).toBeDisabled(); expect(screen.getByText(variant === 'no-endpoint' ? es.noEndpointDescription : es.runtimeUnavailable)).toBeVisible(); fireEvent.submit(screen.getByTestId('mcp-playground')) }
  expect(calls()).toHaveLength(1)
})

// Legacy :82; only the approved localized no-access state may show.
test.each([403, 404, 500, 'network'] as const)('load %s shows its approved state and retries exactly once where applicable', async (status) => {
  let attempts = 0
  setup({ [`GET ${detailPath}`]: () => { if (++attempts > 1) return Response.json(server); if (status === 'network') throw new TypeError('Raw network failure'); return Response.json({ message: 'requires superadmin', requestId: 'req_synthetic_mcp' }, { status }) } }); open()
  await screen.findByRole('heading', { name: status === 403 ? es.noAccess : status === 404 ? es.notFound : es.errorTitle })
  expect(screen.queryByText('requires superadmin')).toBeNull(); expect(screen.queryByRole('heading', { name: 'Acme Orders' })).toBeNull()
  if (status === 404) { expect(screen.getByRole('link', { name: es.backOverview })).toHaveAttribute('href', '/console/overview'); expect(screen.queryByRole('button', { name: es.retry })).toBeNull() }
  if (status === 500) { expect(screen.getByText('req_synthetic_mcp')).toBeVisible(); expect(screen.getByText(es.errors.server)).toBeVisible() }
  if (status === 500 || status === 'network') { fireEvent.click(screen.getByRole('button', { name: es.retry })); await ready(); expect(calls()).toHaveLength(2) }
})

test('500 without a gateway request id leaves diagnostics absent', async () => {
  setup({ [`GET ${detailPath}`]: () => Response.json({}, { status: 500 }) }); open(); await screen.findByRole('heading', { name: es.errorTitle })
  expect(screen.queryByText(es.requestId)).toBeNull(); expect(screen.queryByText('req_synthetic_mcp')).toBeNull()
})

const errorLocaleCases = (['es', 'en'] as const).flatMap((locale) =>
  ['403', '404', '500', 'network'].map((variant) => ({ locale, variant })))
test.each(errorLocaleCases)('load $variant copy is localized in $locale before any retry', async ({ locale, variant }) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  const response = detailResponse(variant)
  setup({ [`GET ${detailPath}`]: () => {
    if (response.network) throw new TypeError('Raw network failure')
    return Response.json(response.body, { status: response.status })
  } })
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  open()
  const title = copy[variant === '403' ? 'noAccess' : variant === '404' ? 'notFound' : 'errorTitle']
  await screen.findByRole('heading', { name: title })
  const values = mcpLocaleValues(), forbidden = await forbiddenMcpCopy(locale)
  expect(values).toContain(title)
  expect(values.filter((text) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text) || (locale === 'es' && forbidden.has(text)))).toEqual([])
  expect(screen.queryByTestId('mcp-server-detail')).toBeNull()
  expect(screen.queryByText('synthetic-backend-reason')).toBeNull()
  expect(calls()).toEqual([{ method: 'GET', path: detailPath, body: undefined }])
})

test('shows the server skeleton until the single GET resolves under StrictMode', async () => {
  setup({ [`GET ${detailPath}`]: () => new Promise<Response>(() => {}) }); open()
  expect(screen.getByRole('status', { name: es.loading })).toBeVisible(); await waitFor(() => expect(calls()).toHaveLength(1))
})

// Legacy :91 and :101; choosing the inline picker must activate actual loading.
test.each(['loading', 'error', 'picker', 'create', 'denied'])('workspace %s sends no MCP GET before activation', async (variant) => {
  Object.assign(context.value, { activeWorkspaceId: null, loading: variant === 'loading', error: variant === 'error' ? { status: 500 } : null })
  context.roles = variant === 'denied' ? ['tenant_viewer'] : ['superadmin']
  if (variant === 'picker') context.value.workspaces = [{ workspaceId: 'synthetic-workspace', displayName: 'Production' }]
  setup(); const rendered = open(); expect(screen.getByRole('heading', { level: 1, name: es.title })).toBeVisible()
  if (variant === 'loading') expect(screen.getByRole('status', { name: es.workspaceLoading })).toBeVisible()
  if (variant === 'error') { fireEvent.click(screen.getByRole('button', { name: es.retry })); expect(context.value.reloadWorkspaces).toHaveBeenCalledTimes(1) }
  if (variant === 'create') expect(screen.getByRole('link', { name: es.createWorkspace })).toHaveAttribute('href', '/console/workspaces')
  if (variant === 'denied') { expect(screen.getByText(es.workspaceDenied)).toBeVisible(); expect(screen.queryByRole('link', { name: es.createWorkspace })).toBeNull() }
  if (variant === 'picker') {
    fireEvent.click(screen.getByRole('combobox', { name: es.workspaceLabel })); const option = await screen.findByRole('option', { name: 'Production' }); fireEvent.pointerDown(option); fireEvent.click(option)
    expect(context.value.selectWorkspace).toHaveBeenCalledWith('synthetic-workspace')
  }
  expect(calls()).toHaveLength(0)
  if (variant === 'picker') { rendered.unmount(); context.value.activeWorkspaceId = 'synthetic-workspace'; open(); await ready(); expect(calls()).toHaveLength(1) }
})

test('uses the id and missing metadata fallbacks, flat tools and legacy snippet slug shaping', async () => {
  setup({ [`GET ${detailPath}`]: { tools: [{ name: 'flat', suggestedScope: 'flat:read' }] } }); open()
  await screen.findByRole('heading', { name: 'srv_1' }); expect(screen.getByText(es.unpublished)).toBeVisible(); expect(screen.getByText(es.noStatus)).toBeVisible()
  expect(screen.getByText('Alcance: flat:read')).toBeVisible()
  expect(connectionSnippets(toMcpServerDetailViewModel({ name: ' My Server! ' }))[0].code).toContain('name=my-server')
})

function ChangeServer() { const navigate = useNavigate(); return <button onClick={() => navigate('/console/mcp/servers/new')}>Change server</button> }
test('changing the server aborts the previous GET and never shows its stale payload', async () => {
  let resolve!: (value: Response) => void; let signal: AbortSignal | null = null
  setup({ [`GET ${detailPath}`]: (init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>((done) => { resolve = done }) }, 'GET /v1/mcp/workspaces/synthetic-workspace/servers/new': { ...server, name: 'New server' } })
  open(<ChangeServer />); await waitFor(() => expect(calls()).toHaveLength(1)); fireEvent.click(screen.getByRole('button', { name: 'Change server' }))
  await screen.findByRole('heading', { name: 'New server' }); expect((signal as AbortSignal | null)?.aborted).toBe(true)
  await act(async () => resolve(Response.json(server))); expect(screen.queryByRole('heading', { name: 'Acme Orders' })).toBeNull()
})

test('API adapter encodes both ids and preserves the exact payload with no extra requests', async () => {
  setup({ 'GET /v1/mcp/workspaces/ws%2F1/servers/srv%2F1': server, 'POST /v1/mcp/workspaces/ws%2F1/servers/srv%2F1/tool-calls': toolResult })
  await fetchMcpServerDetail('ws/1', 'srv/1'); await invokeMcpTool('ws/1', 'srv/1', 'update_order', { id: 1 })
  expect(calls()).toEqual([{ method: 'GET', path: '/v1/mcp/workspaces/ws%2F1/servers/srv%2F1', body: undefined }, { method: 'POST', path: '/v1/mcp/workspaces/ws%2F1/servers/srv%2F1/tool-calls', body: { name: 'update_order', arguments: { id: 1 } } }])
})

test('selecting a mutating curated tool shows its description and suggested scope and invokes that tool', async () => {
  setup(); open(); await playground()
  fireEvent.click(screen.getByRole('combobox', { name: es.tool })); const option = await screen.findByRole('option', { name: 'update_order (muta)' }); fireEvent.pointerDown(option); fireEvent.click(option)
  expect(document.getElementById('mcp-tool-context')).toHaveTextContent('update')
  expect(document.getElementById('mcp-tool-context')).toHaveTextContent(es.mutatingNote)
  expect(document.getElementById('mcp-tool-context')).toHaveTextContent('Alcance sugerido: mcp:orders:write.')
  fireEvent.click(screen.getByRole('button', { name: es.invoke })); await waitFor(() => expect(calls()).toHaveLength(2))
  expect(calls()[1].body).toEqual({ name: 'update_order', arguments: {} })
})

test('the tabs activate on arrow, Home and End keys and focus the selected tab', async () => {
  setup(); open(); await ready()
  const connect = screen.getByRole('tab', { name: es.connect }), playground = screen.getByRole('tab', { name: es.playground })
  connect.focus()
  for (const [key, next] of [['ArrowRight', playground], ['Home', connect], ['End', playground], ['ArrowLeft', connect]] as const) {
    fireEvent.keyDown(document.activeElement!, { key }); await waitFor(() => expect(next).toHaveFocus())
    await waitFor(() => expect(next).toHaveAttribute('aria-selected', 'true'))
  }
})
