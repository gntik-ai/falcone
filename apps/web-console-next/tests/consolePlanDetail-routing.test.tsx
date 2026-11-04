import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { limitsProfileFor, planFor } from './consolePlanDetail-support'
import { login, strictFetch, tenantUrl } from './shell-support'

const route = '/next/console/plans/p9'

test('the migrated route is flagged for shell navigation and renders the page below /next for a superadmin', async () => {
  expect(isMigratedRoute('/console/plans/p9')).toBe(true)
  login()
  const requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] }, 'GET /v1/plans/p9': planFor('p9'), 'GET /v1/plans/p9/limits': limitsProfileFor('p9') })
  render(<MemoryRouter basename="/next" initialEntries={[route]}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { level: 1, name: 'Synthetic Plan' }, { timeout: 5000 })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Página pendiente' })).toBeNull()
  requests.verify()
})

test('a non-superadmin is stopped by the guard and sends no plan request', async () => {
  login(['tenant_owner'])
  const requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  render(<MemoryRouter basename="/next" initialEntries={[route]}><App /></MemoryRouter>)
  expect(await screen.findByText('Acceso denegado', undefined, { timeout: 5000 })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Synthetic Plan' })).toBeNull()
  expect(requests.mock.mock.calls.filter(([url]) => String(url).includes('/v1/plans'))).toEqual([])
  requests.verify()
})
