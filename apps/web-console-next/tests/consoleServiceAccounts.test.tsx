import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import i18n from '../src/i18n'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession } from '@in-falcone/console-api/session'
import { active, base, createdBody, expiring, issuancePath, issued, list, mixed, revocationPath, revoked, rotated, rotationPath, accountPath, syntheticSecret, rotatedSecret } from './parity/pages/console-service-accounts-page.manifest'
import { calls, copy, created, failure, fill, open, pageCalls, rowButton, table, typeName, writesOf, type Locale } from './consoleServiceAccounts-support'

let requests: ReturnType<typeof open>['requests']
const refreshPath = 'POST /v1/auth/login-sessions/synthetic-session/refresh'
const locales: Locale[] = ['es', 'en']
beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => requests?.verify())
const start = async (locale: Locale, options: Parameters<typeof open>[0] = {}) => {
  await i18n.changeLanguage(locale)
  ;({ requests } = open(options))
  return table(locale)
}
const listGets = () => pageCalls(requests).filter(({ method, path }) => method === 'GET' && path === base())
const modal = () => document.querySelector('[role="dialog"][aria-modal="true"]')
const announced = () => Array.from(document.querySelectorAll('[data-live-announcer]')).map((node) => node.textContent).join(' ')

test.each(locales)('renders the mixed list with state tags, caption, access labels and expiry in %s', async (locale) => {
  const c = copy[locale]
  const grid = await start(locale)
  expect(screen.getByRole('heading', { level: 1, name: c.title })).toBeVisible()
  expect(screen.getByText('Synthetic Tenant · Synthetic Workspace')).toBeVisible()
  for (const header of [c.table.name, c.table.clientState, c.table.credential, c.table.access, c.table.expires, c.table.actions]) expect(within(grid).getByRole('columnheader', { name: header })).toBeVisible()
  const rows = within(grid).getAllByRole('row')
  expect(rows).toHaveLength(4)
  const [, billing, legacy, nightly] = rows
  expect(within(billing).getByText(c.credentialStatuses.active)).toBeVisible()
  expect(within(billing).getByText(c.accessLevels.read_write)).toBeVisible()
  expect(within(billing).getByText(c.table.missing)).toBeVisible()
  expect(within(legacy).getByText(c.credentialStatuses.revoked)).toBeVisible()
  expect(within(legacy).getByText(c.table.revokedCaption)).toBeVisible()
  expect(within(legacy).getByText(c.accessLevels.denied)).toBeVisible()
  expect(within(nightly).getByText(c.credentialStatuses.rotated)).toBeVisible()
  expect(within(nightly).getByText(c.accessLevels.read_only)).toBeVisible()
  expect(nightly.querySelector('time')).toHaveAttribute('datetime', new Date(expiring.expiresAt).toISOString())
  expect(listGets()).toHaveLength(1)
  expect(document.querySelector('[class*="bg-white"], [class*="text-black"]')).toBeNull()
})

test.each(locales)('client state and credential status use status tags with the legacy tones in %s', async (locale) => {
  const grid = await start(locale)
  const tag = (text: string) => within(grid).getByText(text).closest('span')!
  expect(tag(copy[locale].credentialStatuses.active)).toHaveAttribute('data-tone', 'success')
  expect(tag(copy[locale].credentialStatuses.revoked)).toHaveAttribute('data-tone', 'destructive')
  expect(tag(copy[locale].credentialStatuses.rotated)).toHaveAttribute('data-tone', 'info')
  expect(within(grid).getAllByText(copy[locale].clientStates.enabled).length).toBeGreaterThan(0)
  expect(within(grid).getByText(copy[locale].clientStates.disabled)).toBeVisible()
})

test('an unrecognized non-empty credential status shows its raw value with a neutral tone', async () => {
  ;({ requests } = open({ routes: { [`GET ${base()}`]: list([{ ...active, credentialStatus: { state: 'suspended-by-policy' } }, { ...revoked, credentialStatus: null, accessProjection: null, desiredState: null }]) } }))
  const grid = await table()
  expect(within(grid).getByText('suspended-by-policy')).toBeVisible()
  expect(within(grid).getAllByRole('row')[2].querySelector('[data-status="unknown"]')).toHaveTextContent(copy.es.credentialStatuses.unknown)
  expect(within(grid).getByText('suspended-by-policy').closest('span')).toHaveAttribute('data-tone', 'neutral')
})

