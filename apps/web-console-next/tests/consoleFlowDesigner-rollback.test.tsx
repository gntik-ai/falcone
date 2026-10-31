import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { flowRows, flowsPath } from './parity/pages/console-flows-page.manifest'

vi.mock('../src/shell/routes', async (importOriginal) => {
  const module = await importOriginal<typeof import('../src/shell/routes')>()
  return { ...module, pendingConsoleRoutes: module.pendingConsoleRoutes.map((route) =>
    route.path === 'flows/:flowId' ? { ...route, migrated: undefined } : route) }
})
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())

test('disabling the designer migration restores pendingPage without designer requests', async () => {
  await import('../src/pages/pendingPage')
  login()
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(),
    [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/flows/f1']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 5000 })).toBeVisible()
  expect(isMigratedRoute('/console/flows/f1')).toBe(false)
  expect(screen.queryByTestId('console-flow-designer-page')).toBeNull()
  expect(requests.mock.mock.calls.filter(([url]) => String(url).startsWith('/v1/flows/'))).toEqual([])
})

test('the flows list keeps its legacy designer anchor when the designer migration is disabled', async () => {
  login()
  requests = strictFetch({
    [`GET ${tenantUrl}`]: buildTenantCollectionFixture(),
    [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(),
    [`GET ${flowsPath}`]: flowRows,
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/flows']}><App /></MemoryRouter>)
  const designer = await screen.findByRole('link', { name: 'Abrir diseñador para Synthetic published flow' }, { timeout: 5000 })
  expect(designer).toHaveAttribute('href', '/console/flows/f1')
  expect(isMigratedRoute('/console/flows')).toBe(true)
  expect(isMigratedRoute('/console/flows/f1')).toBe(false)
  expect(requests.mock.mock.calls.filter(([url]) => String(url).startsWith('/v1/flows/')).map(([url, init]) => [init?.method, url])).toEqual([['GET', flowsPath]])
})
