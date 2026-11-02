import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { entitlementsMixed, overviewUrl } from './parity/pages/console-tenant-plan-overview-page.manifest'
import { overviewTenant } from './parity/fixtures/overview'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())

test('the route is flagged for shell navigation and the allocation route is unchanged', () => {
  expect(isMigratedRoute('/console/my-plan')).toBe(true)
  expect(isMigratedRoute('/console/my-plan/allocation')).toBe(true)
})

test.each(['tenant_owner', 'tenant_viewer'])('%s renders the page below /next with one own-tenant read and no guard denial', async (role) => {
  login([role], ['synthetic-tenant'])
  requests = strictFetch({
    'GET /v1/tenants/synthetic-tenant': overviewTenant, [`GET ${tenantUrl}`]: { items: [overviewTenant] },
    [`GET ${workspaceUrl('synthetic-tenant')}`]: { items: [] }, [`GET ${overviewUrl}`]: entitlementsMixed,
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/my-plan']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { level: 1, name: 'Mi plan' }, { timeout: 5000 })).toBeVisible()
  expect(await screen.findByText('synthetic-pro')).toBeVisible()
  expect(screen.queryByRole('heading', { name: /sin acceso|forbidden/i })).not.toBeInTheDocument()
  const planCalls = requests.mock.mock.calls.filter(([url]) => String(url).includes('/plan'))
  expect(planCalls.map(([url, init]) => [init?.method, url])).toEqual([['GET', '/v1/tenant/plan/effective-entitlements?include=consumption']])
  expect(requests.mock.mock.calls.some(([url]) => /^\/v1\/tenants\/[^/?]+\/plan/.test(String(url)))).toBe(false)
  const nav = screen.getAllByRole('link', { name: 'Mi plan' })
  expect(nav.some((link) => link.getAttribute('href') === '/next/console/my-plan')).toBe(true)
  fireEvent.click(screen.getByRole('tab', { name: 'Historial' }))
  expect(await screen.findByText('Sin historial de cambios del plan')).toBeVisible()
  expect(requests.mock.mock.calls.filter(([url]) => String(url).includes('/plan'))).toHaveLength(1)
})