test.each(locales)('shows the loading skeleton, then the empty first-run state in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  ;({ requests } = open({ routes: { [`GET ${base()}`]: async () => { await held; return Response.json(list([])) } } }))
  expect(await screen.findByRole('status', { name: copy[locale].states.loading })).toBeVisible()
  // The create form stays usable while the list loads.
  expect(screen.getByRole('textbox', { name: copy[locale].create.nameLabel })).toBeEnabled()
  release()
  expect(await screen.findByRole('heading', { name: copy[locale].states.empty })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
})

test.each(locales)('create: Enter submits one POST with the legacy body, refetches once, announces the id and clears the field in %s', async (locale) => {
  const c = copy[locale]
  await start(locale, { routes: { [`POST ${base()}`]: created(createdBody) } })
  const input = screen.getByRole('textbox', { name: c.create.nameLabel })
  const submit = screen.getByRole('button', { name: c.create.submit })
  expect(submit).toBeDisabled()
  fireEvent.change(input, { target: { value: '   ' } })
  expect(submit).toBeDisabled()
  fireEvent.change(input, { target: { value: 'Created service' } })
  expect(submit).toBeEnabled()
  fireEvent.submit(input.closest('form')!)
  fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(input).toHaveValue(''))
  expect(writesOf(requests)).toEqual([expect.objectContaining({ method: 'POST', path: base(), body: { displayName: 'Created service', entityType: 'service_account', desiredState: 'active' } })])
  await waitFor(() => expect(listGets()).toHaveLength(2))
  const message = fill(c.create.created, { id: createdBody.serviceAccountId })
  expect((await screen.findAllByText(message)).length).toBeGreaterThan(0)
  expect(announced()).toContain(message)
  expect(input).toHaveFocus()
  expect(writesOf(requests)[0].headers.get('Idempotency-Key')).toBeTruthy()
})

test('create keeps its trigger busy and ignores repeated activation until the response arrives', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await start('es', { routes: { [`POST ${base()}`]: async () => { await held; return Response.json(createdBody, { status: 201 }) } } })
  const input = screen.getByRole('textbox', { name: copy.es.create.nameLabel })
  fireEvent.change(input, { target: { value: 'Created service' } })
  fireEvent.submit(input.closest('form')!)
  const busy = await screen.findByRole('button', { name: copy.es.create.submitting })
  expect(busy.hasAttribute('disabled') || busy.getAttribute('aria-disabled') === 'true').toBe(true)
  // The focused input is never natively disabled while the request is pending.
  expect(input).not.toBeDisabled()
  fireEvent.submit(input.closest('form')!)
  fireEvent.click(busy)
  expect(writesOf(requests)).toHaveLength(1)
  release()
  await waitFor(() => expect(input).toHaveValue(''))
  expect(writesOf(requests)).toHaveLength(1)
})

