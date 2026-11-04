import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { LiveAnnouncer } from '@gntik-ai/ui'
import { afterEach, expect, test, vi } from 'vitest'
import { buildConsoleRefreshSessionFixture, buildConsoleSignupPolicyFixture } from '@in-falcone/console-api/fixtures'
import ConsolePlanDetailPage from '../src/pages/consolePlanDetail'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-plan-detail-page.json'
import en from '../src/locales/en/pages.console-plan-detail-page.json'
import { limitKey, limitRows, planDetailFixtures, planId, planName } from './parity/pages/console-plan-detail-page.manifest'
import { login, renderWithSession, strictFetch } from './shell-support'

const base = `/v1/plans/${planId}`
const limitsUrl = `${base}/limits`
const limitUrl = `${limitsUrl}/${limitKey}`
const lifecycleUrl = `${base}/lifecycle`
const refreshUrl = '/v1/auth/login-sessions/synthetic-session/refresh'
const json = (body: unknown, status = 200) => Response.json(body, { status })
const fail = (status: number, extra: Record<string, unknown> = {}) => json({ code: `HTTP_${status}`, message: 'PRIVATE_MARKER', detail: { marker: 'PRIVATE_MARKER' }, ...extra }, status)
const network = () => Promise.reject(new TypeError('PRIVATE_MARKER network failure'))
const sequence = (...handlers: Array<() => Response | Promise<Response>>) => { let count = 0; return () => handlers[Math.min(count++, handlers.length - 1)]() }
const fixtures = planDetailFixtures(planId)
const body = (key: 'detail' | 'limits', variant: string) => (fixtures[key][variant] as { body: unknown }).body
const draft = body('detail', 'draft'), active = body('detail', 'active-3-tenants'), deprecated = body('detail', 'deprecated'), archived = body('detail', 'archived')
const profile = body('limits', 'profile-6')

let requests: ReturnType<typeof strictFetch>
afterEach(() => { requests?.verify(); vi.unstubAllGlobals() })
function setup(extra: Record<string, unknown> = {}, record: unknown = draft) {
  requests = strictFetch({ [`GET ${base}`]: record, [`GET ${limitsUrl}`]: profile, ...extra })
}
const all = () => requests.mock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
const count = (call: string) => all().filter((value) => value === call).length
const bodiesOf = (call: string) => requests.mock.mock.calls.filter(([url, init]) => `${init?.method ?? 'GET'} ${url}` === call).map(([, init]) => JSON.parse(String(init?.body ?? 'null')))
const writes = () => all().filter((call) => !call.startsWith('GET '))
function open(role = 'superadmin') {
  login([role])
  return renderWithSession(<Routes>
    <Route path="/console/plans" element={<h1>Catalog</h1>} />
    <Route path="/console/plans/:planId" element={<LiveAnnouncer><ConsolePlanDetailPage /></LiveAnnouncer>} />
  </Routes>, { route: `/console/plans/${planId}` })
}
const ready = () => screen.findByRole('heading', { level: 1, name: planName })
const wait = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
const button = (name: string | RegExp) => screen.getByRole('button', { name })
const lifecycleButton = (label: string) => button(new RegExp(`^${label} ${planName}`))
const tab = async (name: string) => { await ready(); const item = screen.getByRole('tab', { name }); fireEvent.mouseDown(item); fireEvent.click(item); await wait() }
const limitsTab = () => tab(es.tabs.limits)
const input = (label = 'Workspace quota') => screen.getByRole('textbox', { name: `${label}: valor del límite` }) as HTMLInputElement
const type = (value: string, label?: string) => { const field = input(label); fireEvent.focus(field); fireEvent.change(field, { target: { value } }); return field }

test.each(['es', 'en'] as const)('renders the header, the stepper and the four tabs in %s from the two parallel reads', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  setup({}, active); open()
  expect(await ready()).toBeVisible()
  expect(screen.getAllByText(copy.status.active).length).toBeGreaterThan(1)
  expect(screen.getByText('synthetic-plan')).toBeVisible()
  expect(screen.getAllByRole('tab').map((node) => node.textContent)).toEqual([copy.tabs.info, copy.tabs.capabilities, copy.tabs.limits, copy.tabs.assignments])
  const steps = screen.getByRole('navigation', { name: copy.lifecycle.sequence })
  expect(within(steps).getAllByRole('listitem')).toHaveLength(4)
  expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent(copy.status.active)
  expect(screen.getByText(copy.info.timelineEntry)).toBeVisible()
  expect(within(screen.getByRole('list', { name: copy.info.timeline })).getAllByRole('listitem')).toHaveLength(1)
  expect(count(`GET ${base}`)).toBe(1); expect(count(`GET ${limitsUrl}`)).toBe(1)
  expect(writes()).toEqual([])
  await i18n.changeLanguage('es')
})

