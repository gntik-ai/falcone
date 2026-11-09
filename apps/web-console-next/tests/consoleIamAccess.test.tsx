import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import i18n from '../src/i18n'
import { adaId, firstUsers, groupsPath, listOf, nextUsers, rolesPath, secondPageUser, userPath, users23, users250 } from './parity/pages/console-iam-access-page.manifest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { calls, context, copy, current, defaultRoutes, failure, fill, iamCalls, open, openTab, search, selectUser, setup, table, writes, type Locale } from './consoleIamAccess-support'
import { useConsoleContext } from '../src/shell/context'

vi.mock('../src/shell/context', () => ({ useConsoleContext: vi.fn() }))
beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => current()?.verify())

const twoPages = (second: unknown = listOf(users250.slice(200))) => ({
  [`GET ${firstUsers}`]: { items: users250.slice(0, 200), total: 250, page: { after: 'synthetic-cursor' } },
  [`GET ${nextUsers}`]: second,
})

test.each(['es', 'en'] as const)('23 users arrive in one response and page 1 shows 10 rows in %s', async (locale: Locale) => {
  await i18n.changeLanguage(locale); setup(); open()
  const c = copy[locale], grid = await table(locale)
  expect(within(grid).getAllByRole('row')).toHaveLength(11)
  expect(screen.getByText(fill(c.users.pageStatus, { page: 1, pages: 3 }))).toBeVisible()
  expect(within(grid).getByText('user-002').closest('tr')).toHaveTextContent(c.users.noEmail)
  expect(screen.getByRole('heading', { name: fill(c.users.heading, { count: 23 }) })).toBeVisible()
  expect(screen.getByText(fill(c.users.summary, { from: 1, to: 10, total: 23 }))).toBeVisible()
  expect(calls().map(({ path }) => path).sort()).toEqual([firstUsers, groupsPath, rolesPath].sort())
  for (const { method } of calls()) expect(method).toBe('GET')
})

test('pages through the complete collection and shows the empty detail pane', async () => {
  setup(); open(); await table()
  fireEvent.click(screen.getByRole('button', { name: copy.es.users.next }))
  expect(await screen.findByText(fill(copy.es.users.pageStatus, { page: 2, pages: 3 }))).toBeVisible()
  expect(screen.getByText(fill(copy.es.users.summary, { from: 11, to: 20, total: 23 }))).toBeVisible()
  expect(screen.getByText(copy.es.detail.empty.title)).toBeVisible()
  expect(screen.getByRole('heading', { name: copy.es.detail.headingEmpty })).toBeVisible()
})

test('search filters the complete collection, resets to page 1, and clears with focus back on the search', async () => {
  setup(); open(); await table()
  fireEvent.click(screen.getByRole('button', { name: copy.es.users.next }))
  fireEvent.change(search(), { target: { value: 'ADA@example' } })
  expect(await screen.findByRole('button', { name: 'ada' })).toBeVisible()
  expect(screen.getByText(fill(copy.es.users.pageStatus, { page: 1, pages: 1 }))).toBeVisible()
  fireEvent.change(search(), { target: { value: 'nobody-matches' } })
  expect(await screen.findByText(copy.es.users.noResults.title)).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: copy.es.users.noResults.action }))
  await waitFor(() => expect(search()).toHaveFocus()); expect(search()).toHaveValue('')
})

test('250 users take page[size]=200 and the fixture cursor, and render only once the last page arrives', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  setup(twoPages(undefined)); current().mock.mockClear()
  const routes = { ...defaultRoutes(), ...twoPages(), [`GET ${nextUsers}`]: async () => { await held; return Response.json(listOf(users250.slice(200))) } }
  setup(routes); open()
  await waitFor(() => expect(calls().map(({ path }) => path)).toContain(nextUsers))
  expect(screen.queryByRole('table', { name: copy.es.users.tableLabel })).toBeNull()
  expect(screen.queryByRole('button', { name: copy.es.users.next })).toBeNull()
  expect(screen.queryByText('user-001')).toBeNull()
  await act(async () => { release(); await held })
  await table()
  expect(screen.getByText(fill(copy.es.users.pageStatus, { page: 1, pages: 25 }))).toBeVisible()
  expect(calls().filter(({ path }) => path.startsWith(`/v1/iam/realms/synthetic-tenant/users?`)).map(({ path }) => path)).toEqual([firstUsers, nextUsers])
  fireEvent.change(search(), { target: { value: secondPageUser } })
  expect(await screen.findByRole('button', { name: secondPageUser })).toBeVisible()
})

