import { StrictMode } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { ConsoleContextProvider, useConsoleContext } from '../src/shell/context'
import { PermissionsProvider } from '../src/shell/permissions'
import ConsoleMcpServersPage from '../src/pages/consoleMcpServers'
import { login, renderWithSession, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import i18n from '../src/i18n'

let requests: ReturnType<typeof strictFetch>
const path = '/v1/mcp/workspaces/synthetic-workspace/servers'
const calls = () => requests.mock.mock.calls.filter(([url]) => url === path)
function setup(routes: Parameters<typeof strictFetch>[0]) {
  return strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), ...routes })
}
function SwitchWorkspace() {
  const { selectWorkspace } = useConsoleContext()
  return <button onClick={() => selectWorkspace('synthetic/other')}>Switch workspace</button>
}
function open(routeWorkspaceId?: string) {
  return renderWithSession(<StrictMode><ConsoleContextProvider routeWorkspaceId={routeWorkspaceId}><PermissionsProvider><ConsoleMcpServersPage /><SwitchWorkspace /></PermissionsProvider></ConsoleContextProvider></StrictMode>)
}
beforeEach(() => { login() })
afterEach(() => requests?.verify())

test.each(['es', 'en'])('an empty list renders an informational empty state in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  requests = setup({ [`GET ${path}`]: { items: [] } }); open()
  expect(await screen.findByRole('heading', { name: locale === 'es' ? 'No hay servidores MCP' : 'No MCP servers' })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
  expect(calls()).toHaveLength(1)
})

test.each(['es', 'en'])('403 shows localized no-access in %s and does not offer retry', async (locale) => {
  await i18n.changeLanguage(locale)
  requests = setup({ [`GET ${path}`]: () => Response.json({ message: 'Raw backend failure' }, { status: 403 }) }); open()
  expect(await screen.findByRole('heading', { name: locale === 'es' ? 'No tienes acceso a los servidores MCP' : 'You do not have access to MCP servers' })).toBeVisible()
  expect(screen.queryByRole('button', { name: /^(Reintentar|Retry)$/ })).toBeNull()
  expect(screen.queryByText('Raw backend failure')).toBeNull()
})