test('shows only the allowed transition for each status and disables Eliminar while the plan is active', async () => {
  setup({}, active); open(); await ready()
  expect(lifecycleButton(es.action.deprecate)).toBeEnabled()
  expect(screen.queryByRole('button', { name: new RegExp(`^${es.action.activate}`) })).toBeNull()
  expect(button(new RegExp(`^${es.action.delete} ${planName}`))).toBeDisabled()
  expect(screen.getByText(es.deleteHelpActive)).toBeVisible()
})

test('the info tab lists the status, assignments, update date and one timeline entry; the other tabs follow', async () => {
  setup({}, active); open(); await ready()
  const info = screen.getByRole('tabpanel')
  expect(within(info).getByText('3')).toBeVisible()
  expect(within(info).getByText('Synthetic description')).toBeVisible()
  await tab(es.tabs.capabilities)
  expect(screen.getByRole('list', { name: es.capabilities.list }).querySelectorAll('li')).toHaveLength(2)
  expect(screen.getByLabelText('sso: Habilitada')).toBeVisible(); expect(screen.getByLabelText('audit_export: Bloqueada')).toBeVisible()
  await tab(es.tabs.assignments)
  expect(screen.getByText(`3 organizaciones activas usan este plan.`)).toBeVisible()
  expect(screen.getByRole('link', { name: es.assignments.open })).toHaveAttribute('href', '/console/tenants')
})

test('the empty description, capabilities and limits and the unknown assignment count use their own copy', async () => {
  setup({ [`GET ${limitsUrl}`]: { planId, profile: [] } }, (fixtures.detail['no-description-no-capabilities'] as { body: unknown }).body); open(); await ready()
  expect(screen.getByText(es.info.noDescription)).toBeVisible()
  expect(screen.getAllByText(es.info.unavailable).length).toBeGreaterThan(0)
  expect(screen.getAllByText(es.info.noDate).length).toBeGreaterThan(0)
  await tab(es.tabs.capabilities)
  expect(screen.getByRole('heading', { name: es.capabilities.emptyTitle })).toBeVisible()
  await tab(es.tabs.limits)
  expect(screen.getByRole('heading', { name: es.limits.emptyTitle })).toBeVisible()
  await tab(es.tabs.assignments)
  expect(screen.getByText(es.assignedUnknown)).toBeVisible()
})

test('Activar sends one lifecycle POST without a dialog, reloads only the plan and announces the accepted status', async () => {
  setup({ [`POST ${lifecycleUrl}`]: () => json({ planId, previousStatus: 'draft', newStatus: 'active', transitionedAt: '2026-06-01T12:00:00Z' }) })
  requests = strictFetch({ [`GET ${base}`]: sequence(() => json(draft), () => json(active)), [`GET ${limitsUrl}`]: profile, [`POST ${lifecycleUrl}`]: () => json({ planId, previousStatus: 'draft', newStatus: 'active' }) })
  open(); await ready()
  fireEvent.click(lifecycleButton(es.action.activate))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect((await screen.findAllByText('Synthetic Plan ahora está activo.')).length).toBeGreaterThan(0)
  expect(bodiesOf(`POST ${lifecycleUrl}`)).toEqual([{ targetStatus: 'active' }])
  expect(count(`GET ${base}`)).toBe(2); expect(count(`GET ${limitsUrl}`)).toBe(1)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  expect(lifecycleButton(es.action.deprecate)).toBeVisible()
})

test('Marcar como obsoleto asks first and sends deprecated only after the confirmation', async () => {
  setup({ [`POST ${lifecycleUrl}`]: () => json({ planId, newStatus: 'deprecated' }) }, active); open(); await ready()
  fireEvent.click(lifecycleButton(es.action.deprecate))
  const dialog = await screen.findByRole('alertdialog')
  expect(writes()).toEqual([])
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog.deprecateConfirm }))
  await waitFor(() => expect(bodiesOf(`POST ${lifecycleUrl}`)).toEqual([{ targetStatus: 'deprecated' }]))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
})

test.each(['archive', 'delete'] as const)('%s sends nothing until the typed text equals the plan name', async (kind) => {
  setup({ [`POST ${lifecycleUrl}`]: () => json({ planId, newStatus: 'archived' }), [`DELETE ${base}`]: () => json({ planId, deleted: true }) }, kind === 'archive' ? deprecated : draft); open(); await ready()
  fireEvent.click(kind === 'archive' ? lifecycleButton(es.action.archive) : button(new RegExp(`^${es.action.delete} ${planName}`)))
  const dialog = await screen.findByRole('alertdialog')
  const confirm = within(dialog).getByRole('button', { name: es.dialog[`${kind}Confirm`] })
  expect(confirm).toBeDisabled()
  expect(within(dialog).getByText(es.dialog.typeInstruction.replace('{name}', planName))).toBeVisible()
  const field = within(dialog).getByLabelText(es.dialog.typeLabel)
  fireEvent.change(field, { target: { value: 'synthetic plan' } }); expect(confirm).toBeDisabled(); expect(writes()).toEqual([])
  fireEvent.change(field, { target: { value: planName } }); expect(confirm).toBeEnabled()
  fireEvent.click(confirm)
  await waitFor(() => expect(writes()).toHaveLength(1))
  if (kind === 'archive') expect(bodiesOf(`POST ${lifecycleUrl}`)).toEqual([{ targetStatus: 'archived' }])
  else await waitFor(() => expect(screen.getByRole('heading', { name: 'Catalog' })).toBeVisible())
})