test.each([['500', failure(500)], ['502', failure(502)]])('a %s on the continuation shows the error panel with no table, footer or partial rows', async (status, response) => {
  setup(twoPages(response)); open()
  expect(await screen.findByRole('heading', { name: copy.es.catalogError.title })).toBeVisible()
  expect(screen.getByText('synthetic-iam-request')).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull(); expect(screen.queryByText('user-001')).toBeNull(); expect(screen.queryByRole('navigation')).toBeNull()
  expect(screen.queryByText(/Página 1 de/)).toBeNull(); expect(status).toBeTruthy()
})

test('a network failure on the continuation shows the error panel, and Reintentar restarts without page[after]', async () => {
  let attempt = 0
  setup({ ...twoPages(), [`GET ${nextUsers}`]: () => { attempt += 1; if (attempt === 1) throw new TypeError('Failed to fetch'); return Response.json(listOf(users250.slice(200))) } }); open()
  expect(await screen.findByRole('button', { name: copy.es.catalogError.retry })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull(); expect(screen.queryByText(/Página 1 de/)).toBeNull()
  const before = calls().length
  fireEvent.click(screen.getByRole('button', { name: copy.es.catalogError.retry }))
  await table()
  const second = calls().slice(before).filter(({ path }) => path.startsWith('/v1/iam/realms/synthetic-tenant/users?')).map(({ path }) => path)
  expect(second).toEqual([firstUsers, nextUsers])
  expect(screen.getByText(fill(copy.es.users.pageStatus, { page: 1, pages: 25 }))).toBeVisible()
})

test.each([[500, copy.es.errors.status['5xx']], [404, copy.es.errors.status['404']]])('a %s on the catalogue shows its error panel with retry', async (status, message) => {
  setup({ [`GET ${firstUsers}`]: failure(status) }); open()
  expect(await screen.findByRole('heading', { name: copy.es.catalogError.title })).toBeVisible()
  expect(screen.getByText(message)).toBeVisible()
  if (status === 500) expect(screen.getByText('synthetic-iam-request')).toBeVisible(); else expect(screen.queryByText('synthetic-iam-request')).toBeNull()
  expect(screen.queryByText('synthetic-backend-message')).toBeNull()
  expect(screen.getByRole('button', { name: copy.es.catalogError.retry })).toBeVisible()
})

test('a 401 refreshes the session once and shows the session-expired panel when it persists', async () => {
  let refreshes = 0
  setup({ [`GET ${firstUsers}`]: failure(401), 'POST /v1/auth/login-sessions/synthetic-session/refresh': () => { refreshes += 1; return Response.json(buildConsoleRefreshSessionFixture()) } }); open()
  expect(await screen.findByText(copy.es.errors.status['401'])).toBeVisible()
  expect(refreshes).toBe(1)
  expect(calls().filter(({ path }) => path === firstUsers)).toHaveLength(2)
})

test('an API 403 shows the no-access state instead of the inventory', async () => {
  setup({ [`GET ${firstUsers}`]: failure(403) }); open()
  expect(await screen.findByText(copy.es.noAccess.title)).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
})

test('a network error on the first response shows the error panel with retry', async () => {
  setup({ [`GET ${firstUsers}`]: () => { throw new TypeError('Failed to fetch') } }); open()
  expect(await screen.findByRole('button', { name: copy.es.catalogError.retry })).toBeVisible()
  expect(screen.getByText(copy.es.errors.fallback.catalog)).toBeVisible()
})

test('shows the loading skeleton before the first response', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  setup({ [`GET ${firstUsers}`]: async () => { await held; return Response.json(listOf(users23)) } }); open()
  expect(await screen.findByRole('status', { name: copy.es.loading.title })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
  await act(async () => { release(); await held })
  await table()
})

test('an empty realm shows the first-run state whose action focuses the username field', async () => {
  setup({ [`GET ${firstUsers}`]: listOf([]) }); open()
  expect(await screen.findByText(copy.es.users.empty.title)).toBeVisible()
  fireEvent.click(screen.getAllByRole('button', { name: copy.es.users.empty.action }).find((button) => !button.closest('form'))!)
  await waitFor(() => expect(within(screen.getByTestId('iam-create-user-form')).getByRole('textbox', { name: new RegExp(`^${copy.es.forms.user.username}`) })).toHaveFocus())
})

test('without an active tenant the page shows its empty state and sends no request', async () => {
  setup(); vi.mocked(useConsoleContext).mockReturnValue(context({ activeTenantId: null }) as never); open()
  expect(await screen.findByRole('heading', { name: copy.es.title })).toBeVisible()
  expect(screen.getByText(copy.es.noTenant.title)).toBeVisible()
  expect(calls()).toEqual([])
})

test.each(['es', 'en'] as const)('a selected user shows the summary, an explicitly empty history, roles and groups in %s', async (locale: Locale) => {
  await i18n.changeLanguage(locale); setup(); open(); const c = copy[locale]
  await selectUser('ada', locale)
  const detail = screen.getByRole('heading', { name: fill(c.detail.heading, { name: 'ada' }) }).closest('section')!
  expect(within(detail).getByText('ada@example.test')).toBeVisible(); expect(within(detail).getByText(adaId)).toBeVisible()
  expect(within(detail).getByText(c.detail.summary.historyEmpty)).toBeVisible()
  expect(within(detail).queryByText(/Deployment|Running|ago/)).toBeNull()
  await openTab('roles', locale)
  expect(await screen.findByText('default-roles-synthetic-tenant')).toBeVisible(); expect(screen.getByText('viewer')).toBeVisible()
  expect(screen.queryByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'default-roles-synthetic-tenant' }) })).toBeNull()
  expect(screen.getByRole('button', { name: fill(c.detail.roles.removeNamed, { name: 'viewer' }) })).toBeVisible()
  await openTab('groups', locale)
  expect(screen.getByRole('button', { name: fill(c.detail.groups.removeNamed, { name: 'support' }) })).toBeVisible()
  expect(iamCalls().map(({ path }) => path)).toContain(`${userPath(adaId)}/roles`)
  expect(iamCalls().map(({ path }) => path)).not.toContain(userPath(adaId))
})

