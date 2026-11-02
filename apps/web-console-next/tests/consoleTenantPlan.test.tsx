import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession } from '@in-falcone/console-api/session'
import ConsoleTenantPlanPage from '../src/pages/consoleTenantPlan'
import { App } from '../src/App'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-tenant-plan-page.json'
import en from '../src/locales/en/pages.console-tenant-plan-page.json'
import * as legacy from '../../web-console/src/services/planManagementApi'
import { assignPlan, getEffectiveEntitlements, getPlanChangeHistory, getTenantPlan, listActivePlans } from '../src/pages/consoleTenantPlan/api'
import {
  activePlans, activePlansWithoutTeam, assignedBody, entitlementsMixed, entitlementsNoLimits, freePlan, historyEntries, historyResponse, isTenantPlanQuery, proPlan, unassignedPlan,
  buildTenantPlanEndpoints, cspTenantId,
} from './parity/pages/console-tenant-plan-page.manifest'
import { login, renderWithSession, strictFetch, tenantUrl } from './shell-support'
// @ts-expect-error Browser helpers intentionally use native JavaScript modules.
import { installSession } from './browser-session.mjs'

const planUrl = '/v1/tenants/ten_alpha/plan'
const entitlementsUrl = `${planUrl}/effective-entitlements?include=consumption`
const historyUrl = (page = 1) => `${planUrl}/history-impact?page=${page}&pageSize=20`
const plansUrl = '/v1/plans?status=active&page=1&pageSize=20'
const refreshUrl = '/v1/auth/login-sessions/synthetic-session/refresh'
const json = (body: unknown, status = 200) => Response.json(body, { status })
const fail = (status: number, extra: Record<string, unknown> = {}) => json({ code: `HTTP_${status}`, message: 'PRIVATE_MARKER', ...extra }, status)
const network = () => Promise.reject(new TypeError('Synthetic network failure'))
const sequence = (...handlers: Array<() => Response | Promise<Response>>) => { let count = 0; return () => handlers[Math.min(count++, handlers.length - 1)]() }
const ok = (body: unknown) => () => json(body)
const history = (page: number) => ok(historyResponse('success', new URL(`http://localhost${historyUrl(page)}`)).body)
const plansBody = (items = activePlans) => ({ items, total: items.length, page: 1, pageSize: 20 })

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())
function setup(extra: Record<string, unknown> = {}) {
  requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [] },
    [`GET ${planUrl}`]: proPlan, [`GET ${entitlementsUrl}`]: entitlementsMixed,
    [`GET ${historyUrl(1)}`]: history(1), [`GET ${historyUrl(2)}`]: history(2), [`GET ${historyUrl(3)}`]: history(3),
    [`GET ${plansUrl}`]: plansBody(), ...extra,
  })
}
const all = () => requests.mock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
const planCalls = () => all().filter((call) => call.includes('/plan') && !call.includes(tenantUrl) || call.includes('/v1/plans'))
const count = (call: string) => all().filter((value) => value === call).length
const posts = () => requests.mock.mock.calls.filter(([, init]) => init?.method === 'POST' && String(init?.body ?? '').includes('planId'))
function open(role = 'superadmin') {
  login([role])
  return renderWithSession(<Routes><Route path="/console/tenants/:tenantId/plan" element={<ConsoleTenantPlanPage />} /></Routes>, { route: '/console/tenants/ten_alpha/plan' })
}
const ready = () => screen.findByRole('tab', { name: es.tabSummary })
const wait = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
async function choose(label: string, option: string) {
  const trigger = screen.getByRole('combobox', { name: label })
  trigger.focus(); fireEvent.click(trigger)
  const item = await screen.findByRole('option', { name: option })
  fireEvent.pointerDown(item); fireEvent.click(item)
  await wait()
}
async function openDialog() {
  await ready()
  fireEvent.click(screen.getByRole('button', { name: es.changePlan }))
  return screen.findByRole('dialog', { name: 'Asignar plan a ten_alpha' })
}
async function dialogReady() {
  const dialog = await openDialog()
  await waitFor(() => expect(within(dialog).getByRole('combobox', { name: es.dialog.activePlan })).toBeEnabled())
  return dialog
}
const confirm = () => fireEvent.click(screen.getByRole('button', { name: es.dialog.confirm }))
async function failedAssignment(handler: () => Response | Promise<Response>) {
  setup({ [`POST ${planUrl}`]: handler })
  open(); const dialog = await dialogReady()
  await choose(es.dialog.activePlan, 'Synthetic Team')
  confirm()
  return dialog
}
const openHistory = async () => { await ready(); fireEvent.mouseDown(screen.getByRole('tab', { name: es.tabHistory })); fireEvent.click(screen.getByRole('tab', { name: es.tabHistory })) }

