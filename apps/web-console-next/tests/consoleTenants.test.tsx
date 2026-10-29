import { StrictMode } from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import ConsoleTenantsPage from '../src/pages/consoleTenants'
import { ConsoleContextProvider } from '../src/shell/context'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-tenants-page.json'
import en from '../src/locales/en/pages.console-tenants-page.json'
import { login, renderWithSession, strictFetch, tenantUrl, workspaceUrl } from './shell-support'

const plans = '/v1/plans?status=active&page=1&pageSize=100'
const quotas = '/v1/metrics/tenants/platform/quotas'
const overview = '/v1/metrics/tenants/platform/overview'
const create = '/v1/tenants'
const refresh = '/v1/auth/login-sessions/synthetic-session/refresh'
const tenants = [{ tenantId: 't1', displayName: 'Alpha', slug: 'alpha', state: 'active' }, { tenantId: 't2', displayName: 'Beta', slug: 'beta', state: 'suspended' }, { tenantId: 't3', displayName: 'Gamma', slug: 'gamma' }]
const planList = { items: [{ id: 'p1', slug: 'starter', displayName: 'Starter' }] }
const body = { name: '  Organization  ', planId: 'p1', region: 'eu-west', preferences: { locale: 'es' } }
let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
const calls = (path: string) => requests.mock.mock.calls.filter(([url]) => url === path)
const modal = () => screen.getByRole('dialog', { name: i18n.t('create', { ns: 'pages.console-tenants-page' }) })
const button = (label: string) => screen.getByRole('button', { name: label })
const errorResponse = (status: number) => Response.json({ message: 'PRIVATE_MARKER', requestId: 'req_synthetic' }, { status })
function mock(extra: Parameters<typeof strictFetch>[0] = {}) {
  requests = strictFetch({ [`GET ${tenantUrl}`]: { items: tenants, page: { after: null } }, [`GET ${plans}`]: planList,
    [`GET ${quotas}`]: {}, [`GET ${overview}`]: {}, [`POST ${create}`]: { tenantId: 'created' },
    ...Object.fromEntries(tenants.map((tenant) => [`GET ${workspaceUrl(tenant.tenantId)}`, { items: [] }])), ...extra })
}
async function open(role = 'superadmin', locale: 'es' | 'en' = 'es') {
  await i18n.changeLanguage(locale); login([role])
  return renderWithSession(<StrictMode><ConsoleContextProvider><ConsoleTenantsPage /></ConsoleContextProvider></StrictMode>, { route: '/console/tenants' })
}
async function select(label: string, option: string) {
  const trigger = screen.getByRole('combobox', { name: label })
  fireEvent.click(trigger)
  const item = await screen.findByRole('option', { name: option })
  fireEvent.pointerDown(item); fireEvent.click(item)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}
async function wizard(copy = es) {
  fireEvent.click(button(copy.create))
  await screen.findByLabelText(copy.name, { exact: true })
}
async function summary(copy = es) {
  await wizard(copy)
  fireEvent.change(screen.getByLabelText(copy.name, { exact: true }), { target: { value: body.name } })
  fireEvent.click(button(copy.next))
  await waitFor(() => expect(screen.getByRole('combobox', { name: copy.planId })).toBeEnabled())
  await select(copy.planId, 'Starter (starter)')
  fireEvent.click(button(copy.next))
  await select(copy.region, copy.euWest)
  fireEvent.click(button(copy.next))
  await screen.findByRole('heading', { name: copy.summary })
}

