import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import ConsoleQuotasPage from '../src/pages/consoleQuotas'
import { normalize, formatValue } from '../src/pages/consoleQuotas/posture'
import { login, renderWithSession, strictFetch } from './shell-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-quotas-page.json'
import en from '../src/locales/en/pages.console-quotas-page.json'
import { overviewTenant, overviewWorkspace, quotaEndpoints, quotasTenant, quotasWorkspace, tenantPlanReady } from './parity/pages/console-quotas-page.manifest'
import { createEndpointRegistry } from './parity/endpoint-registry'
import { endpoints, responseFor } from './parity/fixtures/shell'

const context = vi.hoisted(() => ({ activeTenantId: 'synthetic-tenant' as string | null, activeWorkspaceId: 'synthetic-workspace' as string | null,
  loading: false, tenants: [{ tenantId: 'synthetic-tenant', displayName: 'Synthetic Organization' }] }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context }))
let requests: ReturnType<typeof strictFetch>
const tenant = '/v1/metrics/tenants/synthetic-tenant'
const workspace = '/v1/metrics/workspaces/synthetic-workspace'
const plan = '/v1/tenants/synthetic-tenant/plan'
const put = '/v1/plans/synthetic-plan/limits/max_workspaces'
const calls = (method: string) => requests.mock.mock.calls.filter(([, init]) => init?.method === method)
const puts = () => calls('PUT')
beforeEach(() => { context.activeTenantId = 'synthetic-tenant'; context.activeWorkspaceId = 'synthetic-workspace'; context.loading = false })
afterEach(() => requests?.verify())
function setup(extra: Parameters<typeof strictFetch>[0] = {}) {
  requests = strictFetch({ [`GET ${tenant}/quotas`]: quotasTenant, [`GET ${tenant}/overview`]: overviewTenant,
    [`GET ${workspace}/quotas`]: quotasWorkspace, [`GET ${workspace}/overview`]: overviewWorkspace,
    [`GET ${plan}`]: tenantPlanReady, [`PUT ${put}`]: { newValue: 500 }, ...extra })
}
function open(role = 'superadmin') { login([role]); return renderWithSession(<ConsoleQuotasPage />) }
const ready = () => screen.findAllByRole('table')
async function adjust() {
  await ready()
  const trigger = screen.getAllByRole('button', { name: 'Ajustar cuota de Maximum Workspaces' })[0]
  trigger.focus(); fireEvent.click(trigger)
  const input = await screen.findByRole('spinbutton')
  await waitFor(() => expect(input).toHaveFocus())
  return { trigger, input }
}
async function review(value = '500') {
  const result = await adjust()
  fireEvent.change(result.input, { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: es.save }))
  return result
}
async function confirm() { fireEvent.click(screen.getByRole('button', { name: es.confirm })) }
function response(status: number, code = `HTTP_${status}`) { return Response.json({ code, message: 'synthetic-error', requestId: 'req_synthetic_quotas' }, { status }) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }

test('the parity registry serves every request from loading through a confirmed save and reload', async () => {
  const registry = createEndpointRegistry(endpoints, (name, variant, role) => responseFor(name, variant as Parameters<typeof responseFor>[1], role), quotaEndpoints)
  const pageRequests = [
    ['GET', `${tenant}/quotas`], ['GET', `${tenant}/overview`],
    ['GET', `${workspace}/quotas`], ['GET', `${workspace}/overview`],
    ['GET', plan], ['PUT', put],
  ]
  setup(Object.fromEntries(pageRequests.map(([method, path]) => [`${method} ${path}`, () => {
    const name = registry.find(method, path)
    expect(name, `${method} ${path} must match a parity fixture`).toBeDefined()
    const fixture = registry.responseFor(name!, 'superadmin', method === 'PUT' ? { value: 500 } : undefined)
    return Response.json(fixture.body, { status: fixture.status })
  }])))
  open(); await review(); expect(puts()).toHaveLength(0); await confirm()
  fireEvent.click(await screen.findByRole('button', { name: es.close }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Ajustar cuota:/ })).not.toBeInTheDocument())
  await ready()
  expect(puts()).toHaveLength(1)
  expect(calls('GET').map(([path]) => path)).toEqual([
    `${tenant}/quotas`, `${tenant}/overview`, `${workspace}/quotas`, `${workspace}/overview`, plan,
    `${tenant}/quotas`, `${tenant}/overview`, `${workspace}/quotas`, `${workspace}/overview`,
  ])
})

