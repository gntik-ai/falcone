import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import { persistConsoleShellSession, readConsoleShellSession } from '@in-falcone/console-api/session'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import ConsoleMembersPage from '../src/pages/consoleMembers'
import { useConsoleContext } from '../src/shell/context'
import { usePermissions } from '../src/shell/permissions'
import { login, strictFetch } from './shell-support'
import { accepted, collection, firstUsers, invitationsPath, manyUsers, nextUsers, pending, proof, realmId, roles, rolesGet, tenant, tenantId, users, workspaceId } from './parity/pages/console-members-page.manifest'
import es from '../src/locales/es/pages.console-members-page.json'
import en from '../src/locales/en/pages.console-members-page.json'
import i18n from '../src/i18n'

vi.mock('../src/shell/context', () => ({ useConsoleContext: vi.fn() }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: vi.fn() }))
let requests: ReturnType<typeof strictFetch>
const context = () => ({ tenants: [tenant], workspaces: [], activeTenantId: tenantId, activeWorkspaceId: workspaceId, loading: false, error: null, selectTenant: vi.fn(), selectWorkspace: vi.fn() })
const metrics = [`/v1/metrics/tenants/${tenantId}/quotas`, `/v1/metrics/tenants/${tenantId}/overview`, `/v1/metrics/workspaces/${workspaceId}/quotas`, `/v1/metrics/workspaces/${workspaceId}/overview`]
const calls = () => requests.mock.mock.calls.map(([path, init]) => ({ path: String(path), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }))
const writes = () => calls().filter(({ method }) => method === 'POST')
const failure = (status: number) => () => Response.json({ code: 'OTHER_CODE', message: 'synthetic-raw-message', requestId: 'synthetic-request' }, { status })
function setup(overrides: Record<string, unknown> = {}) {
  requests = strictFetch({ [`GET ${firstUsers}`]: collection(users), [`GET ${rolesGet}`]: collection(roles), [`GET ${invitationsPath}`]: { items: [pending, accepted] }, [`POST ${invitationsPath}`]: proof, [`POST /v1/tenants/${tenantId}/users`]: {}, ...Object.fromEntries(metrics.map((path) => [`GET ${path}`, { dimensions: [] }])), ...overrides })
}
const open = () => render(<StrictMode><MemoryRouter><ConsoleMembersPage /></MemoryRouter></StrictMode>)
const ready = () => screen.findByRole('table', { name: es.usersTable })
const next = () => fireEvent.click(screen.getByRole('button', { name: es.next }))
async function openInvite() { await ready(); fireEvent.click(screen.getByRole('button', { name: es.invite })); await waitFor(() => expect(screen.getByRole('heading', { name: es.invite })).toHaveFocus()) }
async function summary() {
  await openInvite(); next(); fireEvent.change(screen.getByRole('textbox', { name: new RegExp(es.email) }), { target: { value: 'guest@example.test' } })
  await waitFor(() => expect(calls().filter(({ path }) => path.startsWith('/v1/metrics/'))).toHaveLength(4))
  await act(async () => { await Promise.resolve() }); next()
  fireEvent.click(screen.getByRole('combobox', { name: es.role })); const option = await screen.findByRole('option', { name: es.workspaceRoles.workspace_developer }); fireEvent.pointerDown(option); fireEvent.click(option); next()
  expect(screen.getByRole('heading', { name: es.summary })).toBeVisible()
}
beforeEach(() => { login(['tenant_owner'], [tenantId]); vi.mocked(usePermissions).mockReturnValue(getConsolePermissions(['tenant_owner'])); vi.mocked(useConsoleContext).mockReturnValue(context()); vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => requests?.verify())

test.each(['es', 'en'] as const)('ports legacy users, roles and invitation rows in %s without metrics at mount', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open(); const c = locale === 'es' ? es : en
  const table = await screen.findByRole('table', { name: c.usersTable })
  expect(within(table).getByText('alice')).toBeVisible(); expect(within(table).getByText('UPDATE_PASSWORD')).toBeVisible()
  expect(screen.getByRole('table', { name: c.rolesTable })).toHaveTextContent(c.composite)
  expect(screen.getAllByRole('button', { name: c.revokeNamed.replace('{id}', pending.id) })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: c.revokeNamed.replace('{id}', accepted.id) })).toBeNull()
  expect(screen.queryByRole('button', { name: c.resendNamed.replace('{id}', accepted.id) })).toBeNull()
  expect(calls().map(({ path }) => path).sort()).toEqual([firstUsers, rolesGet, invitationsPath].sort())
})
test.each(['tenant', 'realm'])('renders the legacy empty state with no page calls when %s is absent', async (kind) => {
  vi.mocked(useConsoleContext).mockReturnValue({ ...context(), ...(kind === 'tenant' ? { activeTenantId: null } : { tenants: [{ ...tenant, identityContext: {} }] }) })
  setup(); open(); expect(screen.getByRole('heading', { name: kind === 'tenant' ? es.noTenant : es.noRealm })).toBeVisible(); expect(calls()).toEqual([])
})
test('holds every users row until continuation completes, preserves roles, and deduplicates overlap', async () => {
  let release!: () => void
  const pendingPage = new Promise<void>((resolve) => { release = resolve })
  setup({ [`GET ${firstUsers}`]: collection(manyUsers.slice(0, 100), 'synthetic-cursor'), [`GET ${nextUsers}`]: async () => { await pendingPage; return Response.json(collection(manyUsers.slice(99))) } })
  open(); await screen.findByRole('table', { name: es.rolesTable }); expect(screen.getByRole('status', { name: es.usersLoading })).toBeVisible(); expect(screen.queryByText('synthetic-user-0')).toBeNull()
  release(); const table = await ready(); expect(within(table).getAllByRole('row')).toHaveLength(151)
  expect(calls().filter(({ path }) => path.includes('/users')).map(({ path }) => path)).toEqual([firstUsers, nextUsers])
})
test.each(['500', 'network', 'repeated'])('discards partial users on %s continuation and retries from the first page only', async (kind) => {
  let attempt = 0
  setup({ [`GET ${firstUsers}`]: () => Response.json(++attempt === 1 ? collection(manyUsers.slice(0, 100), 'synthetic-cursor') : collection(users)), [`GET ${nextUsers}`]: kind === '500' ? failure(500) : kind === 'network' ? () => { throw new TypeError('synthetic-network') } : collection(users, 'synthetic-cursor') })
  open(); await screen.findByRole('button', { name: es.usersRetry }); expect(screen.queryByText('synthetic-user-0')).toBeNull(); expect(screen.getByRole('table', { name: es.rolesTable })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: es.usersRetry })); await ready()
  expect(calls().filter(({ path }) => path.includes('/users')).map(({ path }) => path)).toEqual([firstUsers, nextUsers, firstUsers])
})
test.each(['users', 'roles'] as const)('isolates %s 403 and maps any 404 to an overview link', async (section) => {
  const path = section === 'users' ? firstUsers : rolesGet
  setup({ [`GET ${path}`]: failure(403) }); const view = open(); await screen.findByRole('heading', { name: es.noAccess }); expect(screen.getByRole('table', { name: section === 'users' ? es.rolesTable : es.usersTable })).toBeVisible()
  view.unmount(); setup({ [`GET ${path}`]: failure(404) }); open(); expect(await screen.findByRole('link', { name: es.backOverview })).toHaveAttribute('href', '/console/overview')
})
test.each(['users', 'roles'] as const)('maps %s 500 separately from network failure and retries only that list', async (section) => {
  let fail = true
  const path = section === 'users' ? firstUsers : rolesGet
  setup({ [`GET ${path}`]: () => fail ? failure(500)() : Response.json(collection(section === 'users' ? users : roles)) }); open()
  const retry = await screen.findByRole('button', { name: es[`${section}Retry`] }); expect(screen.getAllByText(es.serviceUnavailable).length).toBeGreaterThan(0)
  fail = false; fireEvent.click(retry); await screen.findByRole('table', { name: es[`${section}Table`] })
  expect(calls().filter(({ path: candidate }) => candidate === (section === 'users' ? rolesGet : firstUsers))).toHaveLength(1)
})
test('a tenant switch during loading never exposes the previous rows', async () => {
  let release!: () => void
  const delayed = new Promise<void>((resolve) => { release = resolve })
  setup({ [`GET ${firstUsers}`]: async () => { await delayed; return Response.json(collection(users)) }, 'GET /v1/iam/realms/synthetic-other-realm/users?page%5Bsize%5D=100': collection([]), 'GET /v1/iam/realms/synthetic-other-realm/roles?page%5Bsize%5D=100': collection([]), 'GET /v1/tenants/synthetic-other/invitations': { items: [] } })
  const view = open(); await screen.findByRole('table', { name: es.rolesTable })
  vi.mocked(useConsoleContext).mockReturnValue({ ...context(), activeTenantId: 'synthetic-other', tenants: [{ ...tenant, tenantId: 'synthetic-other', identityContext: { consoleUserRealm: 'synthetic-other-realm' } }] })
  view.rerender(<MemoryRouter><ConsoleMembersPage /></MemoryRouter>); release(); await screen.findByRole('heading', { name: es.usersEmpty }); expect(screen.queryByText('alice')).toBeNull()
})
test('hides management and invitations for viewers, exposing role and reason', async () => {
  vi.mocked(usePermissions).mockReturnValue(getConsolePermissions(['tenant_viewer'])); setup(); open(); await ready()
  expect(screen.queryByRole('button', { name: es.invite })).toBeNull(); expect(screen.queryByRole('button', { name: es.create })).toBeNull()
  expect(screen.getByLabelText(new RegExp(es.roleLabels.tenant_viewer))).toBeVisible(); expect(calls().some(({ path }) => path === invitationsPath)).toBe(false)
})
test('rechecks persisted roles at open and blocks without metrics or invitation POST', async () => {
  setup(); open(); await ready(); const session = login(['tenant_owner'], [tenantId]); session.principal!.platformRoles = ['tenant_viewer']; persistConsoleShellSession(session)
  await openInvite(); expect(screen.getByRole('heading', { name: es.blocked })).toBeVisible(); expect(calls().some(({ path }) => path.includes('/metrics/'))).toBe(false); expect(writes()).toEqual([])
  fireEvent.keyDown(screen.getByTestId('members-invite'), { key: 'Escape' }); await waitFor(() => expect(screen.getByRole('button', { name: es.invite })).toHaveFocus())
})
test('uses four steps, focuses heading, marks invalid email and role, and enables summary edits', async () => {
  setup(); open(); await openInvite(); expect(screen.queryByLabelText(/mensaje/i)).toBeNull(); next()
  expect(screen.getByRole('button', { name: es.next })).toBeEnabled(); next(); expect(await screen.findByRole('alert')).toHaveTextContent(es.emailInvalid)
  expect(screen.getAllByText(new RegExp(es.stepError)).length).toBeGreaterThan(0)
  const fullStepper = screen.getAllByRole('navigation', { name: es.steps })[0]
  expect(fullStepper.querySelector('[aria-current="step"]')).toHaveTextContent(es.email)
  fireEvent.change(screen.getByRole('textbox', { name: new RegExp(es.email) }), { target: { value: 'guest@example.test' } }); await act(async () => { await Promise.resolve() }); next(); next(); expect(screen.getByRole('alert')).toHaveTextContent(es.roleRequired)
  fireEvent.click(screen.getByRole('combobox', { name: es.role })); const option = await screen.findByRole('option', { name: es.workspaceRoles.workspace_developer }); fireEvent.pointerDown(option); fireEvent.click(option); next()
  fireEvent.click(screen.getByRole('button', { name: es.editNamed.replace('{name}', es.email) })); expect(screen.getByRole('textbox', { name: new RegExp(es.email) })).toHaveValue('guest@example.test'); expect(writes()).toEqual([])
})
test.each(['pending', 'exhausted', 'failed'])('blocks pending and exhausted quota but fails open for %s metrics', async (kind) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  setup({ [`GET ${metrics[2]}`]: kind === 'pending' ? async () => { await held; return Response.json({ dimensions: [] }) } : kind === 'exhausted' ? { dimensions: [{ dimensionId: 'members.count', hardLimit: 1, measuredValue: 1 }] } : failure(500) })
  open(); await openInvite(); next(); fireEvent.change(screen.getByRole('textbox', { name: new RegExp(es.email) }), { target: { value: 'guest@example.test' } })
  await waitFor(() => expect(calls().some(({ path }) => path === metrics[2])).toBe(true)); await act(async () => { await Promise.resolve() }); next()
  if (kind === 'failed') expect(screen.getByRole('combobox', { name: es.role })).toBeVisible()
  else { expect(screen.getByRole('alert')).toHaveTextContent(kind === 'pending' ? es.quotaPending : es.quotaExhausted); expect(writes()).toEqual([]) }
  if (release) await act(async () => release())
})
test.each(['close', 'escape'])('submits once on double Finish, focuses success and clears the proof on %s', async (exit) => {
  setup(); open(); await summary(); const button = screen.getByRole('button', { name: es.finish }); fireEvent.click(button); fireEvent.click(button)
  expect(await screen.findByLabelText(es.oneTimeLink)).toHaveValue(`${location.origin}/invitations/${tenantId}/${proof.id}#token=${proof.token}`)
  expect(writes()).toEqual([{ method: 'POST', path: invitationsPath, body: { email: 'guest@example.test', role: 'workspace_developer', workspaceId } }])
  const init = requests.mock.mock.calls.find(([, init]) => init?.method === 'POST')![1]!
  expect(new Headers(init.headers).get('X-Request-Id')).toMatch(/^wiz/); expect(new Headers(init.headers).get('Idempotency-Key')).toBeTruthy()
  expect(JSON.stringify({ localStorage, sessionStorage })).not.toContain(proof.token)
  expect([...document.querySelectorAll('[aria-live]')].map((node) => node.textContent).join(' ')).not.toContain(proof.token)
  expect(location.search + location.hash).not.toContain(proof.token)
  expect(screen.queryByRole('button', { name: es.finish })).toBeNull()
  const heading = screen.getByRole('heading', { name: es.invitationReady })
  expect(heading).toHaveFocus()
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription(es.inviteHelp)
  if (exit === 'close') fireEvent.click(screen.getByRole('button', { name: es.close }))
  else fireEvent.keyDown(heading, { key: 'Escape' })
  await waitFor(() => expect(screen.getByRole('button', { name: es.invite })).toHaveFocus()); expect(screen.queryByLabelText(es.oneTimeLink)).toBeNull()
  await waitFor(() => expect(calls().filter(({ path, method }) => path === invitationsPath && method === 'GET')).toHaveLength(2))
})
test.each(['500', 'network'])('keeps summary and values after invitation %s, localizes error and restores Finish focus', async (kind) => {
  setup({ [`POST ${invitationsPath}`]: kind === '500' ? failure(500) : () => { throw new TypeError('synthetic-raw-message') } }); open(); await summary(); fireEvent.click(screen.getByRole('button', { name: es.finish }))
  expect(await screen.findByRole('alert')).toHaveTextContent(es.inviteFailure)
  expect(screen.getByRole('heading', { name: es.summary })).toBeVisible(); expect(screen.getByText('guest@example.test')).toBeVisible(); await waitFor(() => expect(screen.getByRole('button', { name: es.finish })).toHaveFocus())
  fireEvent.click(screen.getByRole('button', { name: es.finish })); await waitFor(() => expect(writes()).toHaveLength(2)); expect(screen.queryByText('synthetic-raw-message')).toBeNull()
})
test.each(['403', '500', 'network', 'success'])('creates with trimmed fields and keeps masked values on %s failure', async (kind) => {
  setup({ [`POST /v1/tenants/${tenantId}/users`]: kind === 'success' ? {} : kind === 'network' ? () => { throw new TypeError('synthetic-raw-message') } : failure(Number(kind)) }); open(); await ready()
  fireEvent.click(screen.getByRole('button', { name: es.create })); expect(screen.getByRole('textbox', { name: new RegExp(es.username) })).toHaveFocus()
  expect(screen.getByRole('button', { name: es.create })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox', { name: new RegExp(es.username) }), { target: { value: '  jdoe  ' } }); fireEvent.change(screen.getByLabelText(new RegExp(es.password)), { target: { value: '  synthetic-password-0001  ' } }); fireEvent.change(screen.getByRole('textbox', { name: new RegExp(es.email) }), { target: { value: 'jdoe@example.test' } })
  expect(screen.getByLabelText(new RegExp(es.password))).toHaveAttribute('type', 'password'); fireEvent.click(screen.getByRole('button', { name: es.create }))
  await waitFor(() => expect(writes()).toHaveLength(1)); expect(writes()[0].body).toEqual({ username: 'jdoe', password: 'synthetic-password-0001', email: 'jdoe@example.test', roles: ['tenant_developer'] })
  if (kind === 'success') { await waitFor(() => expect(screen.queryByLabelText(es.password)).toBeNull()); expect(calls().filter(({ path }) => path === firstUsers)).toHaveLength(2) }
  else { const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent(kind === '500' ? es.serviceUnavailable : kind === '403' ? /Acción restringida/ : es.createFailure); expect(screen.getByLabelText(new RegExp(es.password))).toHaveValue('  synthetic-password-0001  '); expect(screen.queryByText('synthetic-raw-message')).toBeNull() }
})
test.each(['success', 'failure'])('revoke and resend preserve legacy requests and row behaviour on %s', async (kind) => {
  setup({ [`POST ${invitationsPath}/${pending.id}/revocation`]: kind === 'success' ? {} : failure(500), [`POST ${invitationsPath}/${pending.id}/resend`]: kind === 'success' ? proof : failure(500) }); open(); await ready(); await screen.findByRole('table', { name: es.invitations })
  fireEvent.click(screen.getByRole('button', { name: es.revokeNamed.replace('{id}', pending.id) })); await waitFor(() => expect(writes()).toHaveLength(1))
  if (kind === 'failure') expect(await screen.findByRole('alert')).toHaveTextContent(es.revokeFailure)
  await screen.findByRole('table', { name: es.invitations }); await waitFor(() => expect(screen.getByRole('button', { name: es.resendNamed.replace('{id}', pending.id) })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: es.resendNamed.replace('{id}', pending.id) })); fireEvent.change(screen.getByRole('textbox', { name: new RegExp(es.resendEmail) }), { target: { value: 'guest@example.test' } }); fireEvent.click(screen.getByRole('button', { name: es.generateLink }))
  await waitFor(() => expect(writes()).toHaveLength(2)); expect(writes().map(({ body }) => body)).toEqual([{}, { email: 'guest@example.test' }])
  if (kind === 'success') { await screen.findByLabelText(es.oneTimeLink); fireEvent.click(screen.getByRole('button', { name: es.hideLink })); expect(screen.queryByLabelText(es.oneTimeLink)).toBeNull() }
  else { expect(await screen.findByRole('alert')).toHaveTextContent(es.resendFailure); expect(screen.getByRole('table', { name: es.invitations })).toHaveTextContent(pending.id) }
})
test.each(['500', 'network'])('failed invitations GET %s clears rows, offers retry and never renders raw errors', async (kind) => {
  setup({ [`GET ${invitationsPath}`]: kind === '500' ? failure(500) : () => { throw new TypeError('synthetic-raw-message') } }); open()
  expect(await screen.findByRole('alert')).toHaveTextContent(es.invitationsFailure); expect(screen.queryByText(pending.id)).toBeNull(); expect(screen.getByRole('button', { name: es.retry })).toBeVisible()
})
test('a failed invitations reload clears previously loaded rows', async () => {
  let loads = 0
  setup({ [`GET ${invitationsPath}`]: () => ++loads === 1 ? Response.json({ items: [pending] }) : failure(500)() })
  open(); await ready(); await screen.findByRole('table', { name: es.invitations })
  await openInvite(); fireEvent.click(screen.getByRole('button', { name: es.exit }))
  expect(await screen.findByRole('alert')).toHaveTextContent(es.invitationsFailure)
  expect(screen.queryByRole('table', { name: es.invitations })).toBeNull()
  expect(screen.queryByText(pending.id)).toBeNull()
})
test.each(['invite', 'resend'] as const)('clears the %s proof on tenant switch and unmount', async (kind) => {
  setup({ [`POST ${invitationsPath}/${pending.id}/resend`]: proof })
  const view = open()
  if (kind === 'invite') {
    await summary(); fireEvent.click(screen.getByRole('button', { name: es.finish }))
  } else {
    await ready(); await screen.findByRole('table', { name: es.invitations })
    fireEvent.click(screen.getByRole('button', { name: es.resendNamed.replace('{id}', pending.id) }))
    fireEvent.change(screen.getByRole('textbox', { name: es.resendEmail }), { target: { value: 'guest@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: es.generateLink }))
  }
  await screen.findByLabelText(es.oneTimeLink)
  vi.mocked(useConsoleContext).mockReturnValue({ ...context(), activeTenantId: null })
  view.rerender(<MemoryRouter><ConsoleMembersPage /></MemoryRouter>)
  expect(screen.queryByLabelText(es.oneTimeLink)).toBeNull()
  expect(document.querySelector('[data-testid="members-invite"]')).toBeNull()
  expect([...document.querySelectorAll('[inert]')].filter((node) => (node as HTMLElement).inert)).toEqual([])
  expect(JSON.stringify({ localStorage, sessionStorage })).not.toContain(proof.token)
  view.unmount(); expect(document.body.innerHTML).not.toContain(proof.token)
})
test('requires an active workspace before advancing and restores create-toggle focus', async () => {
  vi.mocked(useConsoleContext).mockReturnValue({ ...context(), activeWorkspaceId: null })
  setup(); open(); await openInvite(); next()
  expect(screen.getByRole('alert')).toHaveTextContent(es.workspaceRequired)
  expect(writes()).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: es.exit }))
  fireEvent.click(screen.getByRole('button', { name: es.create }))
  fireEvent.click(screen.getByRole('button', { name: es.close }))
  expect(screen.getByRole('button', { name: es.create })).toHaveFocus()
})
test('invitation 401 uses exactly one refresh and one replay with the same body and wizard request ID', async () => {
  let attempt = 0
  setup({ [`POST ${invitationsPath}`]: () => ++attempt === 1 ? failure(401)() : Response.json(proof), 'POST /v1/auth/login-sessions/synthetic-session/refresh': buildConsoleRefreshSessionFixture() }); open(); await summary(); fireEvent.click(screen.getByRole('button', { name: es.finish })); await screen.findByLabelText(es.oneTimeLink)
  expect(writes().map(({ path }) => path)).toEqual([invitationsPath, '/v1/auth/login-sessions/synthetic-session/refresh', invitationsPath])
  const posts = requests.mock.mock.calls.filter(([path]) => path === invitationsPath).filter(([, init]) => init?.method === 'POST')
  expect(posts[0][1]?.body).toEqual(posts[1][1]?.body); expect(new Headers(posts[0][1]?.headers).get('X-Request-Id')).toBe(new Headers(posts[1][1]?.headers).get('X-Request-Id'))
})

