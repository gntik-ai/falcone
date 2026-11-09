import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import { persistConsoleShellSession } from '@in-falcone/console-api/session'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import ConsoleWorkspacesPage from '../src/pages/consoleWorkspaces'
import { useConsoleContext } from '../src/shell/context'
import { usePermissions } from '../src/shell/permissions'
import { login, strictFetch } from './shell-support'
import { available, exhausted, tenant, tenantId, quotasPath, overviewPath, createPath, rawMessage, success } from './parity/pages/console-workspaces-page.manifest'
import es from '../src/locales/es/pages.console-workspaces-page.json'
import en from '../src/locales/en/pages.console-workspaces-page.json'
import i18n from '../src/i18n'

vi.mock('../src/shell/context', () => ({ useConsoleContext: vi.fn() }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: vi.fn() }))
let requests: ReturnType<typeof strictFetch>
const context = () => ({ tenants: [tenant], workspaces: [], activeTenantId: tenantId, activeWorkspaceId: 'synthetic-workspace', loading: false, error: null, selectTenant: vi.fn(), selectWorkspace: vi.fn() })
const calls = () => requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }))
const creates = () => calls().filter(({ path, method }) => path === createPath && method === 'POST')
const fail = (status: number) => () => Response.json({ code: `HTTP_${status}`, message: rawMessage, requestId: 'synthetic-workspaces-request' }, { status })
function setup(overrides: Record<string, unknown> = {}) { requests = strictFetch({ [`GET ${quotasPath}`]: available, [`GET ${overviewPath}`]: { hardLimitDimensions: [] }, [`POST ${createPath}`]: success, ...overrides }) }
const open = () => render(<StrictMode><MemoryRouter><ConsoleWorkspacesPage /></MemoryRouter></StrictMode>)
const button = (name: string) => screen.getByRole('button', { name })
const next = () => fireEvent.click(button(es.next))
const change = (label: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name: new RegExp(label) }), { target: { value } })
async function ready() { await waitFor(() => expect(calls().filter(({ method }) => method === 'GET')).toHaveLength(2)); await act(async () => { await Promise.resolve() }) }
async function nameStep() { await ready(); fireEvent.click(button(es.create)); next(); await waitFor(() => expect(screen.getByRole('textbox', { name: new RegExp(es.nameLabel) })).toHaveFocus()) }
async function config() { await nameStep(); change(es.nameLabel, '  Synthetic workspace  '); next(); expect(screen.getByRole('textbox', { name: es.maxFunctions })).toHaveValue('10') }
async function summary() { await config(); change(es.description, 'Synthetic description'); next(); expect(screen.getByRole('heading', { name: es.summary })).toBeVisible() }
beforeEach(() => { login(['tenant_admin'], [tenantId]); vi.mocked(usePermissions).mockReturnValue(getConsolePermissions(['tenant_admin'])); vi.mocked(useConsoleContext).mockReturnValue(context()); vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => {
  requests?.verify()
  if (requests) expect(calls().every(({ path }) => [quotasPath, overviewPath, createPath, '/v1/auth/login-sessions/synthetic-session/refresh'].includes(path) || path.startsWith('/v1/metrics/tenants/platform/'))).toBe(true)
})

test.each(['es', 'en'] as const)('renders legacy header and inventory with exactly two tenant GETs in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open(); await ready(); const c = locale === 'es' ? es : en
  expect(screen.getByRole('heading', { name: c.title })).toBeVisible(); expect(screen.getByRole('heading', { name: c.inventory })).toBeVisible(); expect(screen.getByText(c.inventoryDescription)).toBeVisible(); expect(screen.getByText(tenant.displayName)).toBeVisible(); expect(button(c.create)).toBeVisible()
  expect(calls()).toEqual([{ method: 'GET', path: quotasPath, body: undefined }, { method: 'GET', path: overviewPath, body: undefined }]); expect(document.documentElement.lang).toBe(locale)
})
test.each(['es', 'en'] as const)('hides the action for viewers with role and hidden recourse in %s', async (locale) => {
  await i18n.changeLanguage(locale); vi.mocked(usePermissions).mockReturnValue(getConsolePermissions(['tenant_viewer'])); setup(); open(); await ready(); const c = locale === 'es' ? es : en
  expect(screen.queryByRole('button', { name: c.create })).toBeNull(); const badge = screen.getByTestId('workspaces-read-only-indicator'); expect(badge).toHaveTextContent(c.roleLabels.tenant_viewer); expect(badge.querySelector('.sr-only')).toHaveTextContent(c.reasons.tenant_viewer)
})
test.each(['es', 'en'] as const)('renders first run and blocks Next without requests in %s', async (locale) => {
  await i18n.changeLanguage(locale); vi.mocked(useConsoleContext).mockReturnValue({ ...context(), activeTenantId: null }); setup(); open(); const c = locale === 'es' ? es : en
  expect(screen.getByText(c.noTenantSelected)).toBeVisible(); expect(screen.getByRole('heading', { name: c.noTenant })).toBeVisible(); fireEvent.click(button(c.create)); expect(button(c.next)).toBeDisabled(); expect(screen.getAllByText(c.tenantRequired).length).toBeGreaterThan(0); expect(calls()).toEqual([])
})
test('independently checks wizard permission and returns focus on Escape', async () => {
  setup(); open(); await ready(); const session = login(['tenant_admin'], [tenantId]); session.principal!.platformRoles = ['tenant_viewer']; persistConsoleShellSession(session)
  fireEvent.click(button(es.create)); expect(screen.getByRole('heading', { name: es.blocked })).toBeVisible(); expect(screen.queryByRole('button', { name: es.next })).toBeNull(); expect(creates()).toEqual([])
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); await waitFor(() => expect(button(es.create)).toHaveFocus())
})
test('blocks whitespace-only names with linked validation and no POST', async () => {
  setup(); open(); await nameStep(); change(es.nameLabel, '   '); const input = screen.getByRole('textbox', { name: new RegExp(es.nameLabel) })
  expect(input).toHaveAttribute('aria-invalid', 'true'); expect(input).toHaveAccessibleDescription(es.nameRequired); expect(button(es.next)).toBeDisabled(); fireEvent.submit(document.getElementById('workspace-step')!); expect(input).toBeVisible(); expect(creates()).toEqual([])
})
test.each(['maxFunctions', 'maxDatabases'] as const)('preserves the required integer matrix for %s', async (key) => {
  setup(); open(); await config(); const label = es[key], input = screen.getByRole('textbox', { name: label })
  for (const value of ['', '0', '1.5', '1e3', 'abc', '5 5', '9007199254740992']) {
    change(label, value); const expected = !value ? `${label} es obligatorio.` : ['0', '9007199254740992'].includes(value) ? `${label} debe estar entre 1 y 9007199254740991.` : `${label} debe ser un número entero.`
    expect(input).toHaveAttribute('aria-invalid', 'true'); expect(input).toHaveAccessibleDescription(expected); expect(button(es.next)).toBeDisabled(); expect(creates()).toEqual([])
  }
  change(label, ' 7 '); expect(input).toHaveAttribute('aria-invalid', 'false'); next(); fireEvent.click(button(es.finish)); await within(await screen.findByTestId('workspace-create-success')).findByRole('heading', { name: es.successTitle }); expect(creates()[0].body.initialLimits[key]).toBe(7)
})
test('shows defaults and summary and submits exactly once with legacy payload and headers', async () => {
  setup(); open(); await summary(); expect(screen.getByText('10')).toBeVisible(); expect(screen.getByText('5')).toBeVisible(); expect(screen.getByText(tenantId)).toBeVisible(); expect(screen.getByText('Synthetic description')).toBeVisible()
  fireEvent.click(button(es.finish)); fireEvent.click(button(es.confirming)); await within(await screen.findByTestId('workspace-create-success')).findByRole('heading', { name: es.successTitle })
  expect(creates()).toEqual([{ method: 'POST', path: createPath, body: { name: '  Synthetic workspace  ', description: 'Synthetic description', initialLimits: { maxFunctions: 10, maxDatabases: 5 } } }])
  const init = requests.mock.mock.calls.find(([, init]) => init?.method === 'POST')![1]!
  expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy(); expect(new Headers(init.headers).get('X-Request-Id')).toMatch(/^wiz_/)
  expect(await screen.findByRole('region', { name: es.notifications })).toHaveTextContent(es.successAnnouncement.replace('{id}', success.workspaceId)); expect(screen.queryByRole('button', { name: es.finish })).toBeNull()
  fireEvent.click(button(es.exit)); await waitFor(() => expect(button(es.create)).toHaveFocus()); expect(creates()).toHaveLength(1)
})
test('submits a step on Enter and exits without writing', async () => {
  setup(); open(); await nameStep(); change(es.nameLabel, 'Synthetic workspace'); fireEvent.submit(document.getElementById('workspace-step')!); expect(screen.getByRole('textbox', { name: es.maxFunctions })).toBeVisible()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); await waitFor(() => expect(button(es.create)).toHaveFocus()); expect(creates()).toEqual([])
})
test('waits for quota skeletons without moving focus and blocks exhausted posture', async () => {
  let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve })
  setup({ [`GET ${quotasPath}`]: async () => { await pending; return Response.json(exhausted) } }); open(); await waitFor(() => expect(calls()).toHaveLength(2)); fireEvent.click(button(es.create)); next(); change(es.nameLabel, 'Synthetic workspace')
  const input = screen.getByRole('textbox', { name: new RegExp(es.nameLabel) }); expect(screen.getByTestId('workspace-wizard').querySelector('[aria-busy="true"]')).toBeInTheDocument(); expect(button(es.next)).toBeDisabled(); await act(async () => { release() }); await screen.findByText(es.quotaExhausted); expect(input).toHaveFocus(); expect(button(es.next)).toBeDisabled(); expect(creates()).toEqual([])
})
test('preserves the rounded quota threshold and platform exception', async () => {
  setup({ [`GET ${quotasPath}`]: { dimensions: [{ dimensionId: 'workspaces.count', hardLimit: 200, measuredValue: 199 }] } }); const view = open(); await nameStep(); change(es.nameLabel, 'Synthetic workspace'); expect(button(es.next)).toBeDisabled(); view.unmount()
  vi.mocked(useConsoleContext).mockReturnValue({ ...context(), activeTenantId: 'platform' }); setup({ 'GET /v1/metrics/tenants/platform/quotas': exhausted, 'GET /v1/metrics/tenants/platform/overview': { hardLimitDimensions: ['workspaces.count'] } }); open(); await nameStep(); change(es.nameLabel, 'Synthetic workspace'); expect(button(es.next)).toBeEnabled()
})
for (const path of [quotasPath, overviewPath]) for (const kind of [403, 404, 500, 'network'] as const) {
  test(`fails open on ${path} ${kind} and retries both once with name focus restored`, async () => {
    let count = 0
    setup({ [`GET ${path}`]: () => { if (++count > 1) return Response.json(path === quotasPath ? available : { hardLimitDimensions: [] }); if (kind === 'network') throw new TypeError(rawMessage); return fail(kind)() } }); open(); await nameStep(); change(es.nameLabel, 'Synthetic workspace')
    expect(button(es.next)).toBeEnabled(); expect(screen.getByRole('heading', { name: kind === 403 ? es.quotaDenied : kind === 404 ? es.quotaNotFound : es.quotaFailure })).toBeVisible()
    const retry = button(es.retry); retry.focus(); fireEvent.click(retry); await waitFor(() => expect(screen.getByRole('textbox', { name: new RegExp(es.nameLabel) })).toHaveFocus()); expect(screen.queryByRole('button', { name: es.retry })).toBeNull()
    expect(calls().filter(({ path }) => path === quotasPath)).toHaveLength(2); expect(calls().filter(({ path }) => path === overviewPath)).toHaveLength(2); expect(creates()).toEqual([])
  })
}
test.each([403, 404, 500, 'network'] as const)('keeps retry focus on another %s quota failure', async (kind) => {
  setup({ [`GET ${quotasPath}`]: kind === 'network' ? () => { throw new TypeError(rawMessage) } : fail(kind) }); open(); await nameStep(); const retry = button(es.retry); retry.focus(); fireEvent.click(retry)
  await waitFor(() => expect(calls().filter(({ path }) => path === quotasPath)).toHaveLength(2)); await waitFor(() => expect(button(es.retry)).toHaveFocus())
})
for (const locale of ['es', 'en'] as const) for (const kind of [403, 404, 409, 422, 500, 'network'] as const) {
  test(`maps create ${kind} to ${locale} namespace copy with collapsed technical details`, async () => {
    setup({ [`POST ${createPath}`]: kind === 'network' ? () => { throw new TypeError(rawMessage) } : fail(kind) }); open(); await summary(); await act(async () => { await i18n.changeLanguage(locale) }); const c = locale === 'es' ? es : en
    fireEvent.click(button(c.finish)); const title = kind === 403 ? c.deniedTitle : kind === 404 ? c.notFoundTitle : c.failureTitle; const heading = await screen.findByRole('heading', { name: title })
    const description = kind === 403 ? c.deniedDescription : kind === 404 ? c.notFoundDescription : kind === 409 ? c.conflict : kind === 422 ? c.invalidData : c.failureDescription
    expect(screen.getAllByText(description).length).toBeGreaterThan(0); const details = button(c.details); expect(details).toHaveAttribute('aria-expanded', 'false'); expect(screen.queryByText(rawMessage)).toBeNull()
    const announcements = [...document.querySelectorAll('[aria-live], [role="alert"]')].map((node) => node.textContent).join(' '); expect(announcements).not.toContain(rawMessage); expect(announcements).not.toContain('synthetic-workspaces-request')
    await waitFor(() => expect(screen.getByTestId('workspace-wizard').querySelector('[data-live-announcer="assertive"]')).toHaveTextContent(`${title} ${description}`))
    if (kind === 403 || kind === 404) await waitFor(() => expect(heading).toHaveFocus())
    fireEvent.click(details); expect(details).toHaveAttribute('aria-expanded', 'true'); if (kind !== 'network') expect(screen.getByText(new RegExp(rawMessage))).toBeVisible()
    fireEvent.click(button(c.backSummary)); await waitFor(() => expect(button(c.finish)).toHaveFocus()); expect(screen.getByText('Synthetic description')).toBeVisible(); expect(creates()).toHaveLength(1)
  })
}
test.each([500, 'network'] as const)('retries create %s with the same payload', async (kind) => {
  let count = 0
  setup({ [`POST ${createPath}`]: () => { if (++count > 1) return Response.json(success); if (kind === 'network') throw new TypeError(rawMessage); return fail(kind)() } }); open(); await summary(); fireEvent.click(button(es.finish)); await screen.findByRole('button', { name: es.retry }); fireEvent.click(button(es.retry)); await within(await screen.findByTestId('workspace-create-success')).findByRole('heading', { name: es.successTitle }); expect(creates()).toHaveLength(2); expect(creates()[0].body).toEqual(creates()[1].body)
})
test('refreshes a create 401 once with the same payload and fresh Idempotency-Key', async () => {
  let count = 0
  setup({ [`POST ${createPath}`]: () => ++count === 1 ? fail(401)() : Response.json(success), 'POST /v1/auth/login-sessions/synthetic-session/refresh': buildConsoleRefreshSessionFixture() }); open(); await summary(); fireEvent.click(button(es.finish)); await within(await screen.findByTestId('workspace-create-success')).findByRole('heading', { name: es.successTitle }); expect(creates()).toHaveLength(2); expect(creates()[0].body).toEqual(creates()[1].body)
  const posts = requests.mock.mock.calls.filter(([path, init]) => path === createPath && init?.method === 'POST'); expect(new Headers(posts[0][1]!.headers).get('Idempotency-Key')).not.toEqual(new Headers(posts[1][1]!.headers).get('Idempotency-Key')); expect(calls().filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1)
})
test('drops pending posture and entered data on a tenant switch', async () => {
  let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve })
  setup({ [`GET ${quotasPath}`]: async () => { await pending; return Response.json(exhausted) } }); const view = open(); await waitFor(() => expect(calls()).toHaveLength(2)); fireEvent.click(button(es.create)); next(); change(es.nameLabel, 'Previous tenant data')
  vi.mocked(useConsoleContext).mockReturnValue({ ...context(), activeTenantId: null }); view.rerender(<MemoryRouter><ConsoleWorkspacesPage /></MemoryRouter>); await act(async () => release()); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('heading', { name: es.noTenant })).toBeVisible(); expect(creates()).toEqual([])
})

test('applies an exhausted posture after a successful quota retry', async () => {
  let count = 0
  setup({ [`GET ${quotasPath}`]: () => ++count === 1 ? fail(500)() : Response.json(exhausted) }); open(); await nameStep(); change(es.nameLabel, 'Synthetic workspace'); expect(button(es.next)).toBeEnabled()
  fireEvent.click(button(es.retry)); await screen.findByText(es.quotaExhausted); expect(screen.queryByRole('button', { name: es.retry })).toBeNull(); expect(button(es.next)).toBeDisabled(); await waitFor(() => expect(screen.getByRole('textbox', { name: new RegExp(es.nameLabel) })).toHaveFocus()); expect(creates()).toEqual([])
})
test.each(['tenant_owner', 'tenant_admin', 'tenant_developer', 'tenant_viewer'])('ports the legacy create permission for %s', async (role) => {
  vi.mocked(usePermissions).mockReturnValue(getConsolePermissions([role])); setup(); open(); await ready()
  expect(Boolean(screen.queryByRole('button', { name: es.create }))).toBe(['tenant_owner', 'tenant_admin'].includes(role))
})
