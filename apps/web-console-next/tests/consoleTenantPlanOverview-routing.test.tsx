import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { entitlementsMixed } from './parity/pages/console-tenant-plan-overview-page.manifest'
import { login, strictFetch, tenantUrl } from './shell-support'

const path = '/v1/tenant/plan/effective-entitlements?include=consumption'

test('the migrated route is flagged for shell navigation and renders below /next for a tenant viewer', async () => {
  expect(isMigratedRoute('/console/my-plan')).toBe(true)
  expect(isMigratedRoute('/console/my-plan/allocation')).toBe(true)
  login(['tenant_viewer'], ['synthetic-tenant'])
  const requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [] },
    [`GET ${path}`]: entitlementsMixed,
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/my-plan']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { level: 1, name: 'Mi plan' }, { timeout: 5000 })).toBeVisible()
  expect(await screen.findByText('synthetic-pro')).toBeVisible()
  // No route guard: a viewer sees the page rather than an access denial.
  expect(screen.queryByText(/acceso denegado|access denied/i)).not.toBeInTheDocument()
  const plan = requests.mock.mock.calls.filter(([url]) => String(url).includes('/plan'))
  expect(plan.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)).toEqual([`GET ${path}`])
  expect(requests.mock.mock.calls.some(([url]) => /^\/v1\/tenants\/[^/?]+\//.test(String(url)))).toBe(false)
  requests.verify()
})