test.each([[401, es.inviteSessionExpired], [403, es.inviteDenied], [409, es.inviteConflict], [422, es.inviteInvalid]] as const)('keeps legacy localized invitation %s copy instead of backend messages', async (status, message) => {
  setup({ [`POST ${invitationsPath}`]: failure(status), 'POST /v1/auth/login-sessions/synthetic-session/refresh': buildConsoleRefreshSessionFixture() })
  open(); await summary(); fireEvent.click(screen.getByRole('button', { name: es.finish }))
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(screen.queryByText('synthetic-raw-message')).toBeNull()
  expect(screen.getByRole('heading', { name: es.summary })).toBeVisible()
  expect(screen.getByRole('button', { name: es.finish })).toHaveFocus()
})
test('reloads users when creation succeeds after the create panel was closed', async () => {
  let release!: () => void
  const pendingCreate = new Promise<void>((resolve) => { release = resolve })
  setup({ [`POST /v1/tenants/${tenantId}/users`]: async () => { await pendingCreate; return Response.json({}) } })
  open(); await ready(); fireEvent.click(screen.getByRole('button', { name: es.create }))
  fireEvent.change(screen.getByRole('textbox', { name: new RegExp(es.username) }), { target: { value: 'jdoe' } })
  fireEvent.change(screen.getByLabelText(new RegExp(es.password)), { target: { value: 'synthetic-password-0001' } })
  fireEvent.click(screen.getByRole('button', { name: es.create })); await waitFor(() => expect(writes()).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: es.close })); expect(screen.queryByLabelText(new RegExp(es.password))).toBeNull()
  await act(async () => release())
  await waitFor(() => expect(calls().filter(({ path }) => path === firstUsers)).toHaveLength(2))
  await ready(); expect(screen.getByRole('button', { name: es.create })).toHaveFocus()
})
test.each(['revoke', 'resend'])('clears a failed %s error when closing the wizard reloads invitations', async (action) => {
  setup({ [`POST ${invitationsPath}/${pending.id}/${action === 'revoke' ? 'revocation' : 'resend'}`]: failure(500) })
  open(); await ready(); await screen.findByRole('table', { name: es.invitations })
  fireEvent.click(screen.getByRole('button', { name: es[action === 'revoke' ? 'revokeNamed' : 'resendNamed'].replace('{id}', pending.id) }))
  if (action === 'resend') {
    fireEvent.change(screen.getByRole('textbox', { name: es.resendEmail }), { target: { value: 'guest@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: es.generateLink }))
  }
  expect(await screen.findByRole('alert')).toHaveTextContent(es[action === 'revoke' ? 'revokeFailure' : 'resendFailure'])
  await openInvite(); fireEvent.click(screen.getByRole('button', { name: es.exit }))
  await screen.findByRole('table', { name: es.invitations })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(calls().filter(({ path, method }) => path === invitationsPath && method === 'GET')).toHaveLength(2)
})
