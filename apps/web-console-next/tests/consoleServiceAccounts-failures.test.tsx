import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import i18n from '../src/i18n'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { active, accountPath, base, createdBody, issuancePath, issued, list, mixed, revocationPath, revoked, rotated, rotationPath, expiring } from './parity/pages/console-service-accounts-page.manifest'
import { calls, copy, failure, fill, open, pageCalls, rowButton, table, typeName, writesOf, type Locale } from './consoleServiceAccounts-support'

type Act = 'create' | 'issue' | 'rotate' | 'revoke' | 'delete'
const acts: Act[] = ['create', 'issue', 'rotate', 'revoke', 'delete']
const locales: Locale[] = ['es', 'en']
const refreshPath = 'POST /v1/auth/login-sessions/synthetic-session/refresh'
const targets: Record<Act, { method: string; path: string; ok: () => Response }> = {
  create: { method: 'POST', path: base(), ok: () => Response.json(createdBody, { status: 201 }) },
  issue: { method: 'POST', path: issuancePath(active.serviceAccountId), ok: () => Response.json(issued, { status: 201 }) },
  rotate: { method: 'POST', path: rotationPath(active.serviceAccountId), ok: () => Response.json(rotated, { status: 201 }) },
  revoke: { method: 'POST', path: revocationPath(active.serviceAccountId), ok: () => Response.json({}, { status: 200 }) },
  delete: { method: 'DELETE', path: accountPath(active.serviceAccountId), ok: () => Response.json({}, { status: 200 }) },
}
let requests: ReturnType<typeof open>['requests']
beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => requests?.verify())
const route = (act: Act, handler: (init: RequestInit) => Response | Promise<Response>) => ({ [`${targets[act].method} ${targets[act].path}`]: handler })
const sequence = (act: Act, ...steps: Array<(() => Response) | 'ok'>) => { let index = 0; return route(act, () => { const step = steps[Math.min(index++, steps.length - 1)]; if (step === 'ok') return targets[act].ok(); return step() }) }
const writesTo = (act: Act) => writesOf(requests).filter(({ method, path }) => method === targets[act].method && path === targets[act].path)
const listGets = () => pageCalls(requests).filter(({ method, path }) => method === 'GET' && path === base())
const modal = () => document.querySelector('[role="dialog"][aria-modal="true"]')
const announced = () => Array.from(document.querySelectorAll('[data-live-announcer]')).map((node) => node.textContent).join(' ')
const start = async (locale: Locale, routes: Record<string, unknown>, options: Parameters<typeof open>[0] = {}) => { await i18n.changeLanguage(locale); ;({ requests } = open({ ...options, routes })); await table(locale) }

// Performs the user steps that send the action's request, and returns the surface that shows its outcome.
async function drive(act: Act, locale: Locale) {
  const c = copy[locale]
  if (act === 'create') {
    const input = screen.getByRole('textbox', { name: c.create.nameLabel })
    fireEvent.change(input, { target: { value: 'Created service' } }); fireEvent.submit(input.closest('form')!)
    return { trigger: () => screen.getByRole('button', { name: c.create.submit }), surface: () => screen.findByRole('group', { name: c.failure.title.create }) }
  }
  if (act === 'issue') {
    fireEvent.click(rowButton('reveal', 'Billing service', locale))
    return { trigger: () => rowButton('reveal', 'Billing service', locale), surface: () => screen.findByRole('group', { name: c.failure.title.issue }) }
  }
  fireEvent.click(rowButton(act, 'Billing service', locale))
  const dialog = await screen.findByRole('alertdialog')
  typeName(dialog, 'Billing service', locale)
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm[act].action }))
  return { trigger: () => rowButton(act, 'Billing service', locale), surface: async () => dialog }
}
const focusedName = () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim()
const successSignal = async (act: Act, locale: Locale) => {
  const c = copy[locale]
  if (act === 'create') await waitFor(() => expect(screen.getByRole('textbox', { name: c.create.nameLabel })).toHaveValue(''))
  else if (act === 'issue') await screen.findByRole('dialog', { name: c.disclosure.revealTitle })
  else if (act === 'rotate') await screen.findByRole('dialog', { name: c.disclosure.rotateTitle })
  else await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
}

