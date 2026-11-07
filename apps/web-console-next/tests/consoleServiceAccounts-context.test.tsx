import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import i18n from '../src/i18n'
import { buildTenantCollectionFixture } from '@in-falcone/console-api/fixtures'
import { active, base, issuancePath, issued, list, mixed, otherWorkspaceId, rotated, rotationPath } from './parity/pages/console-service-accounts-page.manifest'
import { copy, failure, open, pageCalls, rowButton, table, typeName, workspaces, writesOf, type Locale } from './consoleServiceAccounts-support'
import { tenantUrl, workspaceUrl } from './shell-support'

let requests: ReturnType<typeof open>['requests']
const locales: Locale[] = ['es', 'en']
beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => requests?.verify())
const modal = () => document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]')
// Text query: the modal marks the rest of the page hidden from the accessibility tree.
const control = (name: 'switch-workspace' | 'switch-tenant') => screen.getByText(name)
const announced = () => Array.from(document.querySelectorAll('[data-live-announcer]')).map((node) => node.textContent).join(' ')
type Surface = 'confirmation' | 'disclosure' | 'failure'
async function openSurface(surface: Surface, locale: Locale) {
  const c = copy[locale]
  if (surface === 'confirmation') {
    fireEvent.click(rowButton('rotate', 'Billing service', locale))
    typeName(await screen.findByRole('alertdialog'), 'Billing service', locale)
  } else if (surface === 'disclosure') {
    fireEvent.click(rowButton('reveal', 'Billing service', locale))
    await screen.findByRole('dialog', { name: c.disclosure.revealTitle })
  } else {
    fireEvent.click(rowButton('reveal', 'Billing service', locale))
    await screen.findByRole('button', { name: c.failure.retry })
  }
}
const surfaceRoutes = (surface: Surface) => surface === 'failure' ? { [`POST ${issuancePath(active.serviceAccountId)}`]: failure(500) } : { [`POST ${issuancePath(active.serviceAccountId)}`]: () => Response.json(issued, { status: 201 }) }

test.each(locales.flatMap((locale) => (['confirmation', 'disclosure', 'failure'] as Surface[]).map((surface) => ({ locale, surface }))))('a workspace switch with an open $surface closes it, sends no request and lands on the heading ($locale)', async ({ locale, surface }) => {
  const c = copy[locale]
  await i18n.changeLanguage(locale)
  ;({ requests } = open({ multi: true, routes: surfaceRoutes(surface) }))
  await table(locale)
  fireEvent.change(screen.getByRole('textbox', { name: c.create.nameLabel }), { target: { value: 'Draft name' } })
  await openSurface(surface, locale)
  const before = writesOf(requests).length
  fireEvent.click(control('switch-workspace'))
  expect(await screen.findByText('Other workspace service')).toBeVisible()
  expect(modal()).toBeNull()
  expect(screen.queryByRole('button', { name: c.failure.retry })).toBeNull()
  expect(screen.getByRole('textbox', { name: c.create.nameLabel })).toHaveValue('')
  expect(screen.getByText('Synthetic Tenant · Other Workspace')).toBeVisible()
  expect(writesOf(requests)).toHaveLength(before)
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus())
  expect(pageCalls(requests).filter(({ path }) => path === base(otherWorkspaceId))).toHaveLength(1)
  expect(document.body.textContent).not.toContain('synthetic-secret-not-real')
})

test.each(locales.flatMap((locale) => (['confirmation', 'disclosure', 'failure'] as Surface[]).map((surface) => ({ locale, surface }))))('a tenant switch with an open $surface closes it, sends no request and lands on the gate heading ($locale)', async ({ locale, surface }) => {
  const c = copy[locale]
  await i18n.changeLanguage(locale)
  ;({ requests } = open({ multi: true, routes: surfaceRoutes(surface) }))
  await table(locale)
  await openSurface(surface, locale)
  const before = writesOf(requests).length
  fireEvent.click(control('switch-tenant'))
  const heading = await screen.findByRole('heading', { name: c.states.workspaceRequired })
  expect(modal()).toBeNull()
  expect(screen.queryByRole('table')).toBeNull()
  expect(writesOf(requests)).toHaveLength(before)
  await waitFor(() => expect(heading).toHaveFocus())
})

test('a context switch clears context-bound success toasts', async () => {
  ;({ requests } = open({ multi: true, routes: surfaceRoutes('disclosure') }))
  await table()
  fireEvent.click(rowButton('reveal', 'Billing service'))
  await screen.findByRole('dialog', { name: copy.es.disclosure.revealTitle })
  const message = copy.es.feedback.revealed.replace('{name}', 'Billing service')
  expect(screen.getAllByText(message).length).toBeGreaterThan(0)
  fireEvent.click(control('switch-workspace'))
  await screen.findByText('Other workspace service')
  expect(screen.queryAllByText(message)).toEqual([])
})

test('a response that outlives its workspace is discarded: no old rows, disclosure, toast or error', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  ;({ requests } = open({ multi: true, routes: { [`POST ${rotationPath(active.serviceAccountId)}`]: async () => { await held; return Response.json(rotated, { status: 201 }) } } }))
  await table()
  fireEvent.click(rowButton('rotate', 'Billing service'))
  const dialog = await screen.findByRole('alertdialog')
  typeName(dialog, 'Billing service')
  fireEvent.click(within(dialog).getByRole('button', { name: copy.es.confirm.rotate.action }))
  await waitFor(() => expect(writesOf(requests)).toHaveLength(1))
  fireEvent.click(control('switch-workspace'))
  await screen.findByText('Other workspace service')
  release()
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(modal()).toBeNull()
  expect(screen.queryByText('Billing service')).toBeNull()
  expect(document.body.textContent).not.toContain('synthetic-rotated-not-real')
  expect(announced()).not.toContain(copy.es.feedback.rotated.replace('{name}', 'Billing service'))
  expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
  expect(pageCalls(requests).filter(({ method, path }) => method === 'GET' && path === base())).toHaveLength(1)
})