test.each(['es', 'en'])('404 is informational MCP-unavailable in %s with no retry', async (locale) => {
  await i18n.changeLanguage(locale)
  requests = setup({ [`GET ${path}`]: () => Response.json({}, { status: 404 }) }); open()
  expect(await screen.findByRole('heading', { name: locale === 'es' ? 'MCP no está disponible' : 'MCP is not available' })).toBeVisible()
  expect(screen.queryByRole('button', { name: /^(Reintentar|Retry)$/ })).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

test.each(['es', 'en'].flatMap((locale) => [500, 'network'].map((failure) => ({ locale, failure }))))('$failure offers localized retry in $locale and replaces the error with rows', async ({ locale, failure }) => {
  await i18n.changeLanguage(locale)
  let attempts = 0
  requests = setup({ [`GET ${path}`]: () => {
    if (++attempts > 1) return Response.json({ items: [{ serverId: 'srv_1', name: 'Recovered', status: 'curated', lifecycleStatus: 'active' }] })
    if (failure === 'network') throw new TypeError('Raw network failure')
    return Response.json({ message: 'Raw backend failure' }, { status: 500 })
  } }); open()
  expect(await screen.findByRole('heading', { name: locale === 'es' ? 'No se pudieron cargar los servidores MCP' : 'Could not load MCP servers' })).toBeVisible()
  expect(screen.queryByText(/Raw (network|backend) failure/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: locale === 'es' ? 'Reintentar' : 'Retry' }))
  expect(await screen.findByRole('link', { name: 'Recovered' })).toBeVisible()
  expect(calls()).toHaveLength(2)
})

test.each(['es', 'en'].flatMap((locale) => ['loading', 'error', 'picker', 'create', 'denied'].map((variant) => ({ locale, variant }))))('workspace $variant in $locale sends no list request', async ({ locale, variant }) => {
  await i18n.changeLanguage(locale)
  const copy = (await import(`../src/locales/${locale}/pages.console-mcp-servers-page.json`)).default
  if (variant === 'denied') login(['tenant_viewer'])
  const workspaces = buildWorkspaceCollectionFixture().items
  let attempts = 0
  requests = setup({
    [`GET ${path}`]: { items: [] },
    [`GET ${workspaceUrl('synthetic-tenant')}`]: () => {
      attempts++
      if (variant === 'loading') return new Promise<Response>(() => {})
      if (variant === 'error' && attempts === 1) return Response.json({}, { status: 500 })
      return Response.json({ items: variant === 'picker' ? [...workspaces, { ...workspaces[0], workspaceId: 'synthetic-other', displayName: 'Other workspace' }] : [] })
    },
  }); open()
  if (variant === 'loading') expect(await screen.findByRole('status', { name: copy.workspaceLoading })).toBeVisible()
  else if (variant === 'error') {
    fireEvent.click(await screen.findByRole('button', { name: copy.retry }))
    await screen.findByRole('heading', { name: copy.workspaceRequired })
    expect(attempts).toBe(2)
  } else {
    expect(await screen.findByRole('heading', { name: copy.workspaceRequired })).toBeVisible()
    if (variant === 'create') expect(screen.getByRole('link', { name: copy.createWorkspace })).toHaveAttribute('href', '/console/workspaces')
    if (variant === 'denied') { expect(screen.getByText(copy.workspaceDenied)).toBeVisible(); expect(screen.queryByRole('link', { name: copy.createWorkspace })).toBeNull() }
    if (variant === 'picker') {
      expect(calls()).toHaveLength(0)
      fireEvent.click(screen.getByRole('combobox', { name: copy.workspaceLabel }))
      const option = await screen.findByRole('option', { name: 'Synthetic Workspace' }); fireEvent.pointerDown(option); fireEvent.click(option)
      expect(await screen.findByRole('heading', { name: copy.empty })).toBeVisible()
      expect(calls()).toHaveLength(1)
    }
  }
  if (variant !== 'picker') expect(calls()).toHaveLength(0)
})

test.each(['es', 'en'])('loading announces the pending list in %s and StrictMode sends one GET', async (locale) => {
  await i18n.changeLanguage(locale)
  requests = setup({ [`GET ${path}`]: () => new Promise<Response>(() => {}) }); open()
  expect(await screen.findByRole('status', { name: locale === 'es' ? 'Cargando servidores MCP' : 'Loading MCP servers' })).toHaveAttribute('aria-busy', 'true')
  await waitFor(() => expect(calls()).toHaveLength(1))
})

test('switching workspaces aborts the pending GET, encodes the new workspace id and ignores stale rows', async () => {
  let resolve!: (response: Response) => void
  let signal: AbortSignal | undefined
  requests = setup({
    [`GET ${path}`]: (init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>((done) => { resolve = done }) },
    [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [buildWorkspaceCollectionFixture().items[0], { ...buildWorkspaceCollectionFixture().items[0], workspaceId: 'synthetic/other', displayName: 'Other workspace' }] },
    'GET /v1/mcp/workspaces/synthetic%2Fother/servers': { items: [{ serverId: 'srv_new', name: 'New workspace server', status: 'draft', version: 'v2' }] },
  })
  open('synthetic-workspace'); await waitFor(() => expect(calls()).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }))
  expect(await screen.findByRole('link', { name: 'New workspace server' })).toBeVisible()
  expect(signal?.aborted).toBe(true)
  await act(async () => resolve(Response.json({ items: [{ serverId: 'old', name: 'Stale server', status: 'draft' }] })))
  expect(screen.queryByRole('link', { name: 'Stale server' })).toBeNull()
  expect(requests.mock.mock.calls.filter(([url]) => String(url).includes('synthetic%2Fother'))).toHaveLength(1)
})

test('unmounting cancels the list request', async () => {
  let signal: AbortSignal | undefined
  requests = setup({ [`GET ${path}`]: (init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>(() => {}) } })
  const rendered = open(); await waitFor(() => expect(calls()).toHaveLength(1)); rendered.unmount()
  expect(signal?.aborted).toBe(true)
})