test.each(locales.flatMap((locale) => acts.map((act) => ({ locale, act }))))('403 replaces the $act surface with no access, focuses Cerrar, opens nothing and Cerrar returns focus ($locale)', async ({ locale, act }) => {
  const c = copy[locale]
  await start(locale, route(act, failure(403)))
  const { trigger, surface } = await drive(act, locale)
  const region = await surface()
  expect(await within(region).findByRole('heading', { name: c.failure.noAccessTitle })).toBeVisible()
  const closeLabel = c.confirm.close
  await waitFor(() => expect(focusedName()).toBe(closeLabel))
  expect(within(region).queryByRole('button', { name: c.failure.retry })).toBeNull()
  expect(modal()?.getAttribute('role')).not.toBe('dialog')
  expect(announced()).toContain(c.failure.noAccessTitle)
  expect(writesTo(act)).toHaveLength(1)
  fireEvent.click(within(region).getByRole('button', { name: closeLabel }))
  await waitFor(() => expect(trigger()).toHaveFocus())
  expect(writesTo(act)).toHaveLength(1)
})

test.each(locales.flatMap((locale) => acts.map((act) => ({ locale, act }))))('404 shows not-found for $act, focuses Close not Back, and Back refetches once and focuses the heading ($locale)', async ({ locale, act }) => {
  const c = copy[locale]
  await start(locale, route(act, failure(404)))
  const gets = listGets().length
  const { surface } = await drive(act, locale)
  const region = await surface()
  expect(await within(region).findByRole('heading', { name: c.failure.notFoundTitle })).toBeVisible()
  await waitFor(() => expect(document.activeElement).toHaveAccessibleName(c.confirm.close))
  expect(document.activeElement).not.toHaveAccessibleName(c.failure.backToList)
  if (act === 'create') expect(region).toHaveTextContent(c.failure.notFound.create)
  else expect(region).toHaveTextContent(fill(c.failure.notFound[act], { name: 'Billing service' }))
  if (act === 'create') expect(screen.getByRole('textbox', { name: c.create.nameLabel })).toHaveValue('Created service')
  fireEvent.click(within(region).getByRole('button', { name: c.failure.backToList }))
  await waitFor(() => expect(listGets()).toHaveLength(gets + 1))
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  expect(writesTo(act)).toHaveLength(1)
})

