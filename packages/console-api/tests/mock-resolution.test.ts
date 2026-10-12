import { expect, it, vi } from 'vitest'

// These are module-resolution contracts for the app's vi.mock targets. Behavior tests
// use real collaborators and stub only fetch/storage/time.
vi.mock('@in-falcone/console-api/http', () => ({
  requestJson: async () => ({ sessionId: 'synthetic-mocked-auth' })
}))
vi.mock('@in-falcone/console-api/session', () => ({
  requestConsoleSessionJson: async () => ({ items: [{ tenantId: 'synthetic-mocked-tenant' }], page: { after: null } }),
  readConsoleShellSession: () => ({ principal: { platformRoles: ['tenant_viewer'] } })
}))

import { createConsoleLoginSession } from '@in-falcone/console-api/auth'
import { listAccessibleTenants } from '@in-falcone/console-api/loaders'
import { useConsolePermissions } from '@in-falcone/console-api/permissions'

it('the http subpath mock intercepts the auth module relative import', async () => {
  expect(await createConsoleLoginSession({ username: 'synthetic-user', password: 'synthetic-password' }))
    .toEqual({ sessionId: 'synthetic-mocked-auth' })
})

it('the session subpath mock intercepts loader and permission relative imports', async () => {
  expect(await listAccessibleTenants({ isTenantOperator: false, ownTenantIds: [] }))
    .toEqual({ items: [{ tenantId: 'synthetic-mocked-tenant' }], page: { after: null } })
  expect(useConsolePermissions().highestRoleLabel).toBe('Viewer · solo lectura')
})