test.each(locales)('reveal posts the issuance body, opens the masked disclosure with id and expiry, toggles, copies and returns focus in %s', async (locale) => {
  const c = copy[locale]
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  await start(locale, { routes: { [`POST ${issuancePath(active.serviceAccountId)}`]: created(issued) } })
  const trigger = rowButton('reveal', 'Billing service', locale)
  fireEvent.click(trigger)
  const dialog = await screen.findByRole('dialog', { name: c.disclosure.revealTitle })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(dialog).toHaveTextContent(issued.credentialId)
  expect(dialog).toHaveTextContent('2026')
  expect(writesOf(requests)).toEqual([expect.objectContaining({ method: 'POST', path: issuancePath(active.serviceAccountId), body: { requestedByUserId: 'synthetic-user' } })])
  // Masked by default: the secret is not in the DOM until it is shown.
  expect(dialog.textContent).not.toContain(syntheticSecret)
  const toggle = within(dialog).getByRole('button', { name: c.disclosure.show })
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(toggle)
  const hide = within(dialog).getByRole('button', { name: c.disclosure.hide })
  expect(hide).toHaveAttribute('aria-pressed', 'true')
  expect(within(dialog).getByDisplayValue(syntheticSecret)).toBeVisible()
  // Reveal success: localized toast and live announcement, and exactly one list refetch.
  const revealed = fill(c.feedback.revealed, { name: 'Billing service' })
  expect(screen.getAllByText(revealed).length).toBeGreaterThan(0)
  expect(announced()).toContain(revealed)
  fireEvent.click(within(dialog).getByRole('button', { name: c.disclosure.copyAria }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(syntheticSecret))
  expect(await within(dialog).findByText(c.disclosure.copied)).toBeVisible()
  expect(announced()).toContain(c.disclosure.copied)
  await waitFor(() => expect(listGets()).toHaveLength(2))
  fireEvent.click(within(dialog).getByRole('button', { name: c.disclosure.close }))
  await waitFor(() => expect(modal()).toBeNull())
  await waitFor(() => expect(rowButton('reveal', 'Billing service', locale)).toHaveFocus())
})

test('Copy shows the manual fallback at once without a clipboard API, even when execCommand exists', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  const execCommand = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
  await start('es', { routes: { [`POST ${issuancePath(active.serviceAccountId)}`]: created(issued) } })
  fireEvent.click(rowButton('reveal', 'Billing service'))
  const dialog = await screen.findByRole('dialog', { name: copy.es.disclosure.revealTitle })
  fireEvent.click(within(dialog).getByRole('button', { name: copy.es.disclosure.copyAria }))
  expect(await within(dialog).findByText(copy.es.disclosure.copyFallback)).toBeVisible()
  expect(execCommand).not.toHaveBeenCalled()
  expect(announced()).toContain(copy.es.disclosure.copyFallback)
})

test('the disclosure body scrolls inside the dialog and keeps the footer actions reachable', async () => {
  await start('es', { routes: { [`POST ${issuancePath(active.serviceAccountId)}`]: created(issued) } })
  fireEvent.click(rowButton('reveal', 'Billing service'))
  const dialog = await screen.findByRole('dialog', { name: copy.es.disclosure.revealTitle })
  const body = within(dialog).getByRole('button', { name: copy.es.disclosure.copyAria }).closest('[class*="border-t"]')!.previousElementSibling as HTMLElement
  expect(body.className).toContain('overflow-y-auto')
  expect(body.className).toContain('min-h-0')
  expect(dialog.className).toContain('overflow-hidden')
  expect(within(dialog).getByRole('button', { name: copy.es.disclosure.close })).toBeVisible()
})

test.each(locales)('rotate asks for the exact name, cancel and Escape send nothing, then one POST shows the fresh secret and one refetch in %s', async (locale) => {
  const c = copy[locale]
  await start(locale, { routes: { [`POST ${rotationPath(active.serviceAccountId)}`]: created(rotated) } })
  fireEvent.click(rowButton('rotate', 'Billing service', locale))
  let dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  const input = within(dialog).getByRole('textbox', { name: c.confirm.typedName })
  await waitFor(() => expect(input).toHaveFocus())
  const confirm = within(dialog).getByRole('button', { name: c.confirm.rotate.action })
  expect(confirm).toBeDisabled()
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm.cancel }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await waitFor(() => expect(rowButton('rotate', 'Billing service', locale)).toHaveFocus())
  expect(writesOf(requests)).toEqual([])
  fireEvent.click(rowButton('rotate', 'Billing service', locale))
  dialog = await screen.findByRole('alertdialog')
  await waitFor(() => expect(within(dialog).getByRole('textbox', { name: c.confirm.typedName })).toHaveFocus())
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await waitFor(() => expect(rowButton('rotate', 'Billing service', locale)).toHaveFocus())
  expect(writesOf(requests)).toEqual([])
  fireEvent.click(rowButton('rotate', 'Billing service', locale))
  dialog = await screen.findByRole('alertdialog')
  typeName(dialog, 'billing service', locale)
  expect(within(dialog).getByRole('button', { name: c.confirm.rotate.action })).toBeDisabled()
  expect(within(dialog).getByText(fill(c.confirm.nameMismatch, { name: 'Billing service' }))).toBeVisible()
  typeName(dialog, 'Billing service', locale)
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm.rotate.action }))
  const disclosure = await screen.findByRole('dialog', { name: c.disclosure.rotateTitle })
  expect(disclosure).toHaveAttribute('aria-modal', 'true')
  expect(within(disclosure).getByText(rotatedSecret)).toBeVisible()
  expect(within(disclosure).getByText(c.disclosure.rotateWarning)).toBeVisible()
  expect(writesOf(requests)).toEqual([expect.objectContaining({ method: 'POST', path: rotationPath(active.serviceAccountId), body: { reason: 'Console rotate' } })])
  // A successful rotation refetches the list exactly once.
  await waitFor(() => expect(listGets()).toHaveLength(2))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(listGets()).toHaveLength(2)
  const rotatedMessage = fill(c.feedback.rotated, { name: 'Billing service' })
  expect(announced()).toContain(rotatedMessage)
  await waitFor(() => expect(disclosure).toHaveFocus())
  fireEvent.click(within(disclosure).getByRole('button', { name: c.disclosure.close }))
  await waitFor(() => expect(modal()).toBeNull())
  await waitFor(() => expect(rowButton('rotate', 'Billing service', locale)).toHaveFocus())
})