test.each(locales.flatMap((locale) => acts.flatMap((act) => ['500', 'network'].map((kind) => ({ locale, act, kind })))))('$kind on $act shows Reintentar with the request id, keeps the surface while retrying and sends one request per activation ($locale)', async ({ locale, act, kind }) => {
  const c = copy[locale]
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const first = kind === 'network' ? () => { throw new TypeError('synthetic-network') } : failure(500)
  let attempts = 0
  await start(locale, route(act, async () => { if (++attempts === 1) return (first as () => Response)(); await held; return targets[act].ok() }))
  const { trigger, surface } = await drive(act, locale)
  const region = await surface()
  const retry = await within(region).findByRole('button', { name: c.failure.retry })
  await waitFor(() => expect(document.activeElement).toBe(retry))
  if (kind === '500') expect(region).toHaveTextContent('req_synthetic_service_accounts')
  expect(document.body.textContent).not.toContain('synthetic-backend-message')
  await waitFor(() => expect(announced()).toContain(c.failure.title[act]))
  expect(modal()).toBeNull()
  // Row state is unchanged by the failure (the page is behind the modal for confirmations).
  if (act === 'create' || act === 'issue') expect(rowButton('revoke', 'Billing service', locale)).toBeEnabled()
  fireEvent.click(retry)
  await waitFor(() => expect(writesTo(act)).toHaveLength(2))
  // The failure stays mounted and its retry is inert while the request is in flight.
  const busy = within(region).getAllByRole('button').find((button) => button.getAttribute('aria-busy') === 'true' || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true')
  expect(busy).toBeDefined()
  expect(within(region).getByRole('heading', { name: c.failure.title[act] })).toBeVisible()
  fireEvent.click(busy!)
  expect(writesTo(act)).toHaveLength(2)
  release()
  await successSignal(act, locale)
  expect(writesTo(act)).toHaveLength(2)
  void trigger
})

test.each(locales.flatMap((locale) => (['rotate', 'revoke', 'delete'] as const).flatMap((act) => ['500', 'network'].map((kind) => ({ locale, act, kind })))))('Reintentar on a failed $act ($kind) needs the exact typed name and resends nothing while it differs ($locale)', async ({ locale, act, kind }) => {
  const c = copy[locale]
  const first = kind === 'network' ? () => { throw new TypeError('synthetic-network') } : failure(500)
  await start(locale, sequence(act, first as () => Response, 'ok'))
  const { surface } = await drive(act, locale)
  const dialog = await surface()
  expect(await within(dialog).findByRole('button', { name: c.failure.retry })).toBeEnabled()
  const writes = writesTo(act).length
  typeName(dialog, 'Billing servic', locale)
  expect(within(dialog).getByRole('button', { name: c.confirm[act].action })).toBeDisabled()
  expect(within(dialog).queryByRole('button', { name: c.failure.retry })).toBeNull()
  expect(writesTo(act)).toHaveLength(writes)
  typeName(dialog, 'Billing service', locale)
  const retry = await within(dialog).findByRole('button', { name: c.failure.retry })
  fireEvent.click(retry)
  await waitFor(() => expect(writesTo(act)).toHaveLength(writes + 1))
})

test.each(locales.flatMap((locale) => (['revoke', 'delete'] as const).flatMap((act) => [409, 429, 503].map((status) => ({ locale, act, status })))))('$act keeps the legacy mapped message for $status and lets the user confirm again after 429 ($locale)', async ({ locale, act, status }) => {
  const c = copy[locale]
  const message = status === 409 ? c.errors.conflict : status === 429 ? c.errors.rateLimit : c.errors.unavailable
  await start(locale, sequence(act, failure(status), 'ok'))
  const { surface } = await drive(act, locale)
  const dialog = await surface()
  expect(await within(dialog).findByText(message)).toBeVisible()
  expect(within(dialog).getByRole('textbox', { name: c.confirm.typedName })).toHaveValue('Billing service')
  if (status === 503) { expect(within(dialog).getByRole('button', { name: c.failure.retry })).toBeVisible(); return }
  const again = within(dialog).getByRole('button', { name: c.confirm[act].action })
  expect(again).toBeEnabled()
  await waitFor(() => expect(again).toHaveFocus())
  fireEvent.click(again)
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writesTo(act)).toHaveLength(2)
})

test.each(locales.flatMap((locale) => (['create', 'issue', 'rotate'] as const).map((act) => ({ locale, act }))))('$act maps a revoked credential by code to a localized alert with no Reintentar and no dialog ($locale)', async ({ locale, act }) => {
  const c = copy[locale]
  await start(locale, route(act, failure(409, { code: 'CREDENTIAL_REVOKED', message: 'synthetic-backend-revoked-text' })))
  const { surface } = await drive(act, locale)
  const region = await surface()
  expect(await within(region).findByText(c.errors.revoked)).toBeVisible()
  expect(within(region).queryByRole('button', { name: c.failure.retry })).toBeNull()
  expect(document.body.textContent).not.toContain('synthetic-backend-revoked-text')
  expect(screen.queryByRole('dialog', { name: c.disclosure.revealTitle })).toBeNull()
  expect(screen.queryByRole('dialog', { name: c.disclosure.rotateTitle })).toBeNull()
})

test.each(locales.flatMap((locale) => [400, 408, 409, 422, 429, 500].map((status) => ({ locale, status }))))('the list shows Reintentar and the request id for $status ($locale)', async ({ locale, status }) => {
  const c = copy[locale]
  let reads = 0
  await i18n.changeLanguage(locale)
  ;({ requests } = open({ routes: { [`GET ${base()}`]: () => ++reads === 1 ? failure(status)() : Response.json(list(mixed)) } }))
  const retry = await screen.findByRole('button', { name: c.failure.retry })
  expect(screen.getByRole('heading', { name: c.states.listError })).toBeVisible()
  expect(document.body.textContent).toContain('req_synthetic_service_accounts')
  expect(screen.queryByRole('table')).toBeNull()
  fireEvent.click(retry)
  await table(locale)
  expect(reads).toBe(2)
})