test.each(['es', 'en'] as const)('renders both semantic tables, localized timestamp, levels and copy in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open(); await ready()
  const copy = locale === 'es' ? es : en
  expect(screen.getByRole('heading', { name: copy.title, level: 1 })).toBeVisible()
  expect(screen.getAllByRole('table')).toHaveLength(2)
  expect(screen.getAllByRole('rowheader')).toHaveLength(9)
  expect(screen.getAllByText(copy.unlimited).length).toBeGreaterThan(0)
  expect(screen.getByText(copy.exceeded, { exact: true })).toBeVisible()
  expect(screen.getByRole('region', { name: copy.notifications })).toBeInTheDocument()
  expect(screen.getAllByText('2.0 KB')).toHaveLength(2)
  expect(screen.getAllByRole('meter').map((node) => node.getAttribute('aria-valuetext'))).toContain('110%')
  expect(document.querySelector('time')).toHaveTextContent(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(quotasTenant.evaluatedAt!)))
  expect(document.documentElement.lang).toBe(locale)
  expect(document.body).not.toHaveTextContent('pages.console-quotas-page.')
  expect(calls('GET').map(([path]) => path)).toEqual([`${tenant}/quotas`, `${tenant}/overview`, `${workspace}/quotas`, `${workspace}/overview`])
  expect(calls('GET').every(([, init]) => init?.body === undefined)).toBe(true)
  expect(screen.queryByRole('link', { name: /ver cuotas/i })).not.toBeInTheDocument()
})
test('filters one scope without requests or changing the full count and clears with focus', async () => {
  setup(); open(); await ready(); const before = requests.mock.mock.calls.length
  const search = screen.getAllByRole('searchbox')[0]
  fireEvent.change(search, { target: { value: 'API' } })
  expect(within(screen.getAllByRole('table')[0]).getAllByRole('rowheader')).toHaveLength(1)
  expect(screen.getByText('6 dimensiones')).toBeVisible()
  fireEvent.change(search, { target: { value: 'no-match' } })
  fireEvent.click(screen.getByRole('button', { name: es.clear }))
  expect(search).toHaveFocus(); expect(search).toHaveValue('')
  expect(requests.mock.mock.calls).toHaveLength(before)
})
test.each(['es', 'en'] as const)('preserves live and documented posture values with the legacy fallback in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  let overallPosture = 'critical'
  setup({ [`GET ${tenant}/overview`]: () => Response.json({ ...overviewTenant, overallPosture }) })
  const view = open(); await ready()
  for (const posture of ['critical', 'healthy', 'hard_limit_reached', 'soft_limit_exceeded', 'evidence_degraded', 'evidence_unavailable', 'unbounded', 'future_posture_value', 'within_limit', 'unknown']) {
    overallPosture = posture
    // A scope change reloads the overview without remounting the page.
    context.activeWorkspaceId = context.activeWorkspaceId ? null : 'synthetic-workspace'
    view.rerender(<MemoryRouter><ConsoleQuotasPage /></MemoryRouter>)
    await ready()
    await waitFor(() => expect(screen.getByText(Object.hasOwn(copy.posture, posture) ? copy.posture[posture as keyof typeof copy.posture] : posture.replace(/_/g, ' '), { exact: true })).toBeVisible())
    expect(document.body).not.toHaveTextContent('pages.console-quotas-page.')
  }
})
test.each(['es', 'en'] as const)('an empty workspace keeps its table until a search has no results in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  setup({ [`GET ${workspace}/quotas`]: { dimensions: [] } }); open(); await ready()
  const section = screen.getByRole('region', { name: copy.workspace })
  expect(within(section).getByText(locale === 'es' ? '0 dimensiones' : '0 dimensions')).toBeVisible()
  const table = within(section).getByRole('table')
  expect(within(table).getByRole('columnheader', { name: copy.dimension })).toBeVisible()
  expect(within(table).queryAllByRole('rowheader')).toHaveLength(0)
  expect(within(section).queryByText(copy.noResults)).not.toBeInTheDocument()
  expect(within(section).queryByRole('button', { name: copy.clear })).not.toBeInTheDocument()
  const before = requests.mock.mock.calls.length
  const search = within(section).getByRole('searchbox')
  fireEvent.change(search, { target: { value: 'unmatched' } })
  expect(within(section).getByText(copy.noResults)).toBeVisible()
  fireEvent.click(within(section).getByRole('button', { name: copy.clear }))
  expect(search).toHaveFocus(); expect(search).toHaveValue('')
  expect(within(section).getByRole('table')).toBeVisible()
  expect(within(section).queryByText(copy.noResults)).not.toBeInTheDocument()
  expect(requests.mock.mock.calls).toHaveLength(before)
})
test.each(['superadmin', 'platform_operator'])('%s has the action column and plan-wide two-step save', async (role) => {
  setup(); open(role); await review()
  expect(puts()).toHaveLength(0)
  const dialog = screen.getByRole('dialog', { name: /^Ajustar cuota:/ })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(dialog).toHaveTextContent('Synthetic Shared Plan')
  expect(dialog).toHaveTextContent('todas las organizaciones')
  fireEvent.click(screen.getByRole('button', { name: es.back }))
  expect(screen.getByRole('spinbutton')).toHaveValue(500); expect(puts()).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: es.save })); await confirm()
  await screen.findByRole('button', { name: es.close })
  expect(puts()).toHaveLength(1)
  expect(puts()[0][0]).toBe(put); expect(JSON.parse(puts()[0][1]!.body as string)).toEqual({ value: 500 })
  await waitFor(() => expect(calls('GET').filter(([path]) => path === `${tenant}/quotas`)).toHaveLength(2))
  await waitFor(() => expect(screen.getByRole('button', { name: es.close })).toHaveFocus())
  expect(requests.mock.mock.calls.filter(([path]) => path === plan)).toHaveLength(1)
  expect(screen.getByRole('dialog', { name: /^Ajustar cuota:/ })).toHaveTextContent(es.saved)
  expect(within(screen.getByRole('region', { name: es.notifications })).getAllByText(es.saved, { exact: true })).toHaveLength(1)
})

