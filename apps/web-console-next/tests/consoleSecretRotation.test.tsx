import { Fragment, StrictMode } from 'react'
import { LiveAnnouncer } from '@gntik-ai/ui'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getSecretConsumerStatus, initiateSecretRotation, listSecretRotationHistory, parseRotationSecretPath } from '../src/pages/consoleSecretRotation/api'
import { readProtectedRouteIntent } from '@in-falcone/console-api/session'
import ConsoleSecretRotationPage from '../src/pages/consoleSecretRotation'
import { ProtectedRoute } from '../src/shell/session'
import { login, strictFetch } from './shell-support'
import { base, confirmed, failure, history, mixed, nonterminal, pending, rotationResult, route, secretPath, syntheticValue, timedOut } from './parity/pages/console-secret-rotation-page.manifest'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-secret-rotation-page.json'
import en from '../src/locales/en/pages.console-secret-rotation-page.json'

let requests: ReturnType<typeof strictFetch>
const historyUrl = `${base}/history?limit=20&offset=0`
const setup = (routes: Record<string, unknown> = {}) => {
  requests = strictFetch({ [`GET ${historyUrl}`]: history, [`GET ${base}/consumer-status`]: mixed, [`POST ${base}/rotate`]: rotationResult, ...routes })
}
const calls = () => requests.mock.mock.calls.map(([path, init]) => ({ method: init?.method ?? 'GET', path: String(path), body: init?.body ? JSON.parse(String(init.body)) : undefined }))
const writes = () => calls().filter(({ method }) => method === 'POST')
const reads = () => calls().filter(({ path }) => path.endsWith('/consumer-status'))
const localizedTime = (value: string, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
function open(path = route, protect = false, shellAnnouncer = false) {
  const Announcer = shellAnnouncer ? LiveAnnouncer : Fragment
  const page = <ConsoleSecretRotationPage />
  return render(<StrictMode><Announcer><MemoryRouter initialEntries={[path]}><Routes><Route path="/console/secrets/:encodedSecretPath/rotate" element={protect ? <ProtectedRoute>{page}</ProtectedRoute> : page} /><Route path="/login" element={<div data-testid="login" />} /></Routes></MemoryRouter></Announcer></StrictMode>)
}
const ready = () => screen.findByRole('table', { name: es.historyTitle })
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const submit = () => fireEvent.click(screen.getByRole('button', { name: es.submit }))
const confirm = async () => {
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.change(within(dialog).getByRole('textbox', { name: es.typedPath }), { target: { value: secretPath } })
  fireEvent.click(within(dialog).getByRole('button', { name: es.confirm }))
}
const errorResponse = (status: number, requestId?: string) => () => Response.json(failure(status, requestId).body, { status })
async function flush() { await act(async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }) }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }); await flush() }
beforeEach(() => { login(); vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => requests?.verify())

test.each(['es', 'en'] as const)('ports legacy consumer rendering and token panels with translated data in %s', async (locale) => {
  await i18n.changeLanguage(locale); setup(); open()
  const c = locale === 'es' ? es : en
  const table = await screen.findByRole('table', { name: c.historyTitle })
  expect(screen.getByRole('heading', { name: c.title, level: 1 })).toBeVisible()
  expect(screen.getByText(secretPath)).toBeVisible()
  expect(within(table).getByText('initiated')).toBeVisible(); expect(within(table).getByText('completed')).toBeVisible()
  expect(within(table).getAllByText(c.missing)).toHaveLength(5); expect(table.querySelectorAll('time')).toHaveLength(2)
  expect(await screen.findByText('synthetic-apisix')).toBeVisible()
  for (const label of Object.values(c.states).slice(0, 3)) expect(screen.getByText(label)).toBeVisible()
  expect(document.body.innerHTML).not.toMatch(/bg-white|bg-slate-\d|text-slate-\d/)
  expect(screen.getByRole('slider', { name: c.sliderName })).toHaveAttribute('aria-valuenow', '1800')
  expect(screen.getByRole('spinbutton', { name: c.inputName })).toHaveValue(1800)
  expect(screen.queryByRole('navigation', { name: c.pagination })).toBeNull()
  expect(calls()).toEqual([{ method: 'GET', path: historyUrl, body: undefined }, { method: 'GET', path: `${base}/consumer-status`, body: undefined }])
})
test.each(['es', 'en'] as const)('shows failed consumers with a destructive translated label and preserves other states while polling in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const c = locale === 'es' ? es : en
  vi.useFakeTimers()
  setup({ [`GET ${base}/consumer-status`]: nonterminal }); const view = open(); await flush()
  const table = screen.getByRole('table', { name: c.consumersTitle })
  expect(within(table).getByText(c.states.failed)).toHaveAttribute('data-status', 'failed')
  expect(within(table).getByText(c.states.failed).querySelector('[aria-hidden="true"]')).toHaveClass('bg-destructive')
  for (const state of ['reloading', 'unknown']) expect(within(table).getByText(state, { exact: true })).toBeVisible()
  expect(reads()).toHaveLength(1); await advance(5000); expect(reads()).toHaveLength(2)
  view.unmount(); await advance(10000); expect(reads()).toHaveLength(2)
})
test.each(['es', 'en'] as const)('ports legacy submit with exact body, preserved masked fields and localized feedback in %s', async (locale) => {
  setup(); open(); await ready(); change(es.inputName, '900'); change(es.justification, 'planned rotation'); change(es.newValue, syntheticValue)
  submit(); const dialog = await screen.findByRole('alertdialog'); expect(within(dialog).getByRole('button', { name: es.confirm })).toBeDisabled(); expect(dialog.textContent).not.toContain(syntheticValue)
  // Use the active locale at confirmation, including after a language change.
  await act(async () => { await i18n.changeLanguage(locale) })
  const c = locale === 'es' ? es : en
  fireEvent.change(within(dialog).getByRole('textbox', { name: c.typedPath }), { target: { value: secretPath } })
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()).toEqual([{ method: 'POST', path: `${base}/rotate`, body: { gracePeriodSeconds: 900, justification: 'planned rotation', newValue: syntheticValue } }])
  expect(screen.getByLabelText(c.inputName)).toHaveValue(900); expect(screen.getByLabelText(c.justification)).toHaveValue('planned rotation')
  expect(screen.getByLabelText(c.newValue)).toHaveValue(syntheticValue); expect(screen.getByLabelText(c.newValue)).toHaveAttribute('type', 'password')
  const message = i18n.t('success', { ns: 'pages.console-secret-rotation-page', version: rotationResult.vaultVersionNew, expiry: localizedTime(rotationResult.graceExpiresAt, locale) })
  await waitFor(() => expect(screen.getByRole('region', { name: c.notifications })).toHaveTextContent(message))
  expect(document.querySelector('[data-live-announcer="polite"]')).toHaveTextContent(message)
  expect(document.body.textContent).not.toContain(rotationResult.graceExpiresAt)
  expect(document.body.textContent).not.toContain(syntheticValue); expect(screen.getByRole('button', { name: c.submit })).toBeEnabled()
})
test.each(['success', 'failure'] as const)('uses the shell announcer once for rotation %s', async (outcome) => {
  setup(outcome === 'failure' ? { [`POST ${base}/rotate`]: errorResponse(500) } : {})
  open(route, false, true); await ready()
  expect(document.querySelectorAll('[data-live-announcer="polite"]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-live-announcer="assertive"]')).toHaveLength(1)
  submit(); await confirm()
  const region = document.querySelector(`[data-live-announcer="${outcome === 'success' ? 'polite' : 'assertive'}"]`)
  const message = outcome === 'success'
    ? i18n.t('success', { ns: 'pages.console-secret-rotation-page', version: rotationResult.vaultVersionNew, expiry: localizedTime(rotationResult.graceExpiresAt, 'es') })
    : es.submitFailure.replace('{message}', 'synthetic-rotation-error')
  await waitFor(() => expect(region).toHaveTextContent(message))
  expect(writes()).toHaveLength(1)
})
test.each([120, 0, 90000])('sends unclamped %i with an empty required justification and clamps only the slider', async (value) => {
  setup(); open(); await ready(); change(es.inputName, value === 0 ? '' : String(value))
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', String(Math.max(300, Math.min(86400, value))))
  expect(screen.getByLabelText(es.inputName)).toHaveValue(value); expect(screen.getByLabelText(es.justification)).toBeRequired()
  expect(screen.getByLabelText(es.justification)).not.toHaveAttribute('aria-required'); expect(document.querySelector('form')).toHaveAttribute('novalidate')
  submit(); await confirm(); await waitFor(() => expect(writes()).toHaveLength(1)); expect(writes()[0].body).toEqual({ gracePeriodSeconds: value, justification: '', newValue: '' })
})
test('Descartar resets locally and cancel or Escape sends nothing and restores focus', async () => {
  setup(); open(); await ready(); change(es.inputName, '3600'); change(es.justification, 'synthetic reason'); change(es.newValue, syntheticValue)
  fireEvent.click(screen.getByRole('button', { name: es.discard }))
  expect(screen.getByLabelText(es.inputName)).toHaveValue(1800); expect(screen.getByLabelText(es.justification)).toHaveValue(''); expect(screen.getByLabelText(es.newValue)).toHaveValue('')
  submit(); fireEvent.click(await screen.findByRole('button', { name: es.cancel })); await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(screen.getByRole('button', { name: es.submit })).toHaveFocus()
  submit(); await screen.findByRole('alertdialog'); fireEvent.keyDown(document.activeElement!, { key: 'Escape', code: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull()); expect(screen.getByRole('button', { name: es.submit })).toHaveFocus(); expect(writes()).toEqual([])
})
test.each(['es', 'en'] as const)('exposes confirmation as modal with focus inside and translated saving copy in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const c = locale === 'es' ? es : en
  let release!: () => void
  setup({ [`POST ${base}/rotate`]: () => new Promise<Response>((resolve) => { release = () => resolve(Response.json(rotationResult)) }) })
  open(); await screen.findByRole('table', { name: c.historyTitle })
  const trigger = screen.getByRole('button', { name: c.submit })
  trigger.focus(); fireEvent.click(trigger)
  const dialog = await screen.findByRole('alertdialog', { name: c.confirmTitle })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  await waitFor(() => expect(within(dialog).getByRole('textbox', { name: c.typedPath })).toHaveFocus())
  fireEvent.change(within(dialog).getByRole('textbox', { name: c.typedPath }), { target: { value: secretPath } })
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(screen.getByText(c.saving, { exact: true })).toBeVisible()
  expect(trigger).toBeDisabled(); expect(screen.getByRole('button', { name: c.discard })).toBeDisabled()
  release(); await waitFor(() => expect(trigger).toBeEnabled())
})
test.each(['sample-encodedSecretPath', 'platform%2Fpostgresql%2Fapp-password', 'bad%25E0%25A4'])('invalid route %s mounts no form, requests or poller', async (path) => {
  vi.useFakeTimers(); setup(); open(`/console/secrets/${path}/rotate`); await flush(); await advance(60000)
  expect(screen.getByRole('heading', { level: 1, name: es.title })).toBeVisible(); expect(screen.getByRole('heading', { name: es.notFound })).toBeVisible()
  expect(screen.getByRole('link', { name: es.back })).toHaveAttribute('href', '/console/secrets'); expect(document.querySelector('form')).toBeNull(); expect(calls()).toEqual([])
})
test.each(['tenant_viewer', 'workspace_viewer', 'superadmin'])('server authorizes %s without an extra page guard', async (role) => {
  login([role]); setup(); open(); await ready(); expect(screen.getByRole('button', { name: es.submit })).toBeEnabled()
})
test('session adapter preserves legacy tenant parsing and rejects invalid paths before transport', async () => {
  setup({ 'GET /v1/platform/secrets/tenant/db-password/consumer-status': mixed, 'GET /v1/platform/secrets/tenant/db-password/history?limit=20&offset=20': history, 'POST /v1/platform/secrets/tenant/db-password/rotate': rotationResult })
  expect(parseRotationSecretPath('tenant/synthetic-tenant/db-password')).toEqual({ domain: 'tenant', secretName: 'db-password' })
  expect(() => parseRotationSecretPath('platform/postgresql/app-password')).toThrow('INVALID_SECRET_PATH')
  await getSecretConsumerStatus('tenant/synthetic-tenant/db-password'); await listSecretRotationHistory('tenant/synthetic-tenant/db-password', { offset: 20 })
  await initiateSecretRotation('tenant/synthetic-tenant/db-password', { gracePeriodSeconds: 0, justification: '', newValue: syntheticValue })
  expect(calls().map(({ path }) => path)).toEqual(['/v1/platform/secrets/tenant/db-password/consumer-status', '/v1/platform/secrets/tenant/db-password/history?limit=20&offset=20', '/v1/platform/secrets/tenant/db-password/rotate'])
})
test('history page retry keeps its offset, clears old rows and does not poll consumers', async () => {
  let attempt = 0
  setup({ [`GET ${historyUrl}`]: { ...history, total: 45 }, [`GET ${base}/history?limit=20&offset=20`]: () => ++attempt === 1 ? Response.json(failure(500).body, { status: 500 }) : Response.json({ items: [{ eventType: 'synthetic-page-two' }], total: 45 }) })
  open(); await ready(); fireEvent.click(screen.getByRole('button', { name: es.next })); const section = screen.getByTestId('rotation-history')
  await within(section).findByRole('heading', { name: es.historyError }); expect(within(section).queryByRole('table')).toBeNull(); expect(section.textContent).toContain('req_synthetic_rotation')
  const count = reads().length; fireEvent.click(within(section).getByRole('button', { name: es.retry })); await within(section).findByText('synthetic-page-two')
  expect(reads()).toHaveLength(count); expect(calls().filter(({ path }) => path.endsWith('offset=20'))).toHaveLength(2)
})
test.each([403, 404, 500, 'network'] as const)('shows read %s states independently', async (status) => {
  const response = status === 'network' ? () => { throw new TypeError('synthetic network') } : errorResponse(status)
  setup({ [`GET ${historyUrl}`]: response, [`GET ${base}/consumer-status`]: response }); open()
  const heading = status === 403 ? es.noAccess : status === 404 ? es.notFound : es.historyError
  await within(screen.getByTestId('rotation-history')).findByRole('heading', { name: heading })
  if (status === 404) expect(screen.getAllByRole('link', { name: es.back })).toHaveLength(2)
  expect(screen.queryByRole('table')).toBeNull(); expect(screen.getByRole('button', { name: es.submit })).toBeEnabled()
})
test('shows empty and initial skeleton states without kit sample rows', async () => {
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve })
  setup({ [`GET ${historyUrl}`]: async () => { await held; return Response.json({ items: [], total: 0 }) }, [`GET ${base}/consumer-status`]: async () => { await held; return Response.json({ consumers: [] }) } })
  open(); expect(screen.getAllByRole('status', { name: es.loading })).toHaveLength(2); release()
  await screen.findByRole('heading', { name: es.historyEmpty }); await screen.findByRole('heading', { name: es.consumersEmpty }); expect(screen.queryByRole('table')).toBeNull()
})
test.each([400, 403, 404, 500, 503, 'network'] as const)('submit %s focuses summary, redacts echoes and requires a new confirmation', async (status) => {
  setup({ [`POST ${base}/rotate`]: status === 'network' ? () => { throw new TypeError(`synthetic ${syntheticValue}`) } : () => Response.json({ message: `synthetic error ${syntheticValue}`, requestId: `req_${syntheticValue}` }, { status }) })
  open(); await ready(); change(es.newValue, syntheticValue); submit(); await confirm()
  await waitFor(() => expect(within(screen.getByTestId('validation-summary')).getByRole('region')).toHaveFocus())
  expect(document.body.textContent).not.toContain(syntheticValue); expect(screen.getByLabelText(es.newValue)).toHaveValue(syntheticValue)
  expect(screen.getByTestId('validation-summary')).toHaveTextContent(status === 'network' ? es.networkError : 'synthetic error …')
  expect(writes()).toHaveLength(1); expect(screen.queryByRole('alertdialog')).toBeNull()
  fireEvent.click(within(screen.getByTestId('validation-summary')).getByRole('link')); expect(screen.getByLabelText(es.justification)).toHaveFocus()
  submit(); await confirm(); await waitFor(() => expect(writes()).toHaveLength(2))
})
test.each([400, 403, 200])('submit %i retains result focus after the confirmation exit animation', async (status) => {
  setup(status === 200 ? {} : { [`POST ${base}/rotate`]: errorResponse(status) })
  open(); await ready(); submit()
  const dialog = await screen.findByRole('alertdialog')
  let finishExit!: () => void
  const finished = new Promise<void>((resolve) => { finishExit = resolve })
  // jsdom has no CSS animations. Hold the kit's exit completion as a browser does,
  // so the response renders before the modal's deferred focus restoration runs.
  const getAnimations = vi.fn(() => [{ finished }])
  Object.defineProperty(dialog, 'getAnimations', { value: getAnimations })
  fireEvent.change(within(dialog).getByRole('textbox', { name: es.typedPath }), { target: { value: secretPath } })
  fireEvent.click(within(dialog).getByRole('button', { name: es.confirm }))
  await waitFor(() => expect(getAnimations).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByRole('button', { name: es.submit })).toBeEnabled())
  if (status !== 200) expect(screen.getByTestId('validation-summary')).toHaveTextContent(es.validationTitle)
  await act(async () => { finishExit() })
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await flush()
  const target = status === 200 ? screen.getByRole('button', { name: es.submit }) : within(screen.getByTestId('validation-summary')).getByRole('region')
  expect(target).toHaveFocus()
  if (status !== 200) {
    // Cancelling a fresh confirmation after an error still restores its trigger.
    submit(); fireEvent.click(await screen.findByRole('button', { name: es.cancel }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await flush()
    expect(screen.getByRole('button', { name: es.submit })).toHaveFocus()
  }
  expect(writes()).toHaveLength(1)
})
test.each(['es', 'en'] as const)('keeps rotation feedback and its dismiss button accessible before hover or focus in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const c = locale === 'es' ? es : en
  let status = 200
  setup({ [`POST ${base}/rotate`]: () => Response.json(status === 200 ? rotationResult : failure(status).body, { status }) })
  open(); await screen.findByRole('table', { name: c.historyTitle })
  for (status of [200, 400, 403]) {
    fireEvent.click(screen.getByRole('button', { name: c.submit }))
    const confirmation = await screen.findByRole('alertdialog')
    fireEvent.change(within(confirmation).getByRole('textbox', { name: c.typedPath }), { target: { value: secretPath } })
    fireEvent.click(within(confirmation).getByRole('button', { name: c.confirm }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    const notifications = screen.getByRole('region', { name: c.notifications })
    const dismiss = await within(notifications).findByRole('button', { name: c.closeToast })
    const feedback = within(notifications).getByRole('dialog')
    expect(feedback).not.toHaveAttribute('aria-modal', 'true')
    expect(dismiss.closest('[aria-hidden="true"]')).toBeNull()
    expect(feedback.closest('[aria-hidden="true"]')).toBeNull()
    const target = status === 200 ? screen.getByRole('button', { name: c.submit }) : within(screen.getByTestId('validation-summary')).getByRole('region')
    expect(target).toHaveFocus()
    if (status !== 200) expect(document.querySelector('[data-live-announcer="assertive"]')).toHaveTextContent('synthetic-rotation-error')
    // The viewport expands and collapses on focus/hover; neither state may hide
    // a still-focusable close button from assistive technology.
    fireEvent.focus(notifications); fireEvent.blur(notifications, { relatedTarget: target })
    fireEvent.mouseEnter(notifications); fireEvent.mouseLeave(notifications)
    await waitFor(() => expect(dismiss.closest('[aria-hidden="true"]')).toBeNull())
    fireEvent.click(dismiss)
    await waitFor(() => expect(within(notifications).queryByRole('dialog')).toBeNull())
  }
  expect(writes()).toHaveLength(3)
})
test('submit failure focuses the summary when the response arrives after the dialog closes', async () => {
  let failRequest!: () => void
  setup({ [`POST ${base}/rotate`]: () => new Promise<Response>((resolve) => { failRequest = () => resolve(Response.json(failure(403).body, { status: 403 })) }) })
  open(); await ready(); submit(); await confirm()
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(screen.getByRole('button', { name: es.submit })).toBeDisabled()
  await act(async () => { failRequest() })
  await waitFor(() => expect(within(screen.getByTestId('validation-summary')).getByRole('region')).toHaveFocus())
  expect(writes()).toHaveLength(1)
})
test.each(['es', 'en'] as const)('localizes network and non-JSON submit errors on every feedback surface in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const c = locale === 'es' ? es : en
  const failures = [
    () => { throw new TypeError('Failed to fetch') },
    () => new Response('synthetic upstream failure', { status: 500, statusText: 'Internal Server Error' }),
    () => new Response(null, { status: 503 }),
    () => new Response('{invalid-json', { status: 502, headers: { 'content-type': 'application/json' } }),
  ]
  let attempt = 0
  setup({ [`POST ${base}/rotate`]: () => failures[attempt++]() }); open()
  await screen.findByRole('table', { name: c.historyTitle })
  change(c.newValue, syntheticValue)
  const message = i18n.t('submitFailure', { ns: 'pages.console-secret-rotation-page', message: c.networkError })
  for (let index = 0; index < failures.length; index++) {
    fireEvent.click(screen.getByRole('button', { name: c.submit }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: c.typedPath }), { target: { value: secretPath } })
    fireEvent.click(within(dialog).getByRole('button', { name: c.confirm }))
    await waitFor(() => expect(within(screen.getByTestId('validation-summary')).getByRole('region')).toHaveFocus())
    expect(screen.getByTestId('validation-summary')).toHaveTextContent(message)
    await waitFor(() => expect(screen.getByRole('region', { name: c.notifications })).toHaveTextContent(message))
    expect(document.querySelector('[data-live-announcer="assertive"]')).toHaveTextContent(message)
    expect(document.body.textContent).not.toMatch(/Failed to fetch|Internal Server Error|Request failed|invalid-json/)
    expect(document.body.textContent).not.toContain(syntheticValue)
    expect(writes()).toHaveLength(index + 1)
  }
})
test.each([confirmed, timedOut])('stops polling on a nonempty terminal collection', async (terminal) => {
  vi.useFakeTimers(); let attempt = 0; setup({ [`GET ${base}/consumer-status`]: () => Response.json(++attempt === 1 ? pending : terminal) })
  const view = open(); await flush(); expect(reads()).toHaveLength(1); await advance(4999); expect(reads()).toHaveLength(1); await advance(1); expect(reads()).toHaveLength(2)
  await advance(60000); expect(reads()).toHaveLength(2); view.unmount(); await advance(10000); expect(reads()).toHaveLength(2)
})
test.each(['empty', '404', '500', 'network'])('continues one poll every five seconds after %s and cleans up on leave', async (state) => {
  vi.useFakeTimers(); setup({ [`GET ${base}/consumer-status`]: state === 'empty' ? { consumers: [] } : state === 'network' ? () => { throw new TypeError('synthetic') } : errorResponse(Number(state)) })
  const view = open(); await flush(); expect(reads()).toHaveLength(1); await advance(15000); expect(reads()).toHaveLength(4); view.unmount(); await advance(60000); expect(reads()).toHaveLength(4)
})
test.each([['500', 'es'], ['network', 'es'], ['500', 'en'], ['network', 'en']])('consumer %s retry localizes stale times in %s and reschedules one timer', async (state, locale) => {
  await i18n.changeLanguage(locale)
  const c = locale === 'es' ? es : en
  vi.useFakeTimers(); const updatedAt = '2026-06-01T12:34:56.789Z'; vi.setSystemTime(new Date(updatedAt)); let attempt = 0
  setup({ [`GET ${base}/consumer-status`]: () => {
    attempt++; if (attempt === 1) return Response.json(mixed)
    if (attempt === 2) { if (state === 'network') throw new TypeError('synthetic'); return Response.json(failure(500).body, { status: 500 }) }
    return Response.json(pending)
  } })
  const stale = i18n.t('stale', { ns: 'pages.console-secret-rotation-page', time: localizedTime(updatedAt, locale) })
  open(); await flush(); await advance(5000); expect(screen.getByRole('table', { name: c.staleTable })).toBeVisible(); expect(screen.getByText(stale)).toBeVisible()
  expect(screen.getByTestId('rotation-consumers')).not.toHaveTextContent(updatedAt)
  await advance(1000); fireEvent.click(within(screen.getByTestId('rotation-consumers')).getByRole('button', { name: c.retry })); await flush()
  expect(reads()).toHaveLength(3); expect(screen.queryByText(stale)).toBeNull(); expect(screen.queryByText('synthetic-apisix')).toBeNull()
  await advance(4999); expect(reads()).toHaveLength(3); await advance(1); expect(reads()).toHaveLength(4)
})
test.each(['500', 'network'])('never retries a failed POST over sixty seconds after %s', async (status) => {
  // Freeze before submission so a retry scheduled by the failed request would advance too.
  vi.useFakeTimers()
  setup({ [`POST ${base}/rotate`]: status === 'network' ? () => { throw new TypeError('synthetic') } : errorResponse(500) }); open(); await flush()
  const sendWithClock = async () => {
    submit(); await advance(0)
    const dialog = screen.getByRole('alertdialog')
    fireEvent.change(within(dialog).getByRole('textbox', { name: es.typedPath }), { target: { value: secretPath } })
    fireEvent.click(within(dialog).getByRole('button', { name: es.confirm }))
    await advance(1000)
  }
  await sendWithClock()
  expect(screen.getByTestId('validation-summary')).toHaveTextContent(es.validationTitle)
  expect(writes()).toHaveLength(1)
  await advance(60000)
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(writes()).toHaveLength(1)
  await sendWithClock(); expect(writes()).toHaveLength(2)
})
test.each([200, 500])('single-flight keeps both actions disabled during pending POST %i', async (status) => {
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve })
  setup({ [`POST ${base}/rotate`]: async () => { await held; return Response.json(status === 200 ? rotationResult : failure(500).body, { status }) } })
  open(); await ready(); submit(); await confirm(); await waitFor(() => expect(writes()).toHaveLength(1))
  expect(screen.getByRole('button', { name: es.submit })).toBeDisabled(); expect(screen.getByRole('button', { name: es.discard })).toBeDisabled()
  expect(screen.getByRole('button', { name: es.submit }).closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true')
  fireEvent.click(screen.getByRole('button', { name: es.submit })); fireEvent.submit(document.getElementById('secret-rotation-form')!); expect(writes()).toHaveLength(1)
  release(); await waitFor(() => expect(screen.getByRole('button', { name: es.submit })).toBeEnabled())
})
test('401 delegates one refresh and the return path to the shell', async () => {
  setup({ [`GET ${historyUrl}`]: errorResponse(401), [`GET ${base}/consumer-status`]: confirmed, 'POST /v1/auth/login-sessions/synthetic-session/refresh': errorResponse(401) })
  open(route, true); await screen.findByTestId('login'); expect(calls().filter(({ path }) => path.includes('/refresh'))).toHaveLength(1); expect(readProtectedRouteIntent()).toBe(route)
})

test('preserves legacy empty collection fallbacks when response arrays are absent', async () => {
  setup({ [`GET ${historyUrl}`]: { total: 0 }, [`GET ${base}/consumer-status`]: {} }); open()
  await screen.findByRole('heading', { name: es.historyEmpty }); await screen.findByRole('heading', { name: es.consumersEmpty })
  expect(screen.queryByRole('table')).toBeNull(); expect(writes()).toEqual([])
})