test('a list network failure offers Reintentar and no stale rows', async () => {
  let reads = 0
  await i18n.changeLanguage('en')
  ;({ requests } = open({ routes: { [`GET ${base()}`]: () => { if (++reads === 1) throw new TypeError('synthetic-network'); return Response.json(list(mixed)) } } }))
  fireEvent.click(await screen.findByRole('button', { name: copy.en.failure.retry }))
  await table('en')
})

test('list 403 shows the no-access state', async () => {
  ;({ requests } = open({ routes: { [`GET ${base()}`]: failure(403) } }))
  expect(await screen.findByRole('heading', { name: copy.es.states.listNoAccessTitle })).toBeVisible()
  expect(screen.queryByRole('button', { name: copy.es.failure.retry })).toBeNull()
})

test('list 404 shows not-found with a way back to workspace selection', async () => {
  ;({ requests } = open({ multi: true, routes: { [`GET ${base()}`]: failure(404) } }))
  expect(await screen.findByRole('heading', { name: copy.es.states.listNotFoundTitle })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: copy.es.states.chooseWorkspace }))
  expect(await screen.findByRole('heading', { name: copy.es.states.workspaceRequired })).toBeVisible()
})

test.each(locales)('create failure: Escape on the focused Reintentar closes the surface and returns focus to Crear in %s', async (locale) => {
  const c = copy[locale]
  await start(locale, route('create', failure(500)))
  const { surface } = await drive('create', locale)
  const region = await surface()
  const retry = await within(region).findByRole('button', { name: c.failure.retry })
  await waitFor(() => expect(document.activeElement).toBe(retry))
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('group', { name: c.failure.title.create })).toBeNull())
  expect(screen.getByRole('button', { name: c.create.submit })).toHaveFocus()
  expect(screen.getByRole('textbox', { name: c.create.nameLabel })).toHaveValue('Created service')
})

test.each(locales)('reveal failure: Escape closes the result region and returns focus to Revelar in %s', async (locale) => {
  const c = copy[locale]
  await start(locale, route('issue', failure(500)))
  const { surface } = await drive('issue', locale)
  const region = await surface()
  await within(region).findByRole('button', { name: c.failure.retry })
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  await waitFor(() => expect(rowButton('reveal', 'Billing service', locale)).toHaveFocus())
})