test('the dialog copy, including the instruction, switches to English and the typed token is the plan name', async () => {
  await i18n.changeLanguage('en')
  setup({}, draft); open(); await ready()
  fireEvent.click(button(new RegExp(`^${en.action.delete} ${planName}`)))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText(en.dialog.typeInstruction.replace('{name}', planName))).toBeVisible()
  expect(within(dialog).getByRole('button', { name: en.dialog.cancel })).toBeVisible()
  await i18n.changeLanguage('es')
})

test('a lifecycle 500 shows the error panel with the request id and Reintentar re-sends the identical POST', async () => {
  requests = strictFetch({ [`GET ${base}`]: sequence(() => json(draft), () => json(active)), [`GET ${limitsUrl}`]: profile,
    [`POST ${lifecycleUrl}`]: sequence(() => fail(500, { requestId: 'req_9' }), () => json({ planId, newStatus: 'active' })) })
  open(); await ready()
  fireEvent.click(lifecycleButton(es.action.activate))
  const panel = await screen.findByTestId('mutation-feedback')
  expect(within(panel).getByText('500')).toBeVisible(); expect(within(panel).getByText('req_9')).toBeVisible()
  expect(screen.queryByText('PRIVATE_MARKER')).toBeNull()
  expect(screen.queryByText(/ahora está/)).toBeNull()
  expect(panel).toHaveFocus()
  fireEvent.click(within(panel).getByRole('button', { name: es.retry }))
  expect((await screen.findAllByText('Synthetic Plan ahora está activo.')).length).toBeGreaterThan(0)
  expect(bodiesOf(`POST ${lifecycleUrl}`)).toEqual([{ targetStatus: 'active' }, { targetStatus: 'active' }])
})

test('a lost lifecycle response sends one POST, says the outcome is unknown and re-sends only after Reintentar', async () => {
  setup({ [`POST ${lifecycleUrl}`]: network }); open(); await ready()
  fireEvent.click(lifecycleButton(es.action.activate))
  const panel = await screen.findByTestId('mutation-feedback')
  expect(within(panel).getByText(es.feedback.outcomeUnknown)).toBeVisible()
  expect(screen.queryByText(/ahora está/)).toBeNull(); expect(screen.queryByText('PRIVATE_MARKER network failure')).toBeNull()
  await wait(); await wait()
  expect(count(`POST ${lifecycleUrl}`)).toBe(1)
  // The original trigger stays gated while the outcome is unresolved, so nothing but Reintentar can send it again.
  expect(lifecycleButton(es.action.activate)).toBeDisabled()
  fireEvent.click(lifecycleButton(es.action.activate)); await wait()
  expect(count(`POST ${lifecycleUrl}`)).toBe(1)
})

test('opening and cancelling an unrelated dialog keeps the unresolved lifecycle gate and its Reintentar panel', async () => {
  setup({ [`POST ${lifecycleUrl}`]: network }); open(); await ready()
  fireEvent.click(lifecycleButton(es.action.activate))
  expect(await screen.findByTestId('mutation-feedback')).toBeVisible()
  fireEvent.click(button(new RegExp(`^${es.action.delete}`)))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog.cancel }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(lifecycleButton(es.action.activate)).toBeDisabled()
  fireEvent.click(lifecycleButton(es.action.activate)); await wait()
  expect(count(`POST ${lifecycleUrl}`)).toBe(1)
  expect(within(screen.getByTestId('mutation-feedback')).getByText(es.feedback.outcomeUnknown)).toBeVisible()
  expect(within(screen.getByTestId('mutation-feedback')).getByRole('button', { name: es.retry })).toBeVisible()
})

test('a lost lifecycle response applied by the backend reconciles through Reintentar with a plan-only reload', async () => {
  requests = strictFetch({ [`GET ${base}`]: sequence(() => json(draft), () => json(active)), [`GET ${limitsUrl}`]: profile,
    [`POST ${lifecycleUrl}`]: sequence(network, () => fail(409, { code: 'INVALID_TRANSITION' })) })
  open(); await ready()
  fireEvent.click(lifecycleButton(es.action.activate))
  const panel = await screen.findByTestId('mutation-feedback')
  fireEvent.click(within(panel).getByRole('button', { name: es.retry }))
  await waitFor(() => expect(lifecycleButton(es.action.deprecate)).toBeVisible())
  expect(count(`POST ${lifecycleUrl}`)).toBe(2)
  expect(count(`GET ${limitsUrl}`)).toBe(1)
})