test.each(['es', 'en'] as const)('inventory and truncation use shell data with semantic rows and no page list request in %s', async (locale) => {
  const copy = locale === 'es' ? es : en
  mock({ [`GET ${tenantUrl}`]: { items: tenants, page: { after: 'next' } } })
  await open('superadmin', locale)
  await screen.findByRole('table')
  expect(await screen.findByRole('region', { name: copy.notifications })).toBeInTheDocument()
  expect(screen.getByText(`3+ ${locale === 'es' ? 'organizaciones' : 'organizations'}`)).toBeVisible()
  expect(screen.getByText(copy.truncatedNote.replace('{count}', '3'))).toBeVisible()
  expect(screen.getAllByRole('rowheader')).toHaveLength(3)
  expect(screen.getByText(copy.status.suspended)).toBeVisible()
  expect(screen.getByRole('link', { name: copy.openPlanName.replace('{name}', 'Alpha') })).toHaveAttribute('href', '/console/tenants/t1/plan')
  expect(calls(tenantUrl)).toHaveLength(1); expect(calls(plans)).toHaveLength(0)
  expect(calls(quotas)).toHaveLength(1); expect(calls(overview)).toHaveLength(1)
})
test.each([
  [7994, 10000, 2006, 'operational'],
  [7995, 10000, 2005, 'attention'],
  [7996, 10000, 2004, 'attention'],
  [7999, 10000, 2001, 'attention'],
  [8000, 10000, 2000, 'attention'],
  [10000, 10000, 0, 'blocked'],
  [1, 0, 1, 'attention'],
  [1, -1, 1, 'attention'],
  [0, 0, 1, 'operational'],
  [0, -1, 1, 'operational'],
  [1, 0, 0, 'blocked'],
] as const)('quota status with used %i, limit %i and remaining %i follows legacy utilization as %s', async (used, limit, remaining, status) => {
  mock({ [`GET ${tenantUrl}`]: { items: [{ ...tenants[0], quotaProfile: { limits: [{ metricKey: 'storage', scope: 'tenant', used, limit, remaining }] } }], page: { after: null } } })
  await open()
  const table = await screen.findByRole('table')
  expect(within(table).getByText(es.status[status], { exact: true })).toBeVisible()
})
test('operator activates rows, disables the active action and announces the new context', async () => {
  let resolve!: (response: Response) => void
  mock({ [`GET ${workspaceUrl('t2')}`]: () => new Promise<Response>((done) => { resolve = done }) })
  await open('platform_operator')
  const table = await screen.findByRole('table')
  const action = screen.getByRole('button', { name: es.useActiveName.replace('{name}', 'Beta') })
  action.focus(); fireEvent.click(action)
  await waitFor(() => expect(calls(workspaceUrl('t2'))).toHaveLength(1))
  await waitFor(() => expect(screen.getByRole('button', { name: es.alreadyActive.replace('{name}', 'Beta') })).toBeDisabled())
  await waitFor(() => expect(screen.getByRole('row', { current: true })).toHaveTextContent('Beta'))
  expect(screen.getByRole('table')).toBe(table)
  expect(screen.getByText('3 organizaciones')).toBeVisible()
  expect(screen.queryByRole('status', { name: es.loading })).not.toBeInTheDocument()
  expect(action).toHaveFocus()
  expect(screen.getAllByText(es.activated.replace('{name}', 'Beta')).length).toBeGreaterThan(0)
  expect(screen.queryByRole('link', { name: es.openPlan })).not.toBeInTheDocument()
  await act(async () => resolve(Response.json({ items: [] })))
  expect(screen.getByRole('table')).toBe(table)
  expect(action).toHaveFocus()
})
test('the skeleton ends at the tenant result even while the first workspace request is pending', async () => {
  let resolveTenants!: (response: Response) => void
  let resolveWorkspaces!: (response: Response) => void
  mock({
    [`GET ${tenantUrl}`]: () => new Promise<Response>((done) => { resolveTenants = done }),
    [`GET ${workspaceUrl('t1')}`]: () => new Promise<Response>((done) => { resolveWorkspaces = done }),
  })
  await open()
  expect(screen.getByRole('status', { name: es.loading })).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  await act(async () => resolveTenants(Response.json({ items: [tenants[0]], page: { after: null } })))
  await waitFor(() => expect(calls(workspaceUrl('t1'))).toHaveLength(1))
  const table = screen.getByRole('table')
  expect(screen.getByText('1 organización')).toBeVisible()
  expect(screen.queryByRole('status', { name: es.loading })).not.toBeInTheDocument()
  await act(async () => resolveWorkspaces(Response.json({ items: [] })))
  expect(screen.getByRole('table')).toBe(table)
})
test('successful create keeps the inventory mounted through the tenant reload and workspace resolution', async () => {
  let resolveTenants!: (response: Response) => void
  let resolveWorkspaces!: (response: Response) => void
  let lists = 0
  mock({
    [`GET ${tenantUrl}`]: () => ++lists === 1 ? Response.json({ items: tenants, page: { after: null } }) : new Promise<Response>((done) => { resolveTenants = done }),
    [`GET ${workspaceUrl('t1')}`]: () => new Promise<Response>((done) => { resolveWorkspaces = done }),
  })
  await open()
  const table = await screen.findByRole('table')
  await summary(); fireEvent.click(button(es.createTenant))
  await screen.findByRole('link', { name: es.openCreated })
  await waitFor(() => expect(calls(tenantUrl)).toHaveLength(2))
  expect(table).toBeInTheDocument()
  fireEvent.click(button(es.exit))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: es.create })).not.toBeInTheDocument())
  await waitFor(() => expect(button(es.create)).toHaveFocus())
  expect(screen.getByRole('table')).toBe(table)
  expect(screen.getByText('3 organizaciones')).toBeVisible()
  await act(async () => resolveTenants(Response.json({ items: [tenants[0]], page: { after: null } })))
  await waitFor(() => expect(calls(workspaceUrl('t1'))).toHaveLength(1))
  expect(screen.getByRole('table')).toBe(table)
  expect(screen.getByText('1 organización')).toBeVisible()
  expect(screen.queryByRole('status', { name: es.loading })).not.toBeInTheDocument()
  expect(button(es.create)).toHaveFocus()
  await act(async () => resolveWorkspaces(Response.json({ items: [] })))
  expect(screen.getByRole('table')).toBe(table)
  expect(button(es.create)).toHaveFocus()
})
test('restricted roles still run the precheck and can open the blocked wizard without fetching plans', async () => {
  mock(); await open('tenant_owner')
  await screen.findByRole('heading', { name: es.restricted })
  expect(screen.getByRole('link', { name: es.myPlan })).toHaveAttribute('href', '/console/my-plan')
  fireEvent.click(button(es.create))
  await screen.findByRole('heading', { name: es.blocked })
  expect(calls(plans)).toHaveLength(0); expect(calls(quotas)).toHaveLength(1); expect(calls(overview)).toHaveLength(1)
})
test.each([403, 404, 500, 0])('inventory %s is distinct from empty, carries request id and retries through context', async (status) => {
  let count = 0
  mock({ [`GET ${tenantUrl}`]: () => { if (++count > 1) return Response.json({ items: [], page: { after: null } }); if (!status) throw new TypeError('network'); return errorResponse(status) } })
  await open()
  await screen.findByRole('heading', { name: status === 403 ? es.inventory.noAccess : status === 404 ? es.inventory.notFound : es.inventory.error })
  expect(screen.queryByRole('heading', { name: es.empty })).not.toBeInTheDocument()
  if (status === 500) expect(screen.getByText('req_synthetic')).toBeVisible()
  if (status === 404) {
    expect(screen.getByRole('link', { name: es.overview })).toHaveAttribute('href', '/console/overview')
    await waitFor(() => expect(screen.getByRole('heading', { name: es.inventory.notFound })).toHaveFocus())
  }
  fireEvent.click(button(es.retry)); await screen.findByRole('heading', { name: es.empty })
  expect(calls(tenantUrl)).toHaveLength(2)
})
test.each([403, 404, 500, 0, -1])('catalog %s blocks only the plan step, and retry recovers without exposing private error copy', async (status) => {
  let count = 0
  mock({ [`GET ${plans}`]: () => { if (++count > 1) return Response.json(planList); if (status === -1) return Response.json({ items: [] }); if (!status) throw new TypeError('network'); return errorResponse(status) } })
  await open(); await wizard()
  fireEvent.change(screen.getByLabelText(es.name), { target: { value: 'Organization' } }); fireEvent.click(button(es.next))
  await waitFor(() => expect(screen.getByRole('combobox', { name: es.planId })).toBeDisabled())
  expect(button(es.next)).toBeDisabled()
  if (status === -1) expect(await screen.findByText(es.plansEmpty)).toBeVisible()
  else {
    const heading = await screen.findByRole('heading', { name: status === 403 ? es.catalog.noAccess : status === 404 ? es.catalog.notFound : es.catalog.error })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.queryByText(es.plansEmpty)).not.toBeInTheDocument()
    expect(screen.queryByText('PRIVATE_MARKER')).not.toBeInTheDocument()
    fireEvent.click(button(es.retry))
    await waitFor(() => expect(button(es.next)).toBeEnabled())
  }
})
test.each([403, 404, 500, 0])('quota %s failure is nonblocking and only explicit quota retry reissues both metrics', async (status) => {
  let count = 0
  mock({ [`GET ${overview}`]: () => { if (++count > 1) return Response.json({}); if (!status) throw new TypeError('network'); return errorResponse(status) } })
  await open(); await wizard()
  fireEvent.change(screen.getByLabelText(es.name), { target: { value: 'Organization' } }); fireEvent.click(button(es.next))
  await screen.findByRole('heading', { name: status === 403 ? es.precheck.noAccess : status === 404 ? es.precheck.notFound : es.precheck.error })
  await waitFor(() => expect(button(es.next)).toBeEnabled())
  expect(calls(quotas)).toHaveLength(1); expect(calls(overview)).toHaveLength(1)
  fireEvent.click(button(es.retryPrecheck))
  await waitFor(() => expect(calls(quotas)).toHaveLength(2))
  expect(calls(overview)).toHaveLength(2); expect(calls(create)).toHaveLength(0)
})
test.each([quotas, overview])('a pending %s does not announce a failure or disable Next; reopening only reloads plans', async (path) => {
  let resolve!: (response: Response) => void
  mock({ [`GET ${path}`]: () => new Promise<Response>((done) => { resolve = done }) })
  await open(); await wizard()
  fireEvent.change(screen.getByLabelText(es.name), { target: { value: 'Organization' } }); fireEvent.click(button(es.next))
  await waitFor(() => expect(button(es.next)).toBeEnabled())
  expect(screen.queryByText(es.precheck.error)).not.toBeInTheDocument()
  fireEvent.click(button(es.exit)); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await wizard()
  expect(calls(quotas)).toHaveLength(1); expect(calls(overview)).toHaveLength(1)
  await waitFor(() => expect(calls(plans)).toHaveLength(2))
  await act(async () => resolve(Response.json({})))
})
test.each(['es', 'en'] as const)('create retry retains body and idempotency key, prevents duplicate clicks and reloads the shell in %s', async (locale) => {
  const copy = locale === 'es' ? es : en
  let resolve!: (response: Response) => void
  let count = 0
  mock({ [`POST ${create}`]: () => ++count === 1 ? errorResponse(500) : new Promise<Response>((done) => { resolve = done }) })
  await open('superadmin', locale); await summary(copy)
  fireEvent.click(button(copy.createTenant))
  const heading = await within(modal()).findByRole('heading', { name: copy.submit.error })
  await waitFor(() => expect(heading).toHaveFocus())
  expect(within(modal()).getByText(body.name.trim())).toBeVisible()
  fireEvent.click(button(copy.retry)); fireEvent.click(button(copy.creating))
  expect(button(copy.creating)).toHaveAttribute('aria-disabled', 'true'); expect(button(copy.back)).toBeDisabled(); expect(button(copy.creating)).toHaveAttribute('aria-busy', 'true')
  await waitFor(() => expect(calls(create)).toHaveLength(2))
  const sent = calls(create)
  expect(sent.map(([, init]) => JSON.parse(init!.body as string))).toEqual([body, body])
  expect(new Headers(sent[0][1]!.headers).get('Idempotency-Key')).toBe(new Headers(sent[1][1]!.headers).get('Idempotency-Key'))
  expect(new Headers(sent[0][1]!.headers).get('X-Request-Id')).toMatch(/^wiz_/)
  await act(async () => resolve(Response.json({ tenantId: 'created' })))
  await screen.findByRole('link', { name: copy.openCreated })
  expect(within(modal()).getByText(copy.success.replace('{id}', 'created'))).toBeVisible()
  expect(screen.getByRole('link', { name: copy.openCreated })).toHaveAttribute('href', '/console/tenants/created/plan')
  await waitFor(() => expect(calls(tenantUrl)).toHaveLength(2))
})
test('Back and an edit use a new key; create 404 also reloads the catalog without sending another write', async () => {
  mock({ [`POST ${create}`]: () => errorResponse(404) })
  await open(); await summary(); fireEvent.click(button(es.createTenant))
  await screen.findByRole('heading', { name: es.submit.notFound })
  expect(screen.queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
  const key = new Headers(calls(create)[0][1]!.headers).get('Idempotency-Key')
  fireEvent.click(button(es.back)); await waitFor(() => expect(calls(plans)).toHaveLength(2))
  await select(es.region, es.usEast); fireEvent.click(button(es.next)); fireEvent.click(button(es.createTenant))
  await waitFor(() => expect(calls(create)).toHaveLength(2))
  expect(new Headers(calls(create)[1][1]!.headers).get('Idempotency-Key')).not.toBe(key)
})
test.each([403, 409, 422, 0])('submit %s preserves fields and offers only the applicable recovery', async (status) => {
  mock({ [`POST ${create}`]: () => { if (!status) throw new TypeError('network'); return errorResponse(status) } })
  await open(); await summary(); fireEvent.click(button(es.createTenant))
  const heading = await within(modal()).findByRole('heading', { name: status === 403 ? es.submit.noAccess : es.submit.error })
  await waitFor(() => expect(heading).toHaveFocus())
  expect(within(modal()).getByText(body.name.trim())).toBeVisible()
  if (status === 403) { expect(screen.queryByRole('button', { name: es.retry })).not.toBeInTheDocument(); expect(button(es.closeWizard)).toBeEnabled() }
  else expect(button(es.retry)).toBeEnabled()
  if (status === 409) expect(screen.getByText(es.conflict)).toBeVisible()
  if (status === 422) expect(screen.getByText(es.invalidData)).toBeVisible()
  expect(calls(create)).toHaveLength(1)
})
test('successful 401 refresh never replays a create and retains the key until explicit Create', async () => {
  let count = 0
  mock({ [`POST ${create}`]: () => ++count === 1 ? errorResponse(401) : Response.json({ tenantId: 'created' }), [`POST ${refresh}`]: buildConsoleRefreshSessionFixture() })
  await open(); await summary(); fireEvent.click(button(es.createTenant))
  await screen.findByText(es.sessionRenewed)
  expect(calls(create)).toHaveLength(1); expect(calls(refresh)).toHaveLength(1)
  fireEvent.click(button(es.createTenant)); await screen.findByRole('link', { name: es.openCreated })
  expect(calls(create)).toHaveLength(2)
  expect(new Headers(calls(create)[0][1]!.headers).get('Idempotency-Key')).toBe(new Headers(calls(create)[1][1]!.headers).get('Idempotency-Key'))
})
test('name and region validation are linked to their controls and closing returns focus to the trigger', async () => {
  mock(); await open(); await wizard(); fireEvent.click(button(es.next))
  expect(screen.getByText(es.requiredName)).toBeVisible(); expect(screen.getByLabelText(es.name)).toHaveAttribute('aria-describedby', 'tenant-name-error')
  fireEvent.change(screen.getByLabelText(es.name), { target: { value: 'Organization' } }); fireEvent.click(button(es.next))
  await select(es.planId, 'Starter (starter)'); fireEvent.click(button(es.next)); fireEvent.click(button(es.next))
  expect(screen.getByText(es.requiredRegion)).toBeVisible()
  fireEvent.click(button(es.exit))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(button(es.create)).toHaveFocus())
  expect(calls(create)).toHaveLength(0)
})