test('loads exactly the four reads and renders the summary without billing fields or kit samples', async () => {
  setup(); open(); await ready()
  expect(await screen.findByText('Synthetic Pro')).toBeVisible()
  expect(all().filter((call) => call !== `GET ${tenantUrl}`).sort()).toEqual([`GET ${planUrl}`, `GET ${entitlementsUrl}`, `GET ${historyUrl(1)}`, `GET ${plansUrl}`].sort())
  expect(screen.getByRole('heading', { level: 1, name: es.title })).toBeVisible()
  expect(screen.getByText(es.status.active)).toBeVisible()
  expect(screen.getByText('ten_alpha')).toBeVisible()
  expect(screen.getByRole('table')).toBeVisible()
  expect(screen.getAllByRole('meter').length).toBeGreaterThan(0)
  expect(screen.getAllByText(es.summary.unlimited).length).toBeGreaterThan(0)
  for (const label of [es.usage.within_limit, es.usage.at_limit, es.usage.over_limit, es.usage.unknown]) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  expect(screen.getByText(es.summary.noData)).toBeVisible()
  expect(document.body).not.toHaveTextContent(/\/\s*(month|mo|año|mes)|renew|renov|\$|€/i)
  expect(document.body).not.toHaveTextContent('pages.console-tenant-plan-page.')
  expect(screen.getByRole('link', { name: es.tenants })).toHaveAttribute('href', '/console/tenants')
})

test.each(['es', 'en'] as const)('renders the same page in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  setup(); open(); await screen.findByRole('tab', { name: copy.tabSummary })
  expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
  expect(screen.getByRole('button', { name: copy.changePlan })).toBeVisible()
  expect(screen.getByRole('columnheader', { name: copy.summary.consumption })).toBeVisible()
  expect(document.documentElement.lang).toBe(locale)
  expect(document.body).not.toHaveTextContent('pages.console-tenant-plan-page.')
})