test('a successful lifecycle shows the accepted status even when the reload GET fails', async () => {
  requests = strictFetch({ [`GET ${base}`]: sequence(() => json(draft), () => fail(500)), [`GET ${limitsUrl}`]: profile, [`POST ${lifecycleUrl}`]: () => json({ planId, newStatus: 'active' }) })
  open(); await ready()
  fireEvent.click(lifecycleButton(es.action.activate))
  expect((await screen.findAllByText('Synthetic Plan ahora está activo.')).length).toBeGreaterThan(0)
  expect(screen.queryByTestId('mutation-feedback')).toBeNull()
  expect(lifecycleButton(es.action.deprecate)).toBeVisible()
})

test('a 403 on a mutation renders no-access, keeps the data and disables every mutation control', async () => {
  setup({ [`POST ${lifecycleUrl}`]: () => fail(403, { code: 'FORBIDDEN' }) }); open(); await ready()
  fireEvent.click(lifecycleButton(es.action.activate))
  expect(await screen.findByRole('heading', { name: es.feedback.noAccessTitle })).toBeVisible()
  expect(screen.getByRole('heading', { level: 1, name: planName })).toBeVisible()
  expect(lifecycleButton(es.action.activate)).toBeDisabled()
  expect(button(new RegExp(`^${es.action.delete}`))).toBeDisabled()
  await limitsTab()
  for (const name of ['Guardar límite de Workspace quota', /^Restablecer límite de Workspace quota/]) expect(button(name)).toHaveAttribute(name === 'Guardar límite de Workspace quota' ? 'aria-disabled' : 'disabled')
  expect(input()).toBeDisabled()
  expect(screen.queryByText(/ahora está/)).toBeNull()
  expect(count(`POST ${lifecycleUrl}`)).toBe(1)
})

test('a delete 403 shows no-access inside the dialog with confirm disabled and only Cerrar', async () => {
  setup({ [`DELETE ${base}`]: () => fail(403) }); open(); await ready()
  fireEvent.click(button(new RegExp(`^${es.action.delete}`)))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.change(within(dialog).getByLabelText(es.dialog.typeLabel), { target: { value: planName } })
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog.deleteConfirm }))
  expect(await within(dialog).findByRole('heading', { name: es.feedback.noAccessTitle })).toBeVisible()
  expect(within(dialog).getByRole('button', { name: es.dialog.deleteConfirm })).toBeDisabled()
  expect(within(dialog).getByRole('button', { name: es.dialog.close })).toBeVisible()
  expect(within(dialog).queryByRole('button', { name: es.retry })).toBeNull()
})

test('a delete network failure keeps the dialog and typed name, Reintentar re-sends DELETE and a 404 re-send shows not-found', async () => {
  setup({ [`DELETE ${base}`]: sequence(network, () => fail(404)) }); open(); await ready()
  fireEvent.click(button(new RegExp(`^${es.action.delete}`)))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.change(within(dialog).getByLabelText(es.dialog.typeLabel), { target: { value: planName } })
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog.deleteConfirm }))
  fireEvent.click(await within(dialog).findByRole('button', { name: es.retry }))
  expect(await within(dialog).findByRole('heading', { name: es.feedback.notFoundTitle })).toBeVisible()
  expect(within(dialog).getByLabelText(es.dialog.typeLabel)).toHaveValue(planName)
  expect(count(`DELETE ${base}`)).toBe(2)
})

test('closing the dialog discards the retry and reopening it clears the typed name', async () => {
  setup({ [`DELETE ${base}`]: () => fail(500) }); open(); await ready()
  const trigger = button(new RegExp(`^${es.action.delete}`))
  fireEvent.click(trigger)
  let dialog = await screen.findByRole('alertdialog')
  fireEvent.change(within(dialog).getByLabelText(es.dialog.typeLabel), { target: { value: planName } })
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog.deleteConfirm }))
  await within(dialog).findByRole('button', { name: es.retry })
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog.close }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(screen.queryByTestId('mutation-feedback')).toBeNull()
  fireEvent.click(button(new RegExp(`^${es.action.delete}`)))
  dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByLabelText(es.dialog.typeLabel)).toHaveValue('')
  expect(within(dialog).getByRole('button', { name: es.dialog.deleteConfirm })).toBeDisabled()
  expect(count(`DELETE ${base}`)).toBe(1)
})

test('a known business code shows localized copy without a retry and an unknown code never shows the transport message', async () => {
  setup({ [`DELETE ${base}`]: () => fail(409, { code: 'PLAN_HAS_ASSIGNMENT_HISTORY' }) }); open(); await ready()
  fireEvent.click(button(new RegExp(`^${es.action.delete}`)))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.change(within(dialog).getByLabelText(es.dialog.typeLabel), { target: { value: planName } })
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog.deleteConfirm }))
  expect(await within(dialog).findByText(es.feedback.code.PLAN_HAS_ASSIGNMENT_HISTORY)).toBeVisible()
  expect(within(dialog).queryByRole('button', { name: es.retry })).toBeNull()
})