test.each([plans, quotas, overview])('a 401 read from %s refreshes once and retries only that read', async (path) => {
  let count = 0
  mock({ [`GET ${path}`]: () => ++count === 1 ? errorResponse(401) : Response.json(path === plans ? planList : {}), [`POST ${refresh}`]: buildConsoleRefreshSessionFixture() })
  await open(); await wizard()
  fireEvent.change(screen.getByLabelText(es.name), { target: { value: 'Organization' } }); fireEvent.click(button(es.next))
  await waitFor(() => expect(calls(path)).toHaveLength(2))
  expect(calls(refresh)).toHaveLength(1); expect(calls(create)).toHaveLength(0)
  await waitFor(() => expect(button(es.next)).toBeEnabled())
})
test('the first create request is busy, prevents double submit and keeps every summary field', async () => {
  let resolve!: (response: Response) => void
  mock({ [`POST ${create}`]: () => new Promise<Response>((done) => { resolve = done }) })
  await open(); await summary(); fireEvent.click(button(es.createTenant)); fireEvent.click(button(es.creating))
  expect(button(es.creating)).toHaveAttribute('aria-disabled', 'true'); expect(button(es.back)).toBeDisabled()
  const dialog = within(modal())
  for (const value of [body.name.trim(), 'Starter', body.region, body.preferences.locale]) expect(dialog.getByText(value)).toBeVisible()
  await waitFor(() => expect(calls(create)).toHaveLength(1))
  await act(async () => resolve(Response.json({ tenantId: 'created' })))
  await screen.findByRole('link', { name: es.openCreated })
})


test('the active catalog accepts the legacy plans response envelope', async () => {
  mock({ [`GET ${plans}`]: { plans: planList.items } })
  await open(); await summary()
  expect(within(modal()).getByText('Starter')).toBeVisible()
  expect(calls(create)).toHaveLength(0)
})


test.each(['tenant_owner', 'tenant_developer', 'tenant_viewer', 'unrecognized'])('the blocked wizard preserves the shared permission explanation for %s', async (role) => {
  mock(); await open(role); fireEvent.click(button(es.create))
  await screen.findByRole('heading', { name: es.blocked })
  expect(screen.getByText(getConsolePermissions([role]).denyReason('tenant.create')!)).toBeVisible()
})
