import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { login, strictFetch, tenantUrl } from './shell-support'

vi.mock('../src/shell/routes', async (importOriginal) => {
  const module = await importOriginal<typeof import('../src/shell/routes')>()
  return { ...module, pendingConsoleRoutes: module.pendingConsoleRoutes.map((route) =>
    route.path === 'flows/:flowId/runs' ? { ...route, migrated: undefined } : route) }
})
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'

test('disabling the history migration restores pendingPage and legacy links without execution requests', async () => {
  await import('../src/pages/pendingPage')
  login()
  const requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/flows/f1/runs']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Página pendiente' }, { timeout: 5000 })).toBeVisible()
  expect(isMigratedRoute('/console/flows/f1/runs')).toBe(false)
  expect(requests.mock.mock.calls.filter(([url]) => String(url).includes('/executions'))).toEqual([])
  requests.verify()
})