test('an unknown 500 code shows the code with the generic copy and never PRIVATE_MARKER', async () => {
  setup({ [`POST ${lifecycleUrl}`]: () => fail(500, { code: 'PLAN_SYNTHETIC_FAILURE' }) }); open(); await ready()
  fireEvent.click(lifecycleButton(es.action.activate))
  const panel = await screen.findByTestId('mutation-feedback')
  expect(within(panel).getByText('Código PLAN_SYNTHETIC_FAILURE: la solicitud no se pudo completar.')).toBeVisible()
  expect(document.body.textContent).not.toContain('PRIVATE_MARKER')
})

test('Enter on a valid changed limit sends one PUT {value}; unchanged, invalid, Escape, blur and focus send nothing', async () => {
  setup({ [`PUT ${limitUrl}`]: () => json({ planId, dimensionKey: limitKey, newValue: 500, source: 'explicit' }) })
  requests = strictFetch({ [`GET ${base}`]: draft, [`GET ${limitsUrl}`]: sequence(() => json(profile), () => json({ planId, profile: limitRows.map((row) => row.dimensionKey === limitKey ? { ...row, effectiveValue: 500 } : row) })),
    [`PUT ${limitUrl}`]: () => json({ planId, dimensionKey: limitKey, newValue: 500, source: 'explicit' }) })
  open(); await limitsTab()
  const field = input()
  expect(field).not.toHaveAttribute('min')
  fireEvent.keyDown(field, { key: 'Enter' })
  type('5'); fireEvent.keyDown(input(), { key: 'Enter' })
  type(''); expect(screen.getByText(es.limits.required)).toBeVisible(); fireEvent.keyDown(input(), { key: 'Enter' })
  type('-2'); expect(screen.getByText(es.limits.invalid)).toBeVisible(); fireEvent.keyDown(input(), { key: 'Enter' })
  type('1.5'); expect(screen.getByText(es.limits.invalid)).toBeVisible(); fireEvent.keyDown(input(), { key: 'Enter' })
  type('9'); fireEvent.keyDown(input(), { key: 'Escape' }); expect(input()).toHaveValue('5')
  type('9'); fireEvent.blur(input()); fireEvent.focus(input())
  expect(writes()).toEqual([])
  type('500'); fireEvent.keyDown(input(), { key: 'Enter' })
  await waitFor(() => expect(screen.getByText(es.limits.savedTitle)).toBeVisible())
  expect(bodiesOf(`PUT ${limitUrl}`)).toEqual([{ value: 500 }])
  expect(count(`GET ${limitsUrl}`)).toBe(2)
  expect(input()).toHaveValue('500')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar límite de Workspace quota' })).toHaveFocus())
})

test.each([['-', 'required'], ['1-', 'invalid'], ['-.', 'required']] as const)('incomplete text %s in the limit field sends nothing, not the last parsed number', async (text, message) => {
  setup({ [`PUT ${limitUrl}`]: () => json({ planId, dimensionKey: limitKey, newValue: 9, source: 'explicit' }) }); open(); await limitsTab()
  type('9'); expect(screen.queryByText(es.limits.required)).toBeNull()
  const field = type(text)
  expect(field).toHaveValue(text)
  expect(screen.getByText(es.limits[message])).toBeVisible()
  fireEvent.keyDown(field, { key: 'Enter' })
  fireEvent.click(button('Guardar límite de Workspace quota'))
  expect(writes()).toEqual([])
  type('9'); expect(screen.queryByText(es.limits[message])).toBeNull()
  fireEvent.keyDown(input(), { key: 'Enter' })
  await waitFor(() => expect(bodiesOf(`PUT ${limitUrl}`)).toEqual([{ value: 9 }]))
})

const paste = (text: string) => {
  const field = input(); fireEvent.focus(field); field.setSelectionRange(0, field.value.length)
  fireEvent.paste(field, { clipboardData: { getData: () => text } })
  return field
}

test.each([['1-', 'invalid'], ['9..0', 'invalid'], ['1.2.3', 'invalid'], ['12abc', 'invalid'], ['1,5', 'invalid'], ['1.5', 'invalid'], ['1,500', 'invalid'], ['1.500', 'invalid']] as const)('pasting malformed text %s sends nothing, not the number the field parsed', async (text, message) => {
  setup({ [`PUT ${limitUrl}`]: () => json({ planId, dimensionKey: limitKey, newValue: 9, source: 'explicit' }) }); open(); await limitsTab()
  const field = paste(text)
  await waitFor(() => expect(screen.getByText(es.limits[message])).toBeVisible())
  expect(field).toHaveValue(text)
  fireEvent.keyDown(field, { key: 'Enter' })
  fireEvent.click(button('Guardar límite de Workspace quota'))
  expect(writes()).toEqual([])
})

