import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, NavLink, useNavigate } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture, buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession, readProtectedRouteIntent } from '@in-falcone/console-api/session'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { pendingConsoleRoutes } from '../src/shell/routes'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { server, detailPath } from './parity/pages/console-mcp-server-detail-page.manifest'
import es from '../src/locales/es/pages.console-mcp-server-detail-page.json'
import en from '../src/locales/en/pages.console-mcp-server-detail-page.json'
import i18n from '../src/i18n'
import { mcpLocaleValues, forbiddenMcpCopy } from './parity/pages/consoleMcpServerDetail.locale'
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const route = '/console/mcp/servers/srv_1'
const routeWait = { timeout: 5000 }
function setup(variant = 'success', roles = ['superadmin']) {
  const initial = login(roles), fresh = buildConsoleRefreshSessionFixture(); fresh.principal = initial.principal
  let attempts = 0
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${detailPath}`]: () => ++attempts === 1 && variant !== 'success' ? Response.json({}, { status: 401 }) : Response.json(server),
    'POST /v1/auth/login-sessions/synthetic-session/refresh': () => variant === 'rejected' ? Response.json({}, { status: 401 }) : Response.json(fresh),
    'GET /v1/auth/signups/policy': buildConsoleSignupPolicyFixture(),
  })
  return { initial, fresh }
}
function open(basename = "") { return render(<MemoryRouter basename={basename || undefined} initialEntries={[`${basename}${route}`]}><App /></MemoryRouter>) }
test.each(['superadmin', 'tenant_viewer', 'workspace_viewer'])('the migrated /next route is available to authenticated %s sessions', async (role) => {
  setup('success', [role]); open('/next'); await screen.findByRole('heading', { name: 'Acme Orders' }, routeWait)
  expect(pendingConsoleRoutes.find(({ path }) => path === 'mcp/servers/:mcpServerId')?.migrated).toBe(true)
  expect(isMigratedRoute(route)).toBe(true)
  expect(requests.mock.mock.calls.filter(([url]) => url === detailPath)).toHaveLength(1)
})
test.each(['ok', 'rejected'])('detail 401 refresh %s preserves the exact replay and login return path', async (variant) => {
  const { initial, fresh } = setup(variant); open()
  if (variant === 'ok') await screen.findByRole('heading', { name: 'Acme Orders' }, routeWait)
  else {
    await screen.findByRole('heading', { name: 'Accede a In Falcone Console' }, routeWait)
    expect(readProtectedRouteIntent()).toBe(route); expect(readConsoleShellSession()).toBeNull()
  }
  const calls = requests.mock.mock.calls, reads = calls.filter(([url]) => url === detailPath), refreshes = calls.filter(([url]) => String(url).endsWith('/refresh'))
  expect(reads).toHaveLength(variant === 'ok' ? 2 : 1); expect(refreshes).toHaveLength(1)
  expect(refreshes[0][1]?.method).toBe('POST'); expect(JSON.parse(String(refreshes[0][1]?.body))).toEqual({ refreshToken: initial.tokenSet?.refreshToken })
  expect(new Headers(reads[0][1]?.headers).get('Authorization')).toBe(`Bearer ${initial.tokenSet?.accessToken}`)
  if (variant === 'ok') expect(new Headers(reads[1][1]?.headers).get('Authorization')).toBe(`Bearer ${fresh.tokenSet?.accessToken}`)
})
test('workspace retry reloads workspaces and selecting the picker sends exactly one detail GET', async () => {
  setup(); let attempts = 0
  const workspace = buildWorkspaceCollectionFixture().items[0]
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), [`GET ${workspaceUrl('synthetic-tenant')}`]: () => ++attempts === 1 ? Response.json({}, { status: 500 }) : Response.json({ items: [workspace, { ...workspace, workspaceId: 'other', displayName: 'Other' }] }),
    [`GET ${detailPath}`]: server,
  }); open()
  const error = await screen.findByRole('heading', { name: es.workspaceError }, routeWait)
  fireEvent.click(within(error.closest('section')!).getByRole('button', { name: es.retry }))
  const picker = await screen.findByRole('combobox', { name: es.workspaceLabel }, routeWait)
  expect(requests.mock.mock.calls.filter(([url]) => url === detailPath)).toHaveLength(0)
  fireEvent.click(picker); const option = await screen.findByRole('option', { name: 'Synthetic Workspace' }, routeWait); fireEvent.pointerDown(option); fireEvent.click(option)
  await screen.findByRole('heading', { name: 'Acme Orders' }, routeWait)
  expect(attempts).toBe(2); expect(requests.mock.mock.calls.filter(([url]) => url === detailPath)).toHaveLength(1)
})
function Arrival() {
  const navigate = useNavigate()
  return <><NavLink to={route}>Open MCP link</NavLink><button onClick={() => navigate(route)}>Open MCP programmatically</button><App /></>
}
test.each(['link', 'navigate'])('%s arrival resolves the lazy page through the shell', async (arrival) => {
  setup(); render(<MemoryRouter initialEntries={['/console/profile']}><Arrival /></MemoryRouter>)
  fireEvent.click(screen.getByRole(arrival === 'link' ? 'link' : 'button', { name: arrival === 'link' ? 'Open MCP link' : 'Open MCP programmatically' }))
  await screen.findByRole('heading', { name: 'Acme Orders' }, routeWait)
})

const workspaceLocaleCases = (['es', 'en'] as const).flatMap((locale) =>
  ['superadmin', 'tenant_owner', 'tenant_viewer'].map((role) => ({ locale, role })))
test.each(workspaceLocaleCases)('workspace-required copy belongs to the MCP page in $locale for $role without sending a detail GET', async ({ locale, role }) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  setup('success', [role])
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(),
    [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [] },
  })
  const geometry = vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  try {
    open()
    await screen.findByRole('heading', { name: copy.workspaceRequired }, routeWait)
    expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
    expect(screen.getByText(copy.workspaceDescription)).toBeVisible()
    if (role === 'tenant_viewer') {
      expect(screen.getByText(copy.workspaceDenied)).toBeVisible()
      expect(screen.queryByRole('link', { name: copy.createWorkspace })).toBeNull()
    } else expect(screen.getByRole('link', { name: copy.createWorkspace })).toHaveAttribute('href', '/console/workspaces')
    const values = mcpLocaleValues(), forbidden = await forbiddenMcpCopy(locale)
    expect(values).toContain(copy.workspaceRequired)
    expect(values).not.toContain('Select workspace')
    expect(values.filter((text) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text) || (locale === 'es' && forbidden.has(text)))).toEqual([])
    expect(document.documentElement.lang).toBe(locale)
    expect(requests.mock.mock.calls.filter(([url]) => url === detailPath)).toHaveLength(0)
  } finally { geometry.mockRestore() }
})