test('a list response for the previous workspace is discarded', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  ;({ requests } = open({ multi: true, routes: { [`GET ${base()}`]: async () => { await held; return Response.json(list(mixed)) } } }))
  await screen.findByRole('status', { name: copy.es.states.loading })
  fireEvent.click(control('switch-workspace'))
  expect(await screen.findByText('Other workspace service')).toBeVisible()
  release()
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(screen.queryByText('Billing service')).toBeNull()
})

test('a tenant switch that ends at the workspace gate focuses its heading after the workspaces finish loading', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  ;({ requests } = open({ multi: true, routes: { [`GET ${workspaceUrl('synthetic-tenant-b')}`]: async () => { await held; return Response.json({ items: [], page: { after: null } }) } } }))
  await table()
  fireEvent.click(control('switch-tenant'))
  await waitFor(() => expect(screen.queryByRole('table')).toBeNull())
  expect(screen.queryByRole('heading', { name: copy.es.states.workspaceRequired })).toBeNull()
  release()
  const heading = await screen.findByRole('heading', { name: copy.es.states.workspaceRequired })
  await waitFor(() => expect(heading).toHaveFocus())
})

test('without an organization the page keeps the blocked state', async () => {
  ;({ requests } = open({ routes: { [`GET ${tenantUrl}`]: { items: [], page: { after: null } } } }))
  expect(await screen.findByRole('heading', { name: copy.es.states.blockedTitle })).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
})

test('a tenant load failure keeps the blocked state instead of the workspace error', async () => {
  ;({ requests } = open({ routes: { [`GET ${tenantUrl}`]: failure(500) } }))
  expect(await screen.findByRole('heading', { name: copy.es.states.blockedTitle })).toBeVisible()
  expect(screen.queryByRole('button', { name: copy.es.failure.retry })).toBeNull()
})

test.each(locales)('a first-load workspace failure shows the workspace error and Reintentar sends one workspace read in %s', async (locale) => {
  const c = copy[locale]
  await i18n.changeLanguage(locale)
  let reads = 0
  ;({ requests } = open({ routes: { [`GET ${workspaceUrl('synthetic-tenant')}`]: () => ++reads === 1 ? failure(500)() : Response.json({ items: [workspaces[0]], page: { after: null } }) } }))
  const retry = await screen.findByRole('button', { name: c.failure.retry })
  expect(screen.getByRole('heading', { name: c.states.workspaceError })).toBeVisible()
  expect(screen.queryByRole('heading', { name: c.states.blockedTitle })).toBeNull()
  fireEvent.click(retry)
  await table(locale)
  expect(reads).toBe(2)
})

test('with no active workspace the picker activates the chosen workspace and loads its accounts', async () => {
  ;({ requests } = open({ routes: { [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [{ workspaceId: 'synthetic-workspace', tenantId: 'synthetic-tenant', displayName: 'Synthetic Workspace', slug: 'a', state: 'active' }, { workspaceId: 'synthetic-other-workspace', tenantId: 'synthetic-tenant', displayName: 'Other Workspace', slug: 'b', state: 'active' }], page: { after: null } } } }))
  expect(await screen.findByRole('heading', { name: copy.es.states.workspaceRequired })).toBeVisible()
  expect(screen.getByText(copy.es.states.workspaceRequiredDescription)).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
  fireEvent.click(screen.getByRole('combobox', { name: copy.es.states.workspaceLabel }))
  const option = await screen.findByRole('option', { name: 'Other Workspace' }); fireEvent.pointerDown(option); fireEvent.click(option)
  expect(await screen.findByText('Other workspace service')).toBeVisible()
})

test.each([['tenant_owner', 'link'], ['tenant_viewer', 'text']] as const)('with no workspaces %s sees the %s variant', async (role, variant) => {
  const route = { [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [], page: { after: null } } }
  if (role === 'tenant_owner') {
    // Tenant operators read their own tenant singularly.
    const tenant = buildTenantCollectionFixture().items[0]
    ;({ requests } = open({ roles: [role], tenantIds: ['synthetic-tenant'], routes: { ...route, 'GET /v1/tenants/synthetic-tenant': { tenant } } }))
  } else ({ requests } = open({ roles: [role], routes: route }))
  expect(await screen.findByRole('heading', { name: copy.es.states.workspaceRequired })).toBeVisible()
  if (variant === 'link') expect(screen.getByRole('link', { name: copy.es.states.createWorkspace })).toHaveAttribute('href', '/console/workspaces')
  else expect(screen.getByText(copy.es.states.workspaceDenied)).toBeVisible()
})

test.each(locales)('a confirmation failure message sits in the alert description, never in a title, in %s', async (locale) => {
  const c = copy[locale]
  await i18n.changeLanguage(locale)
  ;({ requests } = open({ routes: { [`DELETE /v1/workspaces/synthetic-workspace/service-accounts/${active.serviceAccountId}`]: failure(409) } }))
  await table(locale)
  fireEvent.click(rowButton('delete', 'Billing service', locale))
  const dialog = await screen.findByRole('alertdialog')
  typeName(dialog, 'Billing service', locale)
  fireEvent.click(within(dialog).getByRole('button', { name: c.confirm.delete.action }))
  const alert = await within(dialog).findByRole('alert')
  expect(alert).toHaveTextContent(c.errors.conflict)
  expect(alert.getAttribute('aria-labelledby')).toBeNull()
  expect(alert.getAttribute('aria-describedby')).not.toBeNull()
})