test.each(['en-US', 'es-ES'])('typing 1,5 with the UI in es and the browser number locale %s sends nothing, not 15', async (browser) => {
  const spy = vi.spyOn(navigator, 'language', 'get').mockReturnValue(browser)
  try {
    setup({ [`PUT ${limitUrl}`]: () => json({ planId, dimensionKey: limitKey, newValue: 15, source: 'explicit' }) }); open(); await limitsTab()
    const field = type('1,5')
    expect(field).toHaveValue('1,5')
    expect(screen.getByText(es.limits.invalid)).toBeVisible()
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.click(button('Guardar límite de Workspace quota'))
    expect(writes()).toEqual([])
  } finally { spy.mockRestore() }
})

test('pasting a clean number sends it once on Enter', async () => {
  setup({ [`PUT ${limitUrl}`]: () => json({ planId, dimensionKey: limitKey, newValue: 500, source: 'explicit' }) }); open(); await limitsTab()
  const field = paste('500'); expect(field).toHaveValue('500')
  fireEvent.keyDown(field, { key: 'Enter' })
  await waitFor(() => expect(bodiesOf(`PUT ${limitUrl}`)).toEqual([{ value: 500 }]))
})

test('-1 is accepted as unlimited and Guardar sends it', async () => {
  setup({ [`PUT ${limitUrl}`]: () => json({ planId, dimensionKey: limitKey, newValue: -1, source: 'explicit' }) }); open(); await limitsTab()
  type('-1'); fireEvent.click(button('Guardar límite de Workspace quota'))
  await waitFor(() => expect(bodiesOf(`PUT ${limitUrl}`)).toEqual([{ value: -1 }]))
})

test('after a limit save succeeds and the limits reload returns 500 the row shows the accepted value and Guardado', async () => {
  requests = strictFetch({ [`GET ${base}`]: draft, [`GET ${limitsUrl}`]: sequence(() => json(profile), () => fail(500)), [`PUT ${limitUrl}`]: () => json({ planId, dimensionKey: limitKey, newValue: 500, source: 'explicit' }) })
  open(); await limitsTab()
  type('500'); fireEvent.click(button('Guardar límite de Workspace quota'))
  await waitFor(() => expect(screen.getByText(es.limits.rowSaved)).toBeVisible())
  expect(input()).toHaveValue('500'); expect(screen.queryByTestId('mutation-feedback')).toBeNull()
})

test('a failed save restores the row, names the attempted value and Reintentar re-sends the same value', async () => {
  requests = strictFetch({ [`GET ${base}`]: draft, [`GET ${limitsUrl}`]: profile, [`PUT ${limitUrl}`]: sequence(() => fail(500, { requestId: 'req_5' }), () => json({ planId, dimensionKey: limitKey, newValue: 500, source: 'explicit' })) })
  open(); await limitsTab()
  type('500'); fireEvent.click(button('Guardar límite de Workspace quota'))
  const panel = await screen.findByTestId('mutation-feedback')
  expect(input()).toHaveValue('5'); expect(screen.getByText(es.limits.rowFailed)).toBeVisible()
  expect(within(panel).getByText('Valor intentado para max_workspaces: 500.')).toBeVisible()
  fireEvent.click(within(panel).getByRole('button', { name: es.retry }))
  await waitFor(() => expect(screen.getByText(es.limits.rowSaved)).toBeVisible())
  expect(bodiesOf(`PUT ${limitUrl}`)).toEqual([{ value: 500 }, { value: 500 }])
})

test.each([['INVALID_LIMIT_VALUE', 400], ['PLAN_LIMITS_FROZEN', 409]])('%s restores the row and shows the localized callout without retry', async (code, status) => {
  setup({ [`PUT ${limitUrl}`]: () => fail(status, { code }) }); open(); await limitsTab()
  type('500'); fireEvent.click(button('Guardar límite de Workspace quota'))
  expect(await screen.findByText(es.feedback.code[code as 'PLAN_LIMITS_FROZEN'])).toBeVisible()
  expect(input()).toHaveValue('5'); expect(screen.queryByRole('button', { name: es.retry })).toBeNull()
})

test('Restablecer asks first, sends DELETE of the limit and reconciles; a network failure keeps the dialog for a retry', async () => {
  requests = strictFetch({ [`GET ${base}`]: draft, [`GET ${limitsUrl}`]: profile, [`DELETE ${limitUrl}`]: sequence(network, () => json({ planId, dimensionKey: limitKey, effectiveValue: 10, source: 'default' })) })
  open(); await limitsTab()
  fireEvent.click(button(/^Restablecer límite de Workspace quota/))
  const dialog = await screen.findByRole('alertdialog')
  expect(writes()).toEqual([])
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog.resetConfirm }))
  fireEvent.click(await within(dialog).findByRole('button', { name: es.retry }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(count(`DELETE ${limitUrl}`)).toBe(2)
  expect(screen.getByText(es.limits.rowReset)).toBeVisible()
  await waitFor(() => expect(document.querySelector('[data-reset-key="max_workspaces"]')).toHaveFocus())
})

test('deprecated and archived plans expose no limit-mutation control and show the value or Sin límite', async () => {
  setup({}, deprecated); open(); await limitsTab()
  expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByRole('button', { name: /Guardar|Restablecer/ })).toBeNull()
  expect(screen.getByText(es.limits.unlimited, { selector: 'span.tabular-nums' })).toBeVisible()
  expect(lifecycleButton(es.action.archive)).toBeVisible()
})