test.each([['revoke', 'alreadyRevoked', 'active-then-revoked'], ['delete', 'alreadyDeleted', 'active-then-gone']] as const)('after a network failure Reintentar on %s reads the list first and reports an applied change without a second write', async (act, key, mode) => {
  const c = copy.es
  let reads = 0
  const gone = list([revoked, expiring])
  const nowRevoked = list([{ ...active, credentialStatus: { state: 'revoked' }, accessProjection: { effectiveAccess: 'denied', blockedByTenantSuspension: false, clientState: 'disabled', credentialState: 'revoked' } }, revoked, expiring])
  await start('es', { ...route(act, () => { throw new TypeError('synthetic-network') }), [`GET ${base()}`]: () => Response.json(++reads === 1 ? list(mixed) : mode === 'active-then-gone' ? gone : nowRevoked) })
  const { surface } = await drive(act, 'es')
  const dialog = await surface()
  fireEvent.click(await within(dialog).findByRole('button', { name: c.failure.retry }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writesTo(act)).toHaveLength(1)
  expect(reads).toBe(2)
  expect(announced()).toContain(fill(c.feedback[key], { name: 'Billing service' }))
})

test.each(['revoke', 'delete'] as const)('after a network failure Reintentar on %s sends exactly one new write when the change was not applied', async (act) => {
  let reads = 0
  await start('en', { ...sequence(act, () => { throw new TypeError('synthetic-network') }, 'ok'), [`GET ${base()}`]: () => { reads++; return Response.json(list(mixed)) } })
  const { surface } = await drive(act, 'en')
  const dialog = await surface()
  fireEvent.click(await within(dialog).findByRole('button', { name: copy.en.failure.retry }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writesTo(act)).toHaveLength(2)
  // The precheck read, then the refetch after the successful write.
  expect(reads).toBe(3)
})

test.each(acts)('401 with a successful refresh resends %s once with fresh keys, shows the session-renewed message and sends no further write', async (act) => {
  const c = copy.en
  await start('en', { ...sequence(act, failure(401), 'ok'), [refreshPath]: () => Response.json(buildConsoleRefreshSessionFixture()) })
  await drive(act, 'en')
  await successSignal(act, 'en')
  const posts = writesTo(act)
  expect(posts).toHaveLength(2)
  expect(posts[0].method).toBe(posts[1].method)
  expect(posts[0].path).toBe(posts[1].path)
  expect(posts[0].body).toEqual(posts[1].body)
  expect(posts[0].headers.get('Idempotency-Key')).not.toBe(posts[1].headers.get('Idempotency-Key'))
  expect(posts[0].headers.get('X-Correlation-Id')).not.toBe(posts[1].headers.get('X-Correlation-Id'))
  expect(calls(requests).filter(({ path }) => path.endsWith('/refresh'))).toHaveLength(1)
  expect((await screen.findAllByText(c.feedback.sessionRenewed)).length).toBeGreaterThan(0)
  expect(writesTo(act)).toHaveLength(2)
})

test.each(['revoke', 'delete'] as const)('after a network failure the primary %s button also reads the list first and sends one new write only when the change was not applied', async (act) => {
  const c = copy.en
  let reads = 0
  await start('en', { ...sequence(act, () => { throw new TypeError('synthetic-network') }, 'ok'), [`GET ${base()}`]: () => { reads++; return Response.json(list(mixed)) } })
  const { surface } = await drive(act, 'en')
  const dialog = await surface()
  await within(dialog).findByRole('button', { name: c.failure.retry })
  // The typed name still matches and nothing is pending, so the primary button is enabled; it must not skip the read.
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm[act].action }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writesTo(act)).toHaveLength(2)
  expect(reads).toBe(3)
})

test.each(['revoke', 'delete'] as const)('after a network failure the primary %s button reports an applied change without a second write', async (act) => {
  const c = copy.es
  let reads = 0
  await start('es', { ...route(act, () => { throw new TypeError('synthetic-network') }), [`GET ${base()}`]: () => Response.json(++reads === 1 ? list(mixed) : list([revoked, expiring])) })
  const { surface } = await drive(act, 'es')
  const dialog = await surface()
  await within(dialog).findByRole('button', { name: c.failure.retry })
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm[act].action }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writesTo(act)).toHaveLength(1)
  expect(announced()).toContain(fill(c.feedback[act === 'revoke' ? 'alreadyRevoked' : 'alreadyDeleted'], { name: 'Billing service' }))
})

test.each(locales.flatMap((locale) => [409, 429].map((status) => ({ locale, status }))))('create alert $status: Escape from the focused Crear closes the failure in $locale', async ({ locale, status }) => {
  const c = copy[locale]
  await start(locale, route('create', failure(status)))
  await drive('create', locale)
  const crear = await screen.findByRole('button', { name: c.create.submit })
  await waitFor(() => expect(crear).toHaveFocus())
  expect(screen.getByRole('alert')).toBeVisible()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(crear).toHaveFocus()
  expect(screen.getByRole('textbox', { name: c.create.nameLabel })).toHaveValue('Created service')
})

test.each(locales.flatMap((locale) => [409, 429].map((status) => ({ locale, status }))))('reveal alert $status: Escape from the focused Revelar closes the failure in $locale', async ({ locale, status }) => {
  await start(locale, route('issue', failure(status)))
  await drive('issue', locale)
  const reveal = rowButton('reveal', 'Billing service', locale)
  await waitFor(() => expect(reveal).toHaveFocus())
  expect(screen.getByRole('alert')).toBeVisible()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(reveal).toHaveFocus()
  expect(writesTo('issue')).toHaveLength(1)
})