test('an unassigned tenant offers Asignar plan and the unassigned explanation', async () => {
  setup({ [`GET ${planUrl}`]: unassignedPlan, [`GET ${entitlementsUrl}`]: entitlementsNoLimits }); open(); await ready()
  expect(screen.getByText(es.summary.noPlan)).toBeVisible()
  expect(screen.getByRole('button', { name: es.assignPlan })).toBeVisible()
  expect(screen.getByText(es.summary.noLimitsUnassigned)).toBeVisible()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

test('an assigned plan without limits shows the assigned explanation', async () => {
  setup({ [`GET ${entitlementsUrl}`]: entitlementsNoLimits }); open(); await ready()
  expect(screen.getByText(es.summary.noLimitsAssigned)).toBeVisible()
})

test.each([['assignment', `GET ${planUrl}`], ['entitlements', `GET ${entitlementsUrl}`]])('a failing %s read replaces the summary and shows no partial plan', async (_name, key) => {
  setup({ [key]: sequence(() => fail(500, { requestId: 'req_page_500' }), ok(key.includes('entitlements') ? entitlementsMixed : proPlan)) }); open()
  expect(await screen.findByRole('heading', { name: es.plan.errorTitle })).toBeVisible()
  expect(screen.getByText('req_page_500')).toBeVisible()
  expect(screen.queryByText('Synthetic Pro')).not.toBeInTheDocument()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
  fireEvent.click(screen.getByRole('button', { name: es.retry }))
  expect(await screen.findByText('Synthetic Pro')).toBeVisible()
  expect(count(`GET ${planUrl}`)).toBe(2); expect(count(`GET ${entitlementsUrl}`)).toBe(2)
  expect(count(`GET ${historyUrl(1)}`)).toBe(1); expect(count(`GET ${plansUrl}`)).toBe(1)
})

test('the page error surfaces map 403, 404 and a network error', async () => {
  setup({ [`GET ${planUrl}`]: () => fail(403) }); const first = open()
  expect(await screen.findByRole('heading', { name: es.plan.noAccessTitle })).toBeVisible()
  expect(screen.queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
  first.unmount()
  setup({ [`GET ${planUrl}`]: () => fail(404) }); const second = open()
  expect(await screen.findByRole('heading', { name: es.plan.notFoundTitle })).toBeVisible()
  expect(screen.getByRole('link', { name: es.plan.backToTenants })).toHaveAttribute('href', '/console/tenants')
  second.unmount()
  setup({ [`GET ${entitlementsUrl}`]: network }); open()
  expect(await screen.findByRole('heading', { name: es.plan.errorTitle })).toBeVisible()
  expect(screen.getByText(es.plan.networkMessage)).toBeVisible()
  expect(screen.queryByText('Synthetic Pro')).not.toBeInTheDocument()
})

test('skeletons show until both the assignment and the entitlements answer', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  setup({ [`GET ${entitlementsUrl}`]: async () => { await gate; return json(entitlementsMixed) } }); open()
  expect(await screen.findByRole('status', { name: es.loadingPlan })).toHaveAttribute('aria-busy', 'true')
  await wait()
  expect(screen.queryByText('Synthetic Pro')).not.toBeInTheDocument()
  release()
  expect(await screen.findByText('Synthetic Pro')).toBeVisible()
})

test('history is server paginated at 20 and hides its footer at 20 or fewer', async () => {
  setup(); open(); await openHistory()
  expect(await screen.findAllByTestId('plan-history-entry')).toHaveLength(20)
  expect(screen.getByText('1-20 de 45')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Página 2' }))
  await waitFor(() => expect(count(`GET ${historyUrl(2)}`)).toBe(1))
  await waitFor(() => expect(screen.getByText('21-40 de 45')).toBeVisible())
  await waitFor(() => expect(screen.getAllByTestId('plan-history-entry')[0]).toHaveFocus())
})

test('the history footer is hidden for a single page and the empty envelope shows the empty copy', async () => {
  setup({ [`GET ${historyUrl(1)}`]: { items: historyEntries.slice(0, 20), total: 20, page: 1, pageSize: 20 } }); const first = open(); await openHistory()
  expect(await screen.findAllByTestId('plan-history-entry')).toHaveLength(20)
  expect(screen.queryByRole('navigation', { name: es.history.pagination })).not.toBeInTheDocument()
  first.unmount()
  setup({ [`GET ${historyUrl(1)}`]: { items: [], total: 0, page: 1, pageSize: 20 } }); open(); await openHistory()
  expect(await screen.findByRole('heading', { name: es.history.empty })).toBeVisible()
})

test('an expanded history entry exposes its state and impact tables', async () => {
  setup(); open(); await openHistory()
  const [first] = await screen.findAllByTestId('plan-history-entry')
  const toggle = within(first).getByRole('button', { name: new RegExp(es.history.showDetails) })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  await waitFor(() => expect(within(first).getByRole('button', { name: new RegExp(es.history.hideDetails) })).toHaveAttribute('aria-expanded', 'true'))
  expect(within(first).getByRole('heading', { name: es.history.impactSummary })).toBeVisible()
  expect(within(first).getByText('Synthetic reason')).toBeVisible()
  expect(within(first).getAllByRole('table')).toHaveLength(2)
  expect(within(first).getByText('Synthetic SSO')).toBeVisible()
})

test.each([
  ['403', () => fail(403), es.history.noAccessTitle],
  ['404', () => fail(404), es.history.notFoundTitle],
])('a history %s stays inside Historial with the summary usable', async (_status, handler, heading) => {
  setup({ [`GET ${historyUrl(1)}`]: handler }); open(); await openHistory()
  expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  expect(screen.queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
  if (_status === '404') expect(screen.getByRole('button', { name: es.history.backToSummary })).toBeVisible()
  else expect(screen.queryByRole('button', { name: es.history.backToSummary })).not.toBeInTheDocument()
  fireEvent.mouseDown(screen.getByRole('tab', { name: es.tabSummary })); fireEvent.click(screen.getByRole('tab', { name: es.tabSummary }))
  expect(await screen.findByText('Synthetic Pro')).toBeVisible()
})

test('a history 404 offers Volver a Resumen and a 403 offers nothing', async () => {
  setup({ [`GET ${historyUrl(1)}`]: () => fail(404) }); const first = open(); await openHistory()
  fireEvent.click(await screen.findByRole('button', { name: es.history.backToSummary }))
  expect(await screen.findByText('Synthetic Pro')).toBeVisible()
  expect(screen.getByRole('tab', { name: es.tabSummary })).toHaveAttribute('aria-selected', 'true')
  await waitFor(() => expect(screen.getByRole('tab', { name: es.tabSummary })).toHaveFocus())
  first.unmount()
  setup({ [`GET ${historyUrl(1)}`]: () => fail(403) }); open(); await openHistory()
  await screen.findByRole('heading', { name: es.history.noAccessTitle })
  expect(screen.queryByRole('button', { name: es.history.backToSummary })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
})

test.each([['500', () => fail(500, { requestId: 'req_history_500' })], ['network', network]])('a history %s retries only the current history page', async (_name, failing) => {
  setup({ [`GET ${historyUrl(2)}`]: sequence(failing, history(2)) }); open(); await openHistory()
  await screen.findAllByTestId('plan-history-entry')
  fireEvent.click(screen.getByRole('button', { name: 'Página 2' }))
  expect(await screen.findByRole('heading', { name: es.history.errorTitle })).toBeVisible()
  if (_name === '500') expect(screen.getByText('req_history_500')).toBeVisible()
  const before = all().length
  fireEvent.click(screen.getByRole('button', { name: es.retry }))
  await waitFor(() => expect(screen.getAllByTestId('plan-history-entry')).toHaveLength(20))
  expect(all().slice(before)).toEqual([`GET ${historyUrl(2)}`])
  fireEvent.mouseDown(screen.getByRole('tab', { name: es.tabSummary })); fireEvent.click(screen.getByRole('tab', { name: es.tabSummary }))
  expect(await screen.findByText('Synthetic Pro')).toBeVisible()
})

test('the dialog lists only active plans, defaults to the current plan and posts exactly one assignment', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  setup({ [`POST ${planUrl}`]: async () => { await gate; return json({ assignmentId: 'a1' }) }, [`GET ${planUrl}`]: sequence(ok(proPlan), ok({ assignment: { planId: 'plan-team' }, plan: { displayName: 'Synthetic Team', status: 'active' } })) })
  open(); const dialog = await dialogReady()
  expect(within(dialog).getByRole('heading', { name: 'Asignar plan a ten_alpha' })).toBeVisible()
  expect(within(dialog).getByRole('combobox', { name: es.dialog.activePlan })).toHaveTextContent('Synthetic Pro')
  fireEvent.click(within(dialog).getByRole('combobox', { name: es.dialog.activePlan }))
  expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['Synthetic Free', 'Synthetic Pro', 'Synthetic Team'])
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' }); await wait()
  await choose(es.dialog.activePlan, 'Synthetic Team')
  confirm()
  const submit = await screen.findByRole('button', { name: es.dialog.confirming })
  expect(submit).toBeDisabled(); expect(submit).toHaveAttribute('aria-busy', 'true')
  fireEvent.click(submit); fireEvent.submit(dialog.querySelector('form')!)
  expect(screen.getByRole('button', { name: es.changePlan, hidden: true })).toBeDisabled()
  expect(screen.getByRole('button', { name: es.changePlan, hidden: true })).toHaveAttribute('aria-busy', 'true')
  release()
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asignar plan a ten_alpha' })).not.toBeInTheDocument())
  expect(posts()).toHaveLength(1)
  expect(posts()[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(assignedBody) })
  expect(posts()[0][0]).toBe(planUrl)
  // The header is refetched so the previous plan never stays current.
  await waitFor(() => expect(count(`GET ${planUrl}`)).toBe(2))
  expect(count(`GET ${entitlementsUrl}`)).toBe(2)
  expect(await screen.findByText('Synthetic Team', { selector: 'dd, span, div' })).toBeVisible()
  expect(screen.getAllByText('Plan Synthetic Team asignado a la organización.').length).toBeGreaterThanOrEqual(1)
  await waitFor(() => expect(screen.getByRole('button', { name: es.changePlan })).toHaveFocus())
})

test('the dialog defaults to the first active plan when none is current', async () => {
  setup({ [`GET ${planUrl}`]: unassignedPlan, [`GET ${entitlementsUrl}`]: entitlementsNoLimits }); open()
  await ready(); fireEvent.click(screen.getByRole('button', { name: es.assignPlan }))
  const dialog = await screen.findByRole('dialog', { name: 'Asignar plan a ten_alpha' })
  await waitFor(() => expect(within(dialog).getByRole('combobox', { name: es.dialog.activePlan })).toHaveTextContent('Synthetic Free'))
  expect(within(dialog).getByRole('button', { name: es.dialog.confirm })).toBeEnabled()
})

test('Cancelar closes without a request and returns focus to Cambiar plan', async () => {
  setup(); open(); const dialog = await dialogReady()
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog.cancel }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asignar plan a ten_alpha' })).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: es.changePlan })).toHaveFocus()
  expect(posts()).toHaveLength(0)
})

test('Confirmar stays disabled while the catalogue loads and recovers with a catalogue-only Reintentar', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  setup({ [`GET ${plansUrl}`]: sequence(async () => { await gate; return fail(500, { requestId: 'req_plans_500' }) }, ok(plansBody())) })
  open(); const dialog = await openDialog()
  expect(within(dialog).getByText(es.dialog.loadingPlans)).toBeVisible()
  expect(within(dialog).getByRole('button', { name: es.dialog.confirm })).toBeDisabled()
  expect(within(dialog).getByRole('combobox', { name: es.dialog.activePlan })).toBeDisabled()
  release()
  expect(await within(dialog).findByRole('heading', { name: es.plans.errorTitle })).toBeVisible()
  expect(within(dialog).getByText('req_plans_500')).toBeVisible()
  expect(within(dialog).getByRole('button', { name: es.dialog.confirm })).toBeDisabled()
  const before = all().length
  fireEvent.click(within(dialog).getByRole('button', { name: es.retry }))
  await waitFor(() => expect(within(dialog).getByRole('combobox', { name: es.dialog.activePlan })).toBeEnabled())
  expect(all().slice(before)).toEqual([`GET ${plansUrl}`])
  expect(within(dialog).getByRole('button', { name: es.dialog.confirm })).toBeEnabled()
})

test.each([['403', () => fail(403), es.plans.noAccessTitle], ['404', () => fail(404), es.plans.notFoundTitle], ['network', network, es.plans.errorTitle]])('a catalogue %s stays in the dialog with Confirmar disabled', async (_name, handler, heading) => {
  setup({ [`GET ${plansUrl}`]: handler }); open(); const dialog = await openDialog()
  expect(await within(dialog).findByRole('heading', { name: heading })).toBeVisible()
  expect(within(dialog).getByRole('button', { name: es.dialog.confirm })).toBeDisabled()
  expect(screen.getByRole('tab', { name: es.tabSummary, hidden: true })).toBeInTheDocument()
})

test('an empty catalogue shows the no-active-plans empty state with Confirmar disabled', async () => {
  setup({ [`GET ${plansUrl}`]: plansBody([]) }); open(); const dialog = await openDialog()
  expect(await within(dialog).findByRole('heading', { name: es.dialog.noPlansTitle })).toBeVisible()
  expect(within(dialog).getByRole('button', { name: es.dialog.confirm })).toBeDisabled()
})

test('a 500 sends no automatic retry and each Reintentar sends exactly one more POST', async () => {
  const dialog = await failedAssignment(sequence(() => fail(500, { requestId: 'req_assign_500' }), () => fail(500), ok({ assignmentId: 'a1' })))
  expect(await within(dialog).findByRole('heading', { name: es.assign.errorTitle })).toBeVisible()
  expect(within(dialog).getByText('req_assign_500')).toBeVisible()
  expect(document.body).not.toHaveTextContent('PRIVATE_MARKER')
  await wait(); await wait()
  expect(posts()).toHaveLength(1)
  expect(within(dialog).getByRole('combobox', { name: es.dialog.activePlan })).toHaveTextContent('Synthetic Team')
  await waitFor(() => expect(within(dialog).getByRole('button', { name: es.retry })).toHaveFocus())
  fireEvent.click(within(dialog).getByRole('button', { name: es.retry }))
  await waitFor(() => expect(posts()).toHaveLength(2))
  fireEvent.click(await within(dialog).findByRole('button', { name: es.retry }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asignar plan a ten_alpha' })).not.toBeInTheDocument())
  expect(posts()).toHaveLength(3)
  expect(count(`GET ${planUrl}`)).toBe(2)
})

test('after a network error Reintentar re-reads the plan and sends no POST when it is already assigned', async () => {
  const taken = { assignment: { planId: 'plan-team' }, plan: { displayName: 'Synthetic Team', status: 'active' } }
  setup({ [`POST ${planUrl}`]: network, [`GET ${planUrl}`]: sequence(ok(proPlan), ok(taken)) })
  open(); const dialog = await dialogReady()
  await choose(es.dialog.activePlan, 'Synthetic Team'); confirm()
  expect(await within(dialog).findByText(es.assign.networkMessage)).toBeVisible()
  expect(posts()).toHaveLength(1)
  fireEvent.click(within(dialog).getByRole('button', { name: es.retry }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asignar plan a ten_alpha' })).not.toBeInTheDocument())
  expect(posts()).toHaveLength(1)
  expect(count(`GET ${planUrl}`)).toBeGreaterThanOrEqual(2)
})

test('after a network error Reintentar sends one POST when the selected plan is not current', async () => {
  setup({ [`POST ${planUrl}`]: sequence(network, ok({ assignmentId: 'a1' })), [`GET ${planUrl}`]: ok(proPlan) })
  open(); const dialog = await dialogReady()
  await choose(es.dialog.activePlan, 'Synthetic Team'); confirm()
  expect(await within(dialog).findByText(es.assign.networkMessage)).toBeVisible()
  fireEvent.click(within(dialog).getByRole('button', { name: es.retry }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asignar plan a ten_alpha' })).not.toBeInTheDocument())
  expect(posts()).toHaveLength(2)
})

test('a failed re-read keeps the unknown outcome so the next Reintentar re-reads again before any POST', async () => {
  setup({ [`POST ${planUrl}`]: sequence(network, ok({ assignmentId: 'a1' })), [`GET ${planUrl}`]: sequence(ok(proPlan), () => fail(500), ok(proPlan)) })
  open(); const dialog = await dialogReady()
  await choose(es.dialog.activePlan, 'Synthetic Team'); confirm()
  await within(dialog).findByText(es.assign.networkMessage)
  fireEvent.click(within(dialog).getByRole('button', { name: es.retry }))
  await within(dialog).findByText(es.assign.errorMessage)
  expect(posts()).toHaveLength(1)
  fireEvent.click(within(dialog).getByRole('button', { name: es.retry }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asignar plan a ten_alpha' })).not.toBeInTheDocument())
  expect(posts()).toHaveLength(2)
})

test('an assignment 403 shows no access with Cerrar, no resend and focus returns to Cambiar plan', async () => {
  const dialog = await failedAssignment(() => fail(403))
  expect(await within(dialog).findByRole('heading', { name: es.assign.noAccessTitle })).toBeVisible()
  expect(within(dialog).queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: es.dialog.confirm })).not.toBeInTheDocument()
  expect(within(dialog).getByRole('combobox', { name: es.dialog.activePlan })).toHaveTextContent('Synthetic Team')
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog.close }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asignar plan a ten_alpha' })).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: es.changePlan })).toHaveFocus()
  expect(posts()).toHaveLength(1)
})

test('an assignment 404 names the plan and Volver a elegir plan re-requests only the catalogue', async () => {
  setup({ [`POST ${planUrl}`]: () => fail(404), [`GET ${plansUrl}`]: sequence(ok(plansBody()), ok(plansBody(activePlansWithoutTeam))) })
  open(); const dialog = await dialogReady()
  await choose(es.dialog.activePlan, 'Synthetic Team'); confirm()
  expect(await within(dialog).findByRole('heading', { name: 'No se encontró la organización o el plan Synthetic Team' })).toBeVisible()
  expect(within(dialog).queryByRole('button', { name: es.retry })).not.toBeInTheDocument()
  const before = all().length
  fireEvent.click(within(dialog).getByRole('button', { name: es.assign.chooseAgain }))
  await waitFor(() => expect(within(dialog).getByRole('combobox', { name: es.dialog.activePlan })).toHaveFocus())
  expect(all().slice(before)).toEqual([`GET ${plansUrl}`])
  expect(posts()).toHaveLength(1)
  expect(within(dialog).getByRole('combobox', { name: es.dialog.activePlan })).toHaveTextContent('Synthetic Pro')
  fireEvent.click(within(dialog).getByRole('combobox', { name: es.dialog.activePlan }))
  expect((await screen.findAllByRole('option')).map((option) => option.textContent)).not.toContain('Synthetic Team')
})

test.each(['ok', 'rejected'])('an assignment 401 never replays the POST (refresh %s)', async (refresh) => {
  const session = buildConsoleRefreshSessionFixture()
  setup({ [`POST ${planUrl}`]: sequence(() => fail(401), ok({ assignmentId: 'a1' })), [`POST ${refreshUrl}`]: () => refresh === 'ok' ? json(session) : fail(401) })
  open(); const dialog = await dialogReady()
  await choose(es.dialog.activePlan, 'Synthetic Team'); confirm()
  await waitFor(() => expect(count(`POST ${refreshUrl}`)).toBe(1))
  await wait(); await wait()
  expect(posts()).toHaveLength(1)
  if (refresh === 'ok') {
    expect(await within(dialog).findByText(es.dialog.sessionRenewed)).toBeVisible()
    expect(within(dialog).getByRole('combobox', { name: es.dialog.activePlan })).toHaveTextContent('Synthetic Team')
    expect(posts()).toHaveLength(1)
    confirm()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asignar plan a ten_alpha' })).not.toBeInTheDocument())
    expect(posts()).toHaveLength(2)
    expect(readConsoleShellSession()).not.toBeNull()
  } else expect(readConsoleShellSession()).toBeNull()
})

test.each([['401', () => fail(401)], ['403', () => fail(403)], ['404', () => fail(404)], ['500', () => fail(500)], ['network', network]])('assignment read %s never reaches the POST path', async (_name, handler) => {
  setup({ [`GET ${planUrl}`]: handler, [`POST ${refreshUrl}`]: () => fail(401) }); open(); await wait(); await wait()
  expect(posts()).toHaveLength(0)
})

test.each(['tenant_owner', 'platform_auditor'])('%s is denied and sends no plan request', async (role) => {
  login([role])
  setup()
  render(<MemoryRouter initialEntries={['/console/tenants/ten_alpha/plan']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Acceso denegado' })).toBeVisible()
  await wait()
  expect(planCalls()).toEqual([])
})

test('a user without roles is denied and sends no plan request', async () => {
  login([]); setup()
  render(<MemoryRouter initialEntries={['/console/tenants/ten_alpha/plan']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Acceso denegado' })).toBeVisible()
  await wait()
  expect(planCalls()).toEqual([])
})

test('requests match the legacy client method, path, query order and body field for field', async () => {
  const seen: Array<{ method: string; url: string; body?: string }> = []
  const record = (response: unknown = {}) => async (_input: RequestInfo | URL, init?: RequestInit) => { seen.push({ method: init?.method ?? 'GET', url: String(_input), body: typeof init?.body === 'string' ? init.body : undefined }); return Response.json(response) }
  login()
  vi.stubGlobal('fetch', vi.fn(record({ items: [], plans: [] })))
  await Promise.all([legacy.getTenantCurrentPlan('ten_alpha'), legacy.getEffectiveEntitlements('ten_alpha', { includeConsumption: true }), legacy.getPlanChangeHistory('ten_alpha'), legacy.listPlans({ status: 'active' }), legacy.assignPlan('ten_alpha', { planId: 'plan-team', assignedBy: 'console' })])
  const old = [...seen]; seen.length = 0
  await Promise.all([getTenantPlan('ten_alpha'), getEffectiveEntitlements('ten_alpha'), getPlanChangeHistory('ten_alpha', 1), listActivePlans(), assignPlan('ten_alpha', 'plan-team')])
  const key = (entry: { method: string; url: string }) => `${entry.method} ${entry.url}`
  expect(seen.map(key).sort()).toEqual(old.map(key).sort())
  expect(seen.find((entry) => entry.method === 'POST')?.body).toBe(old.find((entry) => entry.method === 'POST')?.body)
})

test('the CSP session allows exactly the two new query pairs and records any other query as unmatched', async () => {
  let handle!: (route: unknown) => Promise<void>
  const unmatched = await installSession({ addInitScript: vi.fn(), route: vi.fn((_pattern: string, callback: (route: unknown) => Promise<void>) => { handle = callback }) })
  const base = `/v1/tenants/${cspTenantId}/plan`
  const accepted = [base, `${base}/effective-entitlements?include=consumption`, `${base}/history-impact?page=1&pageSize=20`, '/v1/plans?status=active&page=1&pageSize=20']
  const rejected = [`${base}/history-impact?page=2&pageSize=20`, `${base}/history-impact?x=1`, `${base}/effective-entitlements?include=consumption&x=1`,
    `${base}/history-impact?pageSize=20&page=1`, `${base}/effective-entitlements?include=other`, `${base}?x=1`]
  for (const path of [...accepted, ...rejected]) {
    const route = { request: () => ({ method: () => 'GET', url: () => `http://localhost${path}`, postDataJSON: () => undefined }), fulfill: vi.fn(), abort: vi.fn() }
    await handle(route)
    expect(route.fulfill, path).toHaveBeenCalledTimes(accepted.includes(path) ? 1 : 0)
  }
  expect(unmatched).toEqual(rejected.map((path) => `GET ${path}`))
  expect(isTenantPlanQuery('POST', new URL(`http://localhost${base}/history-impact?page=1&pageSize=20`))).toBe(false)
  expect(Object.keys(buildTenantPlanEndpoints(cspTenantId))).toEqual(['tenantPlan', 'tenantEntitlements', 'tenantHistory', 'tenantPlanAssign'])
})

test('the free plan fixture and the legacy default selection stay in sync', () => {
  expect(freePlan.assignment?.planId).toBe('plan-free')
  expect(activePlans.filter((plan) => plan.status === 'active').map((plan) => plan.id)).toEqual(['plan-free', 'plan-pro', 'plan-team'])
})
