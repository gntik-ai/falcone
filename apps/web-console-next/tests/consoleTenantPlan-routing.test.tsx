import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl } from './shell-support'

test('the migrated route is flagged for shell navigation and renders the page below /next', async () => {
  expect(isMigratedRoute('/console/tenants/t1/plan')).toBe(true)
  login()
  const requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [] },
    'GET /v1/tenants/t1/plan': { assignment: null, plan: null },
    'GET /v1/tenants/t1/plan/effective-entitlements?include=consumption': { tenantId: 't1', quantitativeLimits: [] },
    'GET /v1/tenants/t1/plan/history-impact?page=1&pageSize=20': { items: [], total: 0, page: 1, pageSize: 20 },
    'GET /v1/plans?status=active&page=1&pageSize=20': { items: [], total: 0, page: 1, pageSize: 20 },
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/tenants/t1/plan']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { level: 1, name: 'Plan de la organización' }, { timeout: 5000 })).toBeVisible()
  expect(await screen.findByRole('button', { name: 'Asignar plan' })).toBeVisible()
  requests.verify()
})