test('an archived plan has no lifecycle action and Eliminar stays visible', async () => {
  setup({}, archived); open(); await ready()
  expect(screen.queryByRole('button', { name: new RegExp(`^(${es.action.activate}|${es.action.deprecate}|${es.action.archive})`) })).toBeNull()
  expect(button(new RegExp(`^${es.action.delete}`))).toBeEnabled()
  expect(screen.getByText(es.lifecycle.guidance.archived)).toBeVisible()
})

test.each([[403, es.load.noAccessTitle], [404, es.load.notFoundTitle]])('a load %s renders its in-page state without a request-access action', async (status, title) => {
  requests = strictFetch({ [`GET ${base}`]: () => fail(status), [`GET ${limitsUrl}`]: profile }); open()
  expect(await screen.findByRole('heading', { level: 2, name: title })).toBeVisible()
  expect(screen.queryByRole('button', { name: /acceso|access/i })).toBeNull()
  if (status === 404) expect(screen.getByRole('link', { name: es.back })).toHaveAttribute('href', '/console/plans')
})

test.each(['plan', 'limits'])('a failing %s read renders the load error panel and Reintentar re-sends both reads, then focuses the h1', async (which) => {
  const first = () => fail(500, { requestId: 'req_load' })
  requests = strictFetch({ [`GET ${base}`]: which === 'plan' ? sequence(first, () => json(draft)) : draft, [`GET ${limitsUrl}`]: which === 'limits' ? sequence(first, () => json(profile)) : profile })
  open()
  const panel = await screen.findByRole('heading', { level: 2, name: es.load.errorTitle })
  expect(panel).toBeVisible(); expect(screen.getByText('req_load')).toBeVisible()
  expect(screen.queryByRole('tab')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: es.retry }))
  expect(await ready()).toHaveFocus()
  expect(count(`GET ${base}`)).toBe(2); expect(count(`GET ${limitsUrl}`)).toBe(2)
})

test('a load network failure shows the error panel with no stale plan', async () => {
  requests = strictFetch({ [`GET ${base}`]: network, [`GET ${limitsUrl}`]: profile }); open()
  expect(await screen.findByText(es.load.networkMessage)).toBeVisible()
  expect(screen.queryByRole('heading', { name: planName })).toBeNull()
  expect(document.body.textContent).not.toContain('PRIVATE_MARKER')
})

test('an expired session on the lifecycle POST refreshes once and never replays the write', async () => {
  const session = login()
  const refreshed = { ...buildConsoleRefreshSessionFixture(), sessionId: session.sessionId }
  requests = strictFetch({ [`GET ${base}`]: draft, [`GET ${limitsUrl}`]: profile, [`POST ${lifecycleUrl}`]: () => fail(401, { code: 'UNAUTHORIZED' }), [`POST ${refreshUrl}`]: refreshed })
  renderWithSession(<Routes><Route path="/console/plans/:planId" element={<LiveAnnouncer><ConsolePlanDetailPage /></LiveAnnouncer>} /></Routes>, { route: `/console/plans/${planId}` })
  await ready()
  fireEvent.click(lifecycleButton(es.action.activate))
  await waitFor(() => expect(count(`POST ${refreshUrl}`)).toBe(1))
  await wait(); await wait()
  expect(count(`POST ${lifecycleUrl}`)).toBe(1)
  expect(screen.queryByText(/ahora está/)).toBeNull()
  void buildConsoleSignupPolicyFixture
})

test('the typed gate, the retry and the 5xx copy never render transport text', async () => {
  setup({ [`DELETE ${base}`]: () => fail(500, { message: 'PRIVATE_MARKER' }) }); open(); await ready()
  fireEvent.click(button(new RegExp(`^${es.action.delete}`)))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.change(within(dialog).getByLabelText(es.dialog.typeLabel), { target: { value: planName } })
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog.deleteConfirm }))
  await within(dialog).findByRole('button', { name: es.retry })
  expect(document.body.textContent).not.toContain('PRIVATE_MARKER')
})

test.each([['delete', 'DELETE', base, draft], ['archive', 'POST', lifecycleUrl, deprecated]] as const)('a %s retry needs the typed plan name again: a cleared field removes Reintentar until the name matches', async (kind, method, url, record) => {
  const retried = kind === 'delete' ? json({ planId, deleted: true }) : json({ planId, newStatus: 'archived' })
  requests = strictFetch({ [`GET ${base}`]: record, [`GET ${limitsUrl}`]: profile, [`${method} ${url}`]: sequence(network, () => retried) })
  open(); await ready()
  fireEvent.click(kind === 'delete' ? button(new RegExp(`^${es.action.delete}`)) : lifecycleButton(es.action.archive))
  const dialog = await screen.findByRole('alertdialog')
  const field = within(dialog).getByLabelText(es.dialog.typeLabel)
  fireEvent.change(field, { target: { value: planName } })
  fireEvent.click(within(dialog).getByRole('button', { name: es.dialog[`${kind}Confirm` as 'deleteConfirm'] }))
  await within(dialog).findByRole('button', { name: es.retry })
  fireEvent.change(field, { target: { value: '' } })
  expect(within(dialog).queryByRole('button', { name: es.retry })).toBeNull()
  fireEvent.change(field, { target: { value: `${planName}x` } })
  expect(within(dialog).queryByRole('button', { name: es.retry })).toBeNull()
  expect(count(`${method} ${url}`)).toBe(1)
  fireEvent.change(field, { target: { value: planName } })
  fireEvent.click(within(dialog).getByRole('button', { name: es.retry }))
  await waitFor(() => expect(count(`${method} ${url}`)).toBe(2))
})

