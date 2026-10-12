import assert from 'node:assert/strict'
import { loginSession, recordFetch, withSession } from './support.mjs'

export const loaderCases = [
  ['tenant operators load only their own singular tenant endpoints', () => withSession(async () => {
    const { persistConsoleShellSession } = await import('@in-falcone/console-api/session')
    const { listAccessibleTenants } = await import('@in-falcone/console-api/loaders')
    persistConsoleShellSession(loginSession())
    const requests = recordFetch(({ url }) => url.endsWith('/a')
      ? Response.json({ tenant: { tenantId: 'a', displayName: 'Tenant A', slug: 'a' } })
      : Response.json({ tenantId: 'b', displayName: 'Tenant B', slug: 'b' }))
    assert.deepEqual(await listAccessibleTenants({ isTenantOperator: true, ownTenantIds: ['a', 'b'] }), {
      items: [{ tenantId: 'a', displayName: 'Tenant A', slug: 'a' }, { tenantId: 'b', displayName: 'Tenant B', slug: 'b' }],
      page: { after: null }
    })
    assert.deepEqual(requests.map(({ url, method }) => `${method} ${url}`), ['GET /v1/tenants/a', 'GET /v1/tenants/b'])
  })],
  ['tenant operators with no tenant IDs return an empty collection without fetching', () => withSession(async () => {
    const { listAccessibleTenants } = await import('@in-falcone/console-api/loaders')
    const requests = recordFetch(() => { throw new Error('Must not fetch') })
    assert.deepEqual(await listAccessibleTenants({ isTenantOperator: true, ownTenantIds: [] }), { items: [], page: { after: null } })
    assert.equal(requests.length, 0)
  })],
  ['platform tenant and workspace loaders preserve parsed collection parameters', () => withSession(async () => {
    const { persistConsoleShellSession } = await import('@in-falcone/console-api/session')
    const { listAccessibleTenants, listAccessibleWorkspaces } = await import('@in-falcone/console-api/loaders')
    persistConsoleShellSession(loginSession())
    const collection = { items: [], page: { after: null } }
    const requests = recordFetch(() => Response.json(collection))
    assert.deepEqual(await listAccessibleTenants({ isTenantOperator: false, ownTenantIds: [] }), collection)
    assert.deepEqual(await listAccessibleWorkspaces('synthetic-tenant'), collection)
    const tenants = new URL(requests[0].url, 'https://synthetic.example.test')
    assert.equal(tenants.pathname, '/v1/tenants')
    assert.equal(tenants.searchParams.get('page[size]'), '100')
    assert.equal(tenants.searchParams.get('sort'), 'displayName')
    const workspaces = new URL(requests[1].url, 'https://synthetic.example.test')
    assert.equal(workspaces.pathname, '/v1/workspaces')
    assert.equal(workspaces.searchParams.get('page[size]'), '100')
    assert.equal(workspaces.searchParams.get('sort'), 'displayName')
    assert.equal(workspaces.searchParams.get('filter[tenantId]'), 'synthetic-tenant')
  })]
]
