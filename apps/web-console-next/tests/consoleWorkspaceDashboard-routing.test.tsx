import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import { login, strictFetch, tenantUrl } from './shell-support'

vi.mock('../src/shell/routes', async (importOriginal) => {
  const module = await importOriginal<typeof import('../src/shell/routes')>()
  return { ...module, pendingConsoleRoutes: module.pendingConsoleRoutes.map((route) =>
    route.path === 'workspaces/:workspaceId' ? { ...route, migrated: undefined } : route) }
})
import { App } from '../src/App'

test('removing the migrated flag restores the pending workspace route without consumption requests', async () => {
  // Test route selection independently of the lazy destination's cold module transform.
  await import('../src/pages/pendingPage')
  login(['workspace_viewer'])
  const requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } })
  render(<MemoryRouter initialEntries={['/console/workspaces/w2']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Página pendiente' })).toBeVisible()
  expect(requests.mock.mock.calls.filter(([url]) => String(url).endsWith('/consumption'))).toEqual([])
  requests.verify()
})