test('the detail tabs follow arrow-key navigation', async () => {
  setup(); open(); await selectUser()
  const summary = screen.getByRole('tab', { name: copy.es.detail.tab.summary })
  summary.focus(); fireEvent.keyDown(summary, { key: 'ArrowRight' })
  await waitFor(() => expect(screen.getByRole('tab', { name: copy.es.detail.tab.roles })).toHaveFocus())
})

test('default-roles-* is excluded from the assign select and the initial-role select', async () => {
  setup(); open(); await selectUser(); await openTab('roles')
  fireEvent.click(screen.getByRole('combobox', { name: copy.es.detail.roles.assign }))
  expect(await screen.findByRole('option', { name: 'editor' })).toBeVisible()
  expect(screen.getByRole('option', { name: 'tenant_admin' })).toBeVisible()
  expect(screen.queryByRole('option', { name: 'default-roles-synthetic-tenant' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'viewer' })).toBeNull()
  expect(writes()).toEqual([])
})

test('a detail 404 shows the removed-user state with a way back to the list', async () => {
  setup({ [`GET ${userPath(adaId)}/roles`]: failure(404), [`GET ${userPath(adaId)}/groups`]: failure(404) }); open()
  await table(); fireEvent.click(screen.getByRole('button', { name: 'ada' }))
  expect(await screen.findByText(copy.es.detail.notFound.title)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: copy.es.detail.notFound.action }))
  expect(await screen.findByText(copy.es.detail.empty.title)).toBeVisible()
  await waitFor(() => expect(search()).toHaveFocus())
})

test('a detail failure shows its retry and recovers', async () => {
  let attempt = 0
  setup({ [`GET ${userPath(adaId)}/roles`]: () => { attempt += 1; return attempt === 1 ? failure(500)() : Response.json(listOf([])) }, [`GET ${userPath(adaId)}/groups`]: listOf([]) }); open()
  await table(); fireEvent.click(screen.getByRole('button', { name: 'ada' }))
  expect(await screen.findByText(copy.es.detail.error.title)).toBeVisible()
  expect(screen.getByText('synthetic-iam-request')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: copy.es.detail.error.retry }))
  expect(await screen.findByRole('tab', { name: copy.es.detail.tab.summary })).toBeVisible()
})

test('Recargar restarts from the first users page and keeps the selection', async () => {
  setup(); open(); await selectUser()
  const before = calls().length
  fireEvent.click(screen.getByRole('button', { name: copy.es.users.reload }))
  await waitFor(() => expect(calls().length).toBe(before + 3))
  expect(calls().slice(before).map(({ path }) => path).sort()).toEqual([firstUsers, groupsPath, rolesPath].sort())
  expect(screen.getByRole('heading', { name: fill(copy.es.detail.heading, { name: 'ada' }) })).toBeVisible()
  await waitFor(() => expect(search()).toHaveFocus())
})
