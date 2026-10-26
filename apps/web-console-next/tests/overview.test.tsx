import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import Overview from '../src/pages/overview'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-overview-page.json'
import en from '../src/locales/en/pages.console-overview-page.json'
import { overviewTenant } from './parity/fixtures/overview'

const state = vi.hoisted(() => ({ context: {} as ReturnType<typeof import('../src/shell/context').useConsoleContext> }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => state.context }))
beforeEach(() => {
  state.context = { tenants: [structuredClone(overviewTenant)], workspaces: [], activeTenantId: 'synthetic-tenant', activeWorkspaceId: null,
    loading: false, error: null, selectTenant: vi.fn(), selectWorkspace: vi.fn() }
})
const quickLinks = ['/console/workspaces', '/console/members', '/console/flows', '/console/my-plan']
function assertLinks() {
  expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(quickLinks)
  for (const link of screen.getAllByRole('link')) expect(link.parentElement?.parentElement?.querySelectorAll('a, button, [tabindex="0"]')).toHaveLength(1)
}

test.each(['es', 'en'] as const)('renders translated legacy data, locale counts, accessible meters and working disclosures in %s without requests', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  render(<Overview />)
  expect(screen.getByRole('heading', { name: copy.title, level: 1 })).toBeVisible()
  assertLinks()
  for (const total of Object.values(copy.quota.total)) expect(screen.getByText(total.replace('{total}', '1'))).toBeVisible()
  const kpis = screen.getAllByRole('definition')[0].closest('dl')!
  expect(kpis.querySelectorAll('dt')).toHaveLength(4)
  expect(Array.from(kpis.querySelectorAll('dd'), (item) => item.textContent)).toEqual([2, 12345, 19876, 4321].map((value) => new Intl.NumberFormat(locale).format(value)))
  expect(kpis.querySelector('svg')).toBeNull()
  for (const label of [copy.quota.disclosure, copy.inventory.disclosure]) {
    const trigger = screen.getByRole('button', { name: label })
    trigger.focus(); expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger); expect(trigger).toHaveAttribute('aria-expanded', 'true'); expect(trigger).toHaveFocus()
  }
  expect(screen.getAllByRole('meter')).toHaveLength(3)
  for (const meter of screen.getAllByRole('meter')) expect(meter).toHaveAttribute('aria-valuetext', expect.stringContaining(locale === 'es' ? 'restante' : 'remaining'))
  expect(screen.getByText('workspace-prod')).toBeVisible()
  expect(screen.getByText('workspace-dev')).toBeVisible()
  expect(screen.getByText('invocations_per_minute')).toBeVisible()
  for (const label of [copy.quota.disclosure, copy.inventory.disclosure]) {
    const trigger = screen.getByRole('button', { name: label }); trigger.focus(); fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false'); expect(trigger).toHaveFocus()
  }
  expect(fetch).not.toHaveBeenCalled()
})

test.each(['es', 'en'] as const)('empty states and tenant switcher action are translated in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  state.context.activeTenantId = null
  const showPicker = vi.fn()
  const view = render(<div className="console-shell"><select aria-label="Tenant fixture"><option /></select><Overview /></div>)
  const select = screen.getByRole('combobox') as HTMLSelectElement
  select.showPicker = showPicker
  expect(screen.getByRole('heading', { name: copy.empty.tenant.title })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: copy.empty.tenant.action }))
  expect(select).toHaveFocus(); expect(showPicker).toHaveBeenCalledOnce(); assertLinks()
  state.context.activeTenantId = 'synthetic-tenant'
  state.context.tenants = [{ ...overviewTenant, quotaProfile: undefined, inventorySummary: undefined }]
  view.rerender(<Overview />)
  for (const kind of ['quota', 'inventory'] as const) expect(screen.getByRole('heading', { name: copy.empty[kind].title })).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  state.context.tenants = [{ ...overviewTenant, quotaProfile: { limits: [] }, inventorySummary: { ...overviewTenant.inventorySummary, workspaces: [] } }]
  view.rerender(<Overview />)
  expect(screen.getByText(copy.empty.quotaItems.description)).toBeVisible()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test.each(['es', 'en'] as const)('loading retains quick links and labels both skeletons in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  state.context.loading = true
  render(<Overview />)
  expect(screen.getByRole('status', { name: copy.loading.quota })).toBeVisible()
  expect(screen.getByRole('status', { name: copy.loading.inventory })).toBeVisible()
  expect(screen.queryByTestId('console-tenant-quota-summary')).not.toBeInTheDocument()
  assertLinks()
})

test.each(['es', 'en'] as const)('error states clear stale summaries and expose no unsupported actions in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  const view = render(<Overview />)
  for (const status of [403, 404, 500, undefined, 401]) {
    state.context.error = { status }
    view.rerender(<Overview />)
    if (status !== 401) expect(screen.getByRole('heading', { name: status === 403 ? copy.noAccess.title : copy.error.title })).toBeVisible()
    if (status === 404 || status === 500) expect(screen.getByText(String(status), { exact: true })).toBeVisible()
    expect(screen.queryByTestId('console-tenant-quota-summary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('console-tenant-inventory-summary')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    assertLinks()
  }
})

test.each(['es', 'en'] as const)('a tenant switch hides previous summaries during loading, failure and unresolved selection in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  const view = render(<Overview />)
  const previous = screen.getByTestId('console-tenant-quota-summary')
  expect(within(previous).getByRole('button', { name: copy.quota.disclosure })).toBeVisible()
  state.context.loading = true
  view.rerender(<Overview />)
  expect(screen.getByRole('status', { name: copy.loading.quota })).toBeVisible()
  expect(screen.queryByTestId('console-tenant-quota-summary')).not.toBeInTheDocument()
  expect(screen.queryByTestId('console-tenant-inventory-summary')).not.toBeInTheDocument()
  state.context.loading = false
  state.context.error = { status: 500 }
  view.rerender(<Overview />)
  expect(screen.getByRole('heading', { name: copy.error.title })).toBeVisible()
  expect(screen.queryByTestId('console-tenant-quota-summary')).not.toBeInTheDocument()
  expect(screen.queryByTestId('console-tenant-inventory-summary')).not.toBeInTheDocument()
  state.context.error = null
  state.context.activeTenantId = 'synthetic-unavailable'
  view.rerender(<Overview />)
  expect(screen.queryByTestId('console-tenant-quota-summary')).not.toBeInTheDocument()
  expect(screen.queryByTestId('console-tenant-inventory-summary')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: copy.empty.tenant.title })).toBeVisible()
  assertLinks()
})
