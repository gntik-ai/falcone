import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession, readProtectedRouteIntent } from '@in-falcone/console-api/session'
import ConsoleSecretsPage, { SecretVersionBadge } from '../src/pages/consoleSecrets'
import { canRevoke, revokeVersion, type SecretRow } from '../src/pages/consoleSecrets/api'
import { ProtectedRoute } from '../src/shell/session'
import { login, renderWithSession, strictFetch } from './shell-support'
import { boundTenantId, inventoryBody, platformGet, platformRow, revokePath, tenantGet, tenantRow } from './parity/pages/console-secrets-page.manifest'
import { serverRows } from './parity/pages/console-mcp-servers-page.manifest'
import { ready as runtimeReady } from './parity/pages/consoleRuntime.manifest'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-secrets-page.json'
import en from '../src/locales/en/pages.console-secrets-page.json'

let requests: ReturnType<typeof strictFetch>
const setup = (routes: Record<string, unknown> = {}, platform: SecretRow[] = [platformRow], tenant: SecretRow[] = [tenantRow]) => {
  requests = strictFetch({ [`GET ${platformGet}`]: inventoryBody(platform), [`GET ${tenantGet}`]: inventoryBody(tenant), ...routes })
}
const calls = () => requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path), body: init?.body ? JSON.parse(String(init.body)) : undefined }))
const writes = () => calls().filter(({ method }) => method === 'POST')
const open = () => renderWithSession(<StrictMode><ConsoleSecretsPage /></StrictMode>)
const ready = () => screen.findByRole('table', { name: es.table })
const revoke = (name = tenantRow.name) => screen.getByRole('button', { name: `Revocar ${name}` })
const confirm = () => screen.getByRole('button', { name: es.confirm })
const typeName = (value = tenantRow.name) => fireEvent.change(screen.getByRole('textbox', { name: es.typedName }), { target: { value } })
const failure = (status: number) => () => Response.json({ code: `HTTP_${status}`, requestId: 'req_synthetic_secrets', message: 'synthetic-error' }, { status })
const openDialog = async (name = tenantRow.name) => { await ready(); fireEvent.click(revoke(name)); return screen.findByRole('alertdialog') }
beforeEach(() => { login(['superadmin'], [boundTenantId]); vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => requests?.verify())

test('keeps secrets labels from rejecting raw MCP and runtime metadata in the shared locale check', () => {
  // The shared parity check treats every differing English catalog value as forbidden
  // in Spanish, including catalogs belonging to pages that are not currently open.
  const flatten = (catalog: object, prefix = ''): [string, string][] => Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === 'string' ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`))
  const spanish = new Map(flatten(es))
  const forbidden = new Set(flatten(en).filter(([key, value]) => value !== spanish.get(key) && !value.includes('{')).map(([, value]) => value))
  const metadata = [runtimeReady.owner, ...serverRows.items.map((row) => row.lifecycleStatus)]
  expect(metadata.filter((value) => forbidden.has(value))).toEqual([])
})

test.each(['es', 'en'] as const)('ports legacy inventory, translated badge and kit primitives in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open()
  const copy = locale === 'es' ? es : en
  const table = await screen.findByRole('table', { name: copy.table })
  expect(screen.getByRole('heading', { name: copy.title, level: 1 })).toBeVisible()
  expect(within(table).getByText('app-password')).toBeVisible()
  expect(within(table).getByText(copy.states.active)).toBeVisible()
  expect(within(table).getByText(copy.states.grace)).toBeVisible()
  expect(screen.getByText(copy.returnedRows)).toBeVisible()
  expect(table.querySelector('time')).toHaveAttribute('datetime', new Date(platformRow.currentVersion!.activatedAt).toISOString())
  expect(document.querySelector('[class*="bg-white"]')).toBeNull()
  expect(calls()).toEqual([{ method: 'GET', path: platformGet, body: undefined }, { method: 'GET', path: tenantGet, body: undefined }])
  expect(screen.getByRole('link', { name: copy.rotateNamed.replace('{name}', tenantRow.name) })).toHaveAttribute('href', '/console/secrets/tenant%2Ftenant-a%2Fdb-password/rotate')
  expect(screen.getByRole('link', { name: copy.historyNamed.replace('{name}', tenantRow.name) })).toHaveAttribute('href', '/console/secrets/tenant%2Ftenant-a%2Fdb-password/rotate')
})
test('ports the version badge as translated text', () => {
  render(<SecretVersionBadge state="grace" />); expect(screen.getByText(es.states.grace)).toBeVisible()
})
test('shows skeleton until both GETs settle, then all 100 rows without pagination', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const many = (row: SecretRow) => Array.from({ length: 50 }, (_, index) => ({ ...row, name: `${row.name}-${index}`, path: `${row.path}-${index}` }))
  setup({ [`GET ${tenantGet}`]: async () => { await held; return Response.json(inventoryBody(many(tenantRow))) } }, many(platformRow)); open()
  expect(screen.getByRole('status', { name: es.loading })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
  release(); const table = await ready()
  expect(within(table).getAllByRole('row')).toHaveLength(101)
  expect(screen.getByText('100 secretos')).toBeVisible()
  expect(screen.queryByRole('navigation', { name: /pagination|paginación/i })).toBeNull()
  expect(calls()).toHaveLength(2)
})
test('empty inventories show the first-run copy without sample data or actions', async () => {
  setup({}, [], []); open(); expect(await screen.findByRole('heading', { name: es.empty })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull(); expect(screen.getByText('0 secretos')).toBeVisible(); expect(writes()).toEqual([])
})
test.each([
  ['other-tenant', { ...tenantRow, tenantId: 'tenant-b', path: 'tenant/tenant-b/db-password' }],
  ['nested-platform', { ...platformRow, path: 'platform/postgresql/app-password' }],
  ['null-version', { ...tenantRow, currentVersion: null }],
] as const)('disables %s without opening or sending a revoke', async (_kind, row) => {
  setup({}, row.domain === 'platform' ? [row] : [], row.domain === 'tenant' ? [row] : []); open(); await ready()
  const button = revoke(row.name); expect(button).toBeDisabled(); fireEvent.click(button)
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(writes()).toEqual([])
  expect(screen.getByRole('link', { name: `Rotar ${row.name}` })).toBeVisible()
  if (!row.currentVersion) { expect(screen.getAllByText(es.noActiveVersion)).toHaveLength(2); expect(document.querySelector('time')).toBeNull() }
  else expect(screen.getByText(es.unbound)).toBeVisible()
})
test.each([{ ids: [] }, { ids: ['tenant-a', 'tenant-b'] }, { ids: ['tenant-b'] }])('binds tenants only to the sole principal tenant $ids, independently of platform', ({ ids }) => {
  login(['tenant_viewer'], ids)
  expect(canRevoke(tenantRow, readConsoleShellSession())).toBe(false)
  expect(canRevoke(platformRow, readConsoleShellSession())).toBe(true)
})
test.each(['superadmin', 'tenant_owner', 'tenant_viewer'])('does not add role gating for %s', async (role) => {
  login([role], [boundTenantId]); setup(); open(); await ready(); expect(revoke()).toBeEnabled()
})
test('with no bound tenant the tenant GET has no tenantId and platform revoke remains available', async () => {
  login(); setup({ 'GET /v1/secrets/inventory?domain=tenant': inventoryBody([tenantRow]) }); open(); await ready()
  expect(revoke()).toBeDisabled(); expect(revoke(platformRow.name)).toBeEnabled()
  expect(calls().map(({ path }) => path)).toEqual([platformGet, '/v1/secrets/inventory?domain=tenant'])
})
test('requires exact typed name, preserves force behavior and cancels without a request', async () => {
  setup(); open(); const dialog = await openDialog()
  const input = within(dialog).getByRole('textbox', { name: es.typedName })
  await waitFor(() => expect(input).toHaveFocus())
  expect(confirm()).toBeDisabled(); typeName('DB-PASSWORD'); expect(confirm()).toBeDisabled()
  expect(screen.getByText(es.nameMismatch.replace('{name}', tenantRow.name))).toBeVisible()
  expect(screen.getByRole('checkbox', { name: es.force })).toHaveAttribute('aria-checked', 'true')
  fireEvent.click(screen.getByRole('checkbox', { name: es.force })); expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
  typeName(); expect(confirm()).toBeEnabled(); fireEvent.click(screen.getByRole('button', { name: es.cancel }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await waitFor(() => expect(revoke()).toHaveFocus())
  await openDialog(); expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true')
  fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape', code: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); await waitFor(() => expect(revoke()).toHaveFocus())
  await openDialog(platformRow.name); expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false')
  expect(screen.queryByText(es.lastVersionWarning)).toBeNull(); expect(writes()).toEqual([])
})
test.each([tenantRow, platformRow])('sends exactly the legacy revoke URL and body for $name, with no refetch', async (row) => {
  setup({ [`POST ${revokePath(row)}`]: { revokedVersion: row.currentVersion!.vaultVersion } }); open(); await openDialog(row.name)
  typeName(row.name); fireEvent.change(screen.getByRole('textbox', { name: es.justification }), { target: { value: 'synthetic justification' } }); fireEvent.click(confirm())
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writes()).toEqual([{ method: 'POST', path: revokePath(row), body: { justification: 'synthetic justification', forceRevoke: row.requiresForce } }])
  expect(calls().filter(({ method }) => method === 'GET')).toHaveLength(2)
  expect((await screen.findAllByText(es.revoked.replace('{version}', String(row.currentVersion!.vaultVersion)).replace('{name}', row.name))).length).toBeGreaterThan(0)
})
test('double click and Enter while pending send one POST and keep the dialog inputs', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  setup({ [`POST ${revokePath(tenantRow)}`]: async () => { await held; return Response.json({ revokedVersion: 1 }) } }); open(); await openDialog(); typeName()
  const button = confirm(); fireEvent.click(button); fireEvent.click(button); fireEvent.keyDown(button, { key: 'Enter' })
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(button).toHaveAttribute('aria-busy', 'true'); expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('textbox', { name: es.typedName })).toHaveValue(tenantRow.name)
  fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape', code: 'Escape' }); expect(screen.getByRole('alertdialog')).toBeVisible()
  release(); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
})
test.each([[403, 404, es.noAccess], [404, 403, es.noAccess], [403, 500, es.inventoryError], [500, 404, es.inventoryError], [404, 404, es.notFound], [200, 403, es.noAccess], [200, 404, es.notFound]])('whole-page failure precedence for %i and %i', async (platform, tenant, heading) => {
  setup({ ...(platform === 200 ? {} : { [`GET ${platformGet}`]: failure(platform) }), ...(tenant === 200 ? {} : { [`GET ${tenantGet}`]: failure(tenant) }) }); open()
  expect(await screen.findByRole('heading', { name: heading })).toBeVisible(); expect(screen.queryByRole('table')).toBeNull(); expect(calls()).toHaveLength(2)
})
test.each([500, 'network'])('inventory %s retry sends both GETs once and restores rows', async (status) => {
  let fail = true
  setup({ [`GET ${platformGet}`]: () => { if (!fail) return Response.json(inventoryBody([platformRow])); if (status === 'network') throw new TypeError('synthetic-network'); return failure(500)() } }); open()
  await screen.findByRole('heading', { name: es.inventoryError }); expect(screen.queryByRole('table')).toBeNull()
  fail = false; fireEvent.click(screen.getByRole('button', { name: es.retry })); await ready(); expect(calls().filter(({ method }) => method === 'GET')).toHaveLength(4)
})
test.each([403, 404])('revoke %i stays in the dialog and closes with focus restored', async (status) => {
  setup({ [`POST ${revokePath(tenantRow)}`]: failure(status) }); open(); await openDialog(); typeName(); fireEvent.click(confirm())
  const dialog = screen.getByRole('alertdialog')
  expect(await within(dialog).findByRole('heading', { name: status === 403 ? es.noAccess : es.notFound })).toBeVisible()
  expect(screen.queryByRole('button', { name: /solicitar|request access/i })).toBeNull()
  if (status === 404) expect(within(dialog).getByRole('link', { name: es.viewHistory })).toHaveAttribute('href', '/console/secrets/tenant%2Ftenant-a%2Fdb-password/rotate')
  fireEvent.click(within(dialog).getByRole('button', { name: status === 403 ? es.close : es.backInventory }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); await waitFor(() => expect(revoke()).toHaveFocus()); expect(writes()).toHaveLength(1)
})
test.each([409, 500, 503, 'network'])('revoke %s keeps fields and retries once with the same body', async (status) => {
  let fail = true
  setup({ [`POST ${revokePath(tenantRow)}`]: () => { if (!fail) return Response.json({ revokedVersion: 1 }); if (status === 'network') throw new TypeError('synthetic-network'); return failure(Number(status))() } }); open(); await openDialog(); typeName()
  fireEvent.change(screen.getByRole('textbox', { name: es.justification }), { target: { value: 'synthetic reason' } }); fireEvent.click(confirm())
  await screen.findByRole('heading', { name: es.revokeError }); expect(screen.getByRole('textbox', { name: es.justification })).toHaveValue('synthetic reason')
  expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true'); expect(screen.getByRole('textbox', { name: es.typedName })).toHaveValue(tenantRow.name)
  if (status !== 'network') expect(screen.getByText('req_synthetic_secrets')).toBeVisible()
  fail = false; fireEvent.click(screen.getByRole('button', { name: es.retry })); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writes()).toEqual(Array.from({ length: 2 }, () => ({ method: 'POST', path: revokePath(tenantRow), body: { justification: 'synthetic reason', forceRevoke: true } })))
})
test('rechecks binding against the current stored session immediately before POST', async () => {
  setup(); open(); await openDialog(); typeName()
  login(['superadmin'], ['tenant-b']); fireEvent.click(confirm())
  await screen.findByRole('heading', { name: es.noAccess }); expect(writes()).toEqual([])
})
test('revoke 401 refreshes once, never replays, redirects and stores the return path', async () => {
  const session = readConsoleShellSession()!
  const refreshPath = `/v1/auth/login-sessions/${session.sessionId}/refresh`
  setup({ [`POST ${revokePath(tenantRow)}`]: failure(401), [`POST ${refreshPath}`]: buildConsoleRefreshSessionFixture() })
  render(<MemoryRouter initialEntries={['/console/secrets']}><Routes><Route path="/console/secrets" element={<ProtectedRoute><ConsoleSecretsPage /></ProtectedRoute>} /><Route path="/login" element={<h1>synthetic-login</h1>} /></Routes></MemoryRouter>)
  await openDialog(); typeName(); fireEvent.click(confirm())
  expect(await screen.findByRole('heading', { name: 'synthetic-login' })).toBeVisible()
  expect(writes().map(({ path }) => path)).toEqual([revokePath(tenantRow), refreshPath]); expect(readProtectedRouteIntent()).toBe('/console/secrets')
})
test('API rejects an invalid legacy-shaped path without sending a POST', async () => {
  setup(); await expect(revokeVersion({ ...platformRow, path: 'platform/postgresql/app-password' }, '', false)).rejects.toMatchObject({ status: 403 }); expect(writes()).toEqual([])
})
test('inventory 401 follows the shared refresh and single GET replay policy', async () => {
  let first = true
  const session = readConsoleShellSession()!
  const refreshed = buildConsoleRefreshSessionFixture()
  Object.assign(refreshed.principal!, { tenantIds: [boundTenantId] })
  setup({
    [`GET ${platformGet}`]: () => { if (first) { first = false; return failure(401)() } return Response.json(inventoryBody([platformRow])) },
    [`POST /v1/auth/login-sessions/${session.sessionId}/refresh`]: refreshed,
  }); open(); await ready()
  expect(calls().filter(({ path }) => path === platformGet)).toHaveLength(2)
  expect(calls().filter(({ path }) => path === tenantGet)).toHaveLength(1)
  expect(writes().filter(({ path }) => path.includes('/refresh'))).toHaveLength(1)
  expect(writes().filter(({ path }) => path.endsWith('/revoke'))).toHaveLength(0)
})
test('rotation links keep the legacy root hand-off under the next basename', async () => {
  setup(); renderWithSession(<ConsoleSecretsPage />, { route: '/next/console/secrets', basename: '/next' }); await ready()
  expect(screen.getByRole('link', { name: 'Rotar db-password' })).toHaveAttribute('href', '/console/secrets/tenant%2Ftenant-a%2Fdb-password/rotate')
  expect(screen.getByRole('link', { name: 'Historial de db-password' })).toHaveAttribute('href', '/console/secrets/tenant%2Ftenant-a%2Fdb-password/rotate')
})