test.each(locales)('revoke keeps the irreversibility line, posts once after the exact name and refetches once in %s', async (locale) => {
  const c = copy[locale]
  await start(locale, { routes: { [`POST ${revocationPath(active.serviceAccountId)}`]: created({}, 200) } })
  fireEvent.click(rowButton('revoke', 'Billing service', locale))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent(c.confirm.revoke.irreversible)
  expect(dialog).toHaveTextContent(c.confirm.revoke.description)
  const confirm = within(dialog).getByRole('button', { name: c.confirm.revoke.action })
  expect(confirm).toBeDisabled()
  typeName(dialog, 'Billing service', locale)
  fireEvent.click(confirm); fireEvent.click(confirm)
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writesOf(requests)).toEqual([expect.objectContaining({ method: 'POST', path: revocationPath(active.serviceAccountId), body: { reason: 'Console revoke' } })])
  await waitFor(() => expect(listGets()).toHaveLength(2))
  expect(announced()).toContain(c.feedback.revoked)
})

test.each(locales)('a delayed post-mutation refetch shows the loading state instead of stale rows and actions in %s', async (locale) => {
  const c = copy[locale]
  let reads = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await start(locale, { routes: {
    [`POST ${revocationPath(active.serviceAccountId)}`]: created({}, 200),
    [`GET ${base()}`]: async () => { if (++reads > 1) await held; return Response.json(list(reads === 1 ? mixed : [{ ...active, credentialStatus: { state: 'revoked' } }, revoked, expiring])) },
  } })
  fireEvent.click(rowButton('revoke', 'Billing service', locale))
  const dialog = await screen.findByRole('alertdialog')
  typeName(dialog, 'Billing service', locale)
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm.revoke.action }))
  expect(await screen.findByRole('status', { name: c.states.loading })).toBeVisible()
  // While the refetch is pending no stale row or row action stays available.
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.queryByRole('button', { name: fill(c.row.revealNamed, { name: 'Billing service' }) })).toBeNull()
  release()
  expect(await table(locale)).toBeVisible()
  expect(listGets()).toHaveLength(2)
})

test.each(locales)('delete keeps the irreversibility line and sends DELETE only after the exact name in %s', async (locale) => {
  const c = copy[locale]
  await start(locale, { routes: { [`DELETE ${accountPath(active.serviceAccountId)}`]: created({}, 200), [`GET ${base()}`]: list([revoked, expiring]) } })
  fireEvent.click(rowButton('delete', 'Legacy importer', locale))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent(c.confirm.delete.irreversible)
  expect(dialog).toHaveTextContent(c.confirm.delete.description)
  expect(writesOf(requests)).toEqual([])
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm.cancel }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(writesOf(requests)).toEqual([])
})

