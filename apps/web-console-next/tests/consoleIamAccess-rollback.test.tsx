import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { realmId, tenant } from './parity/pages/console-iam-access-page.manifest'
vi.mock('../src/shell/routes', async (importOriginal) => {
  const module = await importOriginal<typeof import('../src/shell/routes')>()
  return { ...module, pendingConsoleRoutes: module.pendingConsoleRoutes.map((route) => route.path === 'iam-access' ? { ...route, migrated: undefined } : route) }
})
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'

test.each([[['superadmin'], 'Página pendiente'], [['tenant_owner'], 'Acceso denegado']])('clearing migrated alone restores the pending page for %s without IAM calls', async (roles, heading) => {
  await import('../src/pages/pendingPage'); login(roles)
  const requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [tenant], page: { after: null } }, [`GET ${workspaceUrl(realmId)}`]: { items: [], page: { after: null } } })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/iam-access']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: heading }, { timeout: 5000 })).toBeVisible()
  expect(isMigratedRoute('/console/iam-access')).toBe(false)
  expect(requests.mock.mock.calls.filter(([url]) => String(url).startsWith('/v1/iam/'))).toEqual([])
  requests.verify()
})