test('a lifecycle retry rejected as an invalid transition reloads only the plan so the header is not stale', async () => {
  requests = strictFetch({ [`GET ${base}`]: sequence(() => json(draft), () => json(active)), [`GET ${limitsUrl}`]: profile,
    [`POST ${lifecycleUrl}`]: sequence(network, () => fail(409, { code: 'INVALID_TRANSITION' })) })
  open(); await ready()
  fireEvent.click(lifecycleButton(es.action.activate))
  fireEvent.click(within(await screen.findByTestId('mutation-feedback')).getByRole('button', { name: es.retry }))
  expect(await screen.findByText(es.feedback.code.INVALID_TRANSITION)).toBeVisible()
  await waitFor(() => expect(lifecycleButton(es.action.deprecate)).toBeVisible())
  expect(count(`POST ${lifecycleUrl}`)).toBe(2); expect(count(`GET ${base}`)).toBe(2); expect(count(`GET ${limitsUrl}`)).toBe(1)
  expect(screen.queryByText(/ahora está/)).toBeNull()
})

test.each(['save', 'reset'] as const)('a failed limit %s reloads the limits profile once before it reports the failure', async (kind) => {
  const method = kind === 'save' ? 'PUT' : 'DELETE'
  requests = strictFetch({ [`GET ${base}`]: draft, [`GET ${limitsUrl}`]: profile, [`${method} ${limitUrl}`]: () => fail(500) })
  open(); await limitsTab()
  if (kind === 'save') { type('500'); fireEvent.click(button('Guardar límite de Workspace quota')) }
  else { fireEvent.click(button(/^Restablecer límite de Workspace quota/)); fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: es.dialog.resetConfirm })) }
  await screen.findByTestId('mutation-feedback')
  expect(count(`GET ${limitsUrl}`)).toBe(2); expect(count(`${method} ${limitUrl}`)).toBe(1)
  expect(screen.getByText(es.limits[kind === 'save' ? 'rowFailed' : 'rowResetFailed' as 'rowFailed'])).toBeVisible()
})

test('a failed Activar renders its error panel once, whichever tab is open', async () => {
  setup({ [`POST ${lifecycleUrl}`]: () => fail(500) }); open(); await ready()
  fireEvent.click(lifecycleButton(es.action.activate))
  await screen.findByTestId('mutation-feedback')
  await limitsTab()
  expect(screen.getAllByTestId('mutation-feedback')).toHaveLength(1)
})

test('a refused limit save shows no-access once above the tabs and keeps it visible on every tab', async () => {
  setup({ [`PUT ${limitUrl}`]: () => fail(403) }); open(); await limitsTab()
  type('500'); fireEvent.click(button('Guardar límite de Workspace quota'))
  expect(await screen.findByRole('heading', { name: es.feedback.noAccessTitle })).toBeVisible()
  for (const name of [es.tabs.limits, es.tabs.info, es.tabs.assignments]) {
    await tab(name)
    expect(screen.getAllByRole('heading', { name: es.feedback.noAccessTitle })).toHaveLength(1)
  }
})

test('a load failure moves focus to the error panel and a successful Reintentar moves it to the h1', async () => {
  requests = strictFetch({ [`GET ${base}`]: sequence(() => fail(500), () => json(draft)), [`GET ${limitsUrl}`]: profile })
  open()
  await screen.findByRole('heading', { level: 2, name: es.load.errorTitle })
  await waitFor(() => expect(screen.getByTestId('load-error')).toHaveFocus())
  fireEvent.click(screen.getByRole('button', { name: es.retry }))
  expect(await ready()).toHaveFocus()
})

test('while loading, the header and the body are skeletons behind one labelled status, then the page replaces them', async () => {
  let release: (response: Response) => void = () => {}
  requests = strictFetch({ [`GET ${base}`]: draft, [`GET ${limitsUrl}`]: () => new Promise<Response>((resolve) => { release = resolve }) })
  open()
  expect(await screen.findByRole('status', { name: es.load.loading })).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByTestId('header-skeleton')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  await act(async () => { release(json(profile)) })
  expect(await ready()).toBeVisible()
  expect(screen.queryByTestId('header-skeleton')).toBeNull()
})