test('delete success refetches, announces, and moves focus to the page heading when the row is gone', async () => {
  let reads = 0
  await start('es', { routes: { [`DELETE ${accountPath(active.serviceAccountId)}`]: created({}, 200), [`GET ${base()}`]: () => Response.json(list(++reads === 1 ? mixed : [revoked, expiring])) } })
  fireEvent.click(rowButton('delete', 'Billing service'))
  const dialog = await screen.findByRole('alertdialog')
  typeName(dialog, 'Billing service')
  fireEvent.click(within(dialog).getByRole('button', { name: copy.es.confirm.delete.action }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await waitFor(() => expect(screen.queryByRole('button', { name: fill(copy.es.row.deleteNamed, { name: 'Billing service' }) })).toBeNull())
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  expect(writesOf(requests)).toEqual([expect.objectContaining({ method: 'DELETE', path: accountPath(active.serviceAccountId), body: undefined })])
  expect(announced()).toContain(copy.es.feedback.deleted)
})

test('a revoked credential disables Revelar and Rotar with the reason, and keeps Revocar and Eliminar enabled', async () => {
  await start('es')
  expect(rowButton('reveal', 'Legacy importer')).toBeDisabled()
  expect(rowButton('reveal', 'Legacy importer')).toHaveAttribute('title', copy.es.row.revealRevoked)
  expect(rowButton('rotate', 'Legacy importer')).toBeDisabled()
  expect(rowButton('rotate', 'Legacy importer')).toHaveAttribute('title', copy.es.row.rotateRevoked)
  expect(rowButton('revoke', 'Legacy importer')).toBeEnabled()
  expect(rowButton('delete', 'Legacy importer')).toBeEnabled()
  fireEvent.click(rowButton('reveal', 'Legacy importer'))
  expect(writesOf(requests)).toEqual([])
})

test.each(locales)('tenant_viewer sees the read-only notice, every write control disabled with its reason, and sends no write in %s', async (locale) => {
  const c = copy[locale]
  await start(locale, { roles: ['tenant_viewer'] })
  expect(screen.getAllByRole('status').some((node) => node.textContent?.includes(locale === 'es' ? 'Viewer · solo lectura' : 'Viewer · read-only'))).toBe(true)
  for (const kind of ['reveal', 'rotate', 'revoke', 'delete'] as const) {
    const button = rowButton(kind, 'Billing service', locale)
    expect(button).toBeDisabled()
    expect(button.getAttribute('title')).toContain('Viewer')
    fireEvent.click(button)
  }
  const input = screen.getByRole('textbox', { name: c.create.nameLabel })
  fireEvent.change(input, { target: { value: 'Blocked' } })
  expect(screen.getByRole('button', { name: c.create.submit })).toBeDisabled()
  fireEvent.submit(input.closest('form')!)
  expect(writesOf(requests)).toEqual([])
})

test('a suspended tenant shows the inactive notice and disables writes', async () => {
  await i18n.changeLanguage('es')
  const suspended = { items: [{ tenantId: 'synthetic-tenant', displayName: 'Synthetic Tenant', slug: 'synthetic-tenant', state: 'suspended' }], page: { after: null } }
  ;({ requests } = open({ routes: { [`GET /v1/tenants?page%5Bsize%5D=100&sort=displayName`]: suspended } }))
  await table()
  expect(screen.getAllByText(copy.es.notice.tenantInactive).length).toBeGreaterThan(0)
  expect(rowButton('revoke', 'Billing service')).toBeDisabled()
  expect(screen.getByRole('button', { name: copy.es.create.submit })).toBeDisabled()
})

test('the page never renders the raw backend message', async () => {
  await start('es', { routes: { [`POST ${base()}`]: failure(500) } })
  const input = screen.getByRole('textbox', { name: copy.es.create.nameLabel })
  fireEvent.change(input, { target: { value: 'Created service' } })
  fireEvent.submit(input.closest('form')!)
  expect(await screen.findByRole('button', { name: copy.es.failure.retry })).toBeVisible()
  expect(document.body.textContent).not.toContain('synthetic-backend-message')
})

test('the 401 refresh succeeds then the rotation is resent once with fresh headers and a session-renewed message', async () => {
  const session = readConsoleShellSession()
  void session
  let attempts = 0
  await start('es', { routes: {
    [`POST ${rotationPath(active.serviceAccountId)}`]: () => ++attempts === 1 ? Response.json({ code: 'HTTP_401' }, { status: 401 }) : Response.json(rotated, { status: 201 }),
    [refreshPath]: () => Response.json(buildConsoleRefreshSessionFixture()),
  } })
  fireEvent.click(rowButton('rotate', 'Billing service'))
  const dialog = await screen.findByRole('alertdialog')
  typeName(dialog, 'Billing service')
  fireEvent.click(within(dialog).getByRole('button', { name: copy.es.confirm.rotate.action }))
  await screen.findByRole('dialog', { name: copy.es.disclosure.rotateTitle })
  const posts = writesOf(requests).filter(({ path }) => path === rotationPath(active.serviceAccountId))
  expect(posts).toHaveLength(2)
  expect(posts[0].body).toEqual(posts[1].body)
  expect(posts[0].headers.get('Idempotency-Key')).not.toBe(posts[1].headers.get('Idempotency-Key'))
  expect(posts[0].headers.get('X-Correlation-Id')).not.toBe(posts[1].headers.get('X-Correlation-Id'))
  expect(calls(requests).filter(({ method, path }) => method === 'POST' && path.endsWith('/refresh'))).toHaveLength(1)
  expect(screen.getAllByText(copy.es.feedback.sessionRenewed).length).toBeGreaterThan(0)
})

test.each(['create', 'reveal', 'rotate', 'revoke', 'delete'] as const)('401 with a failed refresh sends one write, no resend and opens nothing for %s', async (action) => {
  const targets = {
    create: ['POST', base()], reveal: ['POST', issuancePath(active.serviceAccountId)], rotate: ['POST', rotationPath(active.serviceAccountId)],
    revoke: ['POST', revocationPath(active.serviceAccountId)], delete: ['DELETE', accountPath(active.serviceAccountId)],
  } as const
  const [method, path] = targets[action]
  await start('es', { routes: { [`${method} ${path}`]: failure(401), [refreshPath]: failure(401), 'GET /v1/auth/signups/policy': { selfServiceEnabled: false, mode: 'invitation' } } })
  if (action === 'create') {
    const input = screen.getByRole('textbox', { name: copy.es.create.nameLabel })
    fireEvent.change(input, { target: { value: 'Created service' } })
    fireEvent.submit(input.closest('form')!)
  } else if (action === 'reveal') fireEvent.click(rowButton('reveal', 'Billing service'))
  else {
    fireEvent.click(rowButton(action, 'Billing service'))
    const dialog = await screen.findByRole('alertdialog')
    typeName(dialog, 'Billing service')
    fireEvent.click(within(dialog).getByRole('button', { name: copy.es.confirm[action].action }))
  }
  await waitFor(() => expect(readConsoleShellSession()).toBeNull())
  expect(writesOf(requests)).toHaveLength(1)
  expect(calls(requests).filter(({ path: url }) => url.endsWith('/refresh'))).toHaveLength(1)
  expect(modal()).toBeNull()
  expect(document.body.textContent).not.toContain(syntheticSecret)
})

test.each([['tenant_viewer', 'Viewer · read-only', 'can view dashboards'], ['tenant_developer', 'Developer · read-only', 'can view the organization']] as const)('the English read-only notice and tooltips for %s carry no Spanish role label or reason', async (role, label, reasonFragment) => {
  await start('en', { roles: [role] })
  const notice = screen.getAllByRole('status').find((node) => node.textContent?.includes(copy.en.notice.readOnlyTitle))!
  expect(notice.textContent).toContain(label)
  expect(notice.textContent).toContain(reasonFragment)
  expect(notice.textContent).not.toMatch(/solo lectura|Tu rol|Contacta/)
  expect(rowButton('reveal', 'Billing service', 'en').getAttribute('title')).toContain(reasonFragment)
  expect(rowButton('delete', 'Billing service', 'en').getAttribute('title')).not.toMatch(/solo lectura|Tu rol|Contacta/)
  expect(screen.getByRole('button', { name: copy.en.create.submit }).getAttribute('title') ?? '').not.toMatch(/solo lectura|Tu rol|Contacta/)
})

test.each([[[], 'No role assigned'], [['unknown_role'], 'Role without recognized write permissions']] as const)('the English notice for roles %j localizes the fail-closed copy', async (roles, label) => {
  await start('en', { roles: [...roles] })
  const notice = screen.getAllByRole('status').find((node) => node.textContent?.includes(copy.en.notice.readOnlyTitle))!
  expect(notice.textContent).toContain(label)
  expect(notice.textContent).not.toMatch(/Tu sesión|Tu rol|Contacta/)
})

test('the Spanish read-only notice keeps the legacy role label and reason', async () => {
  await start('es', { roles: ['tenant_viewer'] })
  const notice = screen.getAllByRole('status').find((node) => node.textContent?.includes(copy.es.notice.readOnlyTitle))!
  expect(notice.textContent).toContain('Viewer · solo lectura')
  expect(notice.textContent).toContain(copy.es.denyReasons.tenant_viewer)
})
