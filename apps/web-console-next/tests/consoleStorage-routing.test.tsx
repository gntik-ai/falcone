import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { buildTenantCollectionFixture, buildWorkspaceCollectionFixture } from '@in-falcone/console-api/fixtures'
import { App } from '../src/App'
import { isMigratedRoute } from '../src/shell/navigation'
import { login, strictFetch, tenantUrl, workspaceUrl } from './shell-support'
import { bucketsPath, mockBuckets, mockUsage, usagePath } from './parity/pages/console-storage-page.manifest'
test.each(['superadmin', 'tenant_owner', 'tenant_viewer', 'workspace_viewer'])('%s dispatches storage under /next without a route guard', async (role) => {
  login([role], ['synthetic-tenant'])
  const server = strictFetch({ [`GET ${tenantUrl}`]: buildTenantCollectionFixture(), 'GET /v1/tenants/synthetic-tenant': buildTenantCollectionFixture().items[0], [`GET ${workspaceUrl('synthetic-tenant')}`]: buildWorkspaceCollectionFixture(), [`GET ${bucketsPath}`]: mockBuckets(), [`GET ${usagePath}`]: mockUsage() })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/storage']}><App /></MemoryRouter>)
  expect(await screen.findByRole('button', { name: 'media-assets' }, { timeout: 5000 })).toBeVisible(); expect(isMigratedRoute('/console/storage')).toBe(true)
  expect(server.mock.mock.calls.filter(([path]) => path === bucketsPath)).toHaveLength(1); server.verify()
})