test('the toast viewport label follows a locale change without remounting the page', async () => {
  setup(); open(); await ready()
  expect(screen.getByRole('region', { name: es.notifications })).toBeInTheDocument()
  await act(async () => { await i18n.changeLanguage('en') })
  expect(screen.getByRole('region', { name: en.notifications })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: es.notifications })).not.toBeInTheDocument()
})
test.each(['tenant_viewer', 'member', 'platform_admin'])('%s has no action column and sends no plan or save requests', async (role) => {
  setup(); open(role); await ready()
  expect(screen.queryByRole('columnheader', { name: es.action })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /ajustar cuota/i })).not.toBeInTheDocument()
  expect(calls('GET')).toHaveLength(4); expect(puts()).toHaveLength(0)
})
test.each(['', '-2', '1.5'])('rejects invalid limit %s with the legacy validation and field focus', async (value) => {
  setup(); open(); const { input } = await adjust()
  fireEvent.change(input, { target: { value } }); fireEvent.click(screen.getByRole('button', { name: es.save }))
  expect(screen.getByText(es.invalid)).toBeVisible(); expect(input).toHaveFocus(); expect(puts()).toHaveLength(0)
})
test('seeds unbounded limits as -1 and saves the unlimited sentinel unchanged', async () => {
  setup({ 'PUT /v1/plans/synthetic-plan/limits/events': { newValue: -1 } }); open(); await ready()
  fireEvent.click(screen.getAllByRole('button', { name: 'Ajustar cuota de Synthetic Events' })[0])
  const input = await screen.findByRole('spinbutton'); expect(input).toHaveValue(-1)
  expect(screen.getByRole('dialog', { name: /^Ajustar cuota:/ })).toHaveTextContent('Valor actual: sin límite')
  fireEvent.click(screen.getByRole('button', { name: es.save })); await confirm()
  await screen.findByRole('button', { name: es.close })
  expect(JSON.parse(puts()[0][1]!.body as string)).toEqual({ value: -1 })
  expect(screen.getByRole('dialog', { name: /^Ajustar cuota:/ })).toHaveTextContent('ahora es sin límite')
})
test('a draft plan reaches the form and can save', async () => {
  setup({ [`GET ${plan}`]: { ...tenantPlanReady, plan: { ...tenantPlanReady.plan, status: 'draft' } } }); open(); await review(); await confirm()
  await screen.findByRole('button', { name: es.close }); expect(puts()).toHaveLength(1)
})
test.each(['deprecated', 'archived'])('a %s plan is frozen and links to the legacy plan', async (status) => {
  setup({ [`GET ${plan}`]: { ...tenantPlanReady, plan: { ...tenantPlanReady.plan, status } } }); open(); await ready()
  fireEvent.click(screen.getAllByRole('button', { name: 'Ajustar cuota de Maximum Workspaces' })[0])
  expect(await screen.findByRole('link', { name: es.openPlan })).toHaveAttribute('href', '/console/plans/synthetic-plan')
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument(); expect(puts()).toHaveLength(0)
})
test.each([{ noAssignment: true }, { assignment: { planId: 'synthetic-plan' } }])('handles a missing plan without a field', async (data) => {
  setup({ [`GET ${plan}`]: data }); open(); await ready()
  fireEvent.click(screen.getAllByRole('button', { name: 'Ajustar cuota de Maximum Workspaces' })[0])
  expect(await screen.findByRole('link', { name: es.assignPlan })).toHaveAttribute('href', '/console/tenants/synthetic-tenant/plan')
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
})
test.each([400, 409, 403, 404, 500])('keeps the form and maps save status %s', async (status) => {
  const code = status === 400 ? 'INVALID_LIMIT_VALUE' : status === 409 ? 'PLAN_LIMITS_FROZEN' : `HTTP_${status}`
  setup({ [`PUT ${put}`]: () => response(status, code) }); open(); await review(); await confirm()
  expect(await screen.findByText(es.saveError)).toBeVisible()
  expect(screen.getByRole('dialog', { name: /^Ajustar cuota:/ })).toHaveTextContent(status === 400 ? es.invalidServer : status === 409 ? es.frozenServer : `${code}: synthetic-error`)
  expect(screen.getByRole('spinbutton')).toHaveValue(500)
  expect(screen.getByRole('button', { name: es.cancel })).toBeEnabled()
  expect(calls('GET').filter(([path]) => path === `${tenant}/quotas`)).toHaveLength(1)
})
test.each([true, false])('save pending blocks duplicate writes, Escape and dismissals; success=%s', async (success) => {
  const pending = deferred<Response>(); setup({ [`PUT ${put}`]: () => pending.promise }); open(); await review(); await confirm()
  const dialog = screen.getByRole('dialog', { name: /^Ajustar cuota:/ }); const saving = screen.getByRole('button', { name: es.saving })
  expect(saving).toBeDisabled(); expect(screen.getByRole('button', { name: es.cancel })).toBeDisabled()
  expect(screen.queryByRole('button', { name: es.close })).not.toBeInTheDocument()
  fireEvent.click(saving); fireEvent.keyDown(dialog, { key: 'Escape' }); fireEvent.pointerDown(document.body); fireEvent.click(document.body)
  expect(dialog).toBeVisible(); expect(puts()).toHaveLength(1)
  await act(async () => pending.resolve(success ? Response.json({ newValue: 500 }) : response(500)))
  await screen.findByRole('button', { name: success ? es.close : es.cancel })
})
test('Escape from confirmation sends no PUT and restores the exact row focus', async () => {
  setup(); open(); const { trigger } = await review()
  fireEvent.keyDown(screen.getByRole('dialog', { name: /^Ajustar cuota:/ }), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Ajustar cuota:/ })).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus()); expect(puts()).toHaveLength(0)
})
test('the resolving state exposes only status and becomes a focused form', async () => {
  const pending = deferred<Response>(); setup({ [`GET ${plan}`]: () => pending.promise }); open(); await ready()
  fireEvent.click(screen.getAllByRole('button', { name: 'Ajustar cuota de Maximum Workspaces' })[0])
  expect(await screen.findByText(es.resolving)).toHaveAttribute('role', 'status')
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: es.save })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: es.cancel })).not.toBeInTheDocument()
  await act(async () => pending.resolve(Response.json(tenantPlanReady)))
  await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveFocus())
})
test('plan resolution errors keep focus inside and retry only the plan request', async () => {
  let count = 0
  setup({ [`GET ${plan}`]: () => ++count === 1 ? response(500) : Response.json(tenantPlanReady) }); open(); await ready()
  fireEvent.click(screen.getAllByRole('button', { name: 'Ajustar cuota de Maximum Workspaces' })[0])
  expect(await screen.findByText(es.planError)).toBeVisible()
  expect(screen.getByRole('button', { name: es.close })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: es.retry }))
  expect(await screen.findByRole('spinbutton')).toHaveValue(5); expect(count).toBe(2); expect(calls('GET')).toHaveLength(6)
})
test.each([false, true])('retrying a failed plan focuses the resolved spinbutton; delayed=%s', async (delayed) => {
  const pending = deferred<Response>(); let count = 0
  setup({ [`GET ${plan}`]: () => ++count === 1 ? response(500) : delayed ? pending.promise : Response.json(tenantPlanReady) }); open(); await ready()
  fireEvent.click(screen.getAllByRole('button', { name: 'Ajustar cuota de Maximum Workspaces' })[0])
  expect(await screen.findByText(es.planError)).toBeVisible()
  const retry = screen.getByRole('button', { name: es.retry })
  retry.focus(); fireEvent.click(retry)
  if (delayed) {
    expect(screen.getByText(es.resolving)).toBeVisible()
    await waitFor(() => expect(screen.getByRole('dialog', { name: /^Ajustar cuota:/ })).toHaveFocus())
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    await act(async () => pending.resolve(Response.json(tenantPlanReady)))
  }
  await waitFor(() => expect(screen.getByRole('spinbutton')).toHaveFocus())
  expect(screen.getByRole('spinbutton')).toHaveValue(5)
  expect(count).toBe(2); expect(calls('GET')).toHaveLength(6); expect(puts()).toHaveLength(0)
})
test('no tenant sends no requests; a tenant without workspace sends only the tenant pair', async () => {
  context.activeTenantId = null; setup(); const view = open()
  expect(await screen.findByText(es.blocked)).toBeVisible(); expect(calls('GET')).toHaveLength(0)
  context.activeTenantId = 'synthetic-tenant'; context.activeWorkspaceId = null
  view.rerender(<MemoryRouter><ConsoleQuotasPage /></MemoryRouter>)
  await ready(); expect(calls('GET')).toHaveLength(2); expect(screen.getAllByRole('table')).toHaveLength(1)
})
test.each([403, 404, 500, 0])('posture failure %s removes stale tables and exposes recovery', async (status) => {
  setup({ [`GET ${tenant}/quotas`]: () => { if (!status) throw new TypeError('synthetic-network'); return response(status) } }); open()
  expect(await screen.findByText(status === 403 ? es.noAccess : status === 404 ? es.notFound : es.error)).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  if (status === 404) expect(screen.getByRole('link', { name: es.consoleStart })).toHaveAttribute('href', '/console')
  if (status === 500) expect(screen.getByText('req_synthetic_quotas')).toBeVisible()
  if (![403, 404].includes(status)) expect(screen.getByRole('button', { name: es.retry })).toBeEnabled()
})
test('retry restores posture after a failure and sends only the same metrics pairs', async () => {
  let count = 0
  setup({ [`GET ${tenant}/quotas`]: () => ++count === 1 ? response(500) : Response.json(quotasTenant) }); open()
  fireEvent.click(await screen.findByRole('button', { name: es.retry })); await ready()
  expect(count).toBe(2); expect(calls('GET')).toHaveLength(6)
})
test('empty tenant posture renders the first-run copy', async () => {
  context.activeWorkspaceId = null; setup({ [`GET ${tenant}/quotas`]: { dimensions: [] } }); open()
  expect(await screen.findByText(es.empty)).toBeVisible(); expect(screen.getByText(es.emptyDescription)).toBeVisible()
})
test('normalization preserves breach overrides, optional unit fallback, counts and unlimited formatting', () => {
  const data = normalize({ dimensions: [{ dimensionId: 'storage_bytes', measuredValue: 2048 }, { dimensionId: 'keys', hardLimit: 0, measuredValue: 2 }] }, { hardLimitDimensions: ['keys'] })
  expect(formatValue(2048, data.dimensions[0])).toBe('2.0 KB')
  expect(formatValue(2048, data.dimensions[1])).toBe('2048')
  expect(data.dimensions[1].pctUsed).toBeNull(); expect(data.dimensions[1].isExceeded).toBe(true)
})
test('locale catalogs have identical keys', () => {
  const keys = (data: object, prefix = ''): string[] => Object.entries(data).flatMap(([key, value]) => typeof value === 'object' ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`])
  expect(keys(es).sort()).toEqual(keys(en).sort())
})

test('closing success restores focus to the refreshed row after a delayed posture reload', async () => {
  const pending = deferred<Response>(); let count = 0
  setup({ [`GET ${tenant}/quotas`]: () => ++count === 1 ? Response.json(quotasTenant) : pending.promise }); open(); await review(); await confirm()
  fireEvent.click(await screen.findByRole('button', { name: es.close }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Ajustar cuota:/ })).not.toBeInTheDocument())
  await act(async () => pending.resolve(Response.json(quotasTenant)))
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Ajustar cuota de Maximum Workspaces' })[0]).toHaveFocus())
})

test('closing a workspace adjustment returns focus to its workspace row rather than the tenant row', async () => {
  setup(); open(); await ready()
  const triggers = screen.getAllByRole('button', { name: 'Ajustar cuota de Maximum Workspaces' })
  triggers[1].focus(); fireEvent.click(triggers[1])
  await screen.findByRole('spinbutton')
  fireEvent.click(screen.getByRole('button', { name: es.cancel }))
  await waitFor(() => expect(triggers[1]).toHaveFocus())
  expect(puts()).toHaveLength(0)
})
