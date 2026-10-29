import assert from 'node:assert/strict'
import { loginSession, recordFetch, withSession } from './support.mjs'

export const clientCases = [
  ['all exported clients use exactly the auth, shell, IAM membership and quota METHOD+path contracts', () => withSession(async () => {
    const clients = await import('@in-falcone/console-api/clients')
    const { persistConsoleShellSession } = await import('@in-falcone/console-api/session')
    persistConsoleShellSession(loginSession())
    const requests = recordFetch(() => Response.json({ items: [], page: { after: null } }))
    const calls = {
      getConsoleSignupPolicy: [],
      createConsoleLoginSession: [{ username: 'synthetic-user', password: 'synthetic-password' }],
      refreshConsoleLoginSession: ['synthetic-session', 'synthetic-refresh'],
      terminateConsoleLoginSession: ['synthetic-session', 'synthetic-access', 'synthetic-refresh'],
      createConsoleSignup: [{ username: 'synthetic-user', displayName: 'Synthetic User', primaryEmail: 'synthetic@example.test', password: 'synthetic-password', tenantId: 'synthetic-tenant' }],
      createConsolePasswordRecoveryRequest: [{ usernameOrEmail: 'synthetic@example.test' }],
      getConsoleAccountStatusView: ['active'],
      listTenants: [], getTenant: ['synthetic-tenant'], listWorkspaces: ['synthetic-tenant'],
      assignIamUserRoles: ['synthetic-realm', 'synthetic-user', ['synthetic-reader']],
      removeIamUserRoles: ['synthetic-realm', 'synthetic-user', ['synthetic-reader']],
      addIamUserToGroup: ['synthetic-realm', 'synthetic-user', 'synthetic-group'],
      removeIamUserFromGroup: ['synthetic-realm', 'synthetic-user', 'synthetic-group'],
      getTenantQuotaPosture: ['synthetic-tenant'], getTenantQuotaOverview: ['synthetic-tenant'],
      getWorkspaceQuotaPosture: ['synthetic-workspace'], getWorkspaceQuotaOverview: ['synthetic-workspace'],
      getQuotaTenantPlan: ['synthetic-tenant'], setQuotaPlanLimit: ['synthetic-plan', 'max_workspaces', 500]
    }
    assert.deepEqual(Object.keys(clients).sort(), Object.keys(calls).sort())
    for (const [name, args] of Object.entries(calls)) await clients[name](...args)
    assert.equal(requests.length, 20)
    for (const { url } of requests) {
      assert.ok(url.startsWith('/v1/'), url)
      assert.equal(url.includes('://'), false, url)
    }
    assert.deepEqual(requests.map(({ method, url }) => `${method} ${new URL(url, 'https://synthetic.example.test').pathname}`).sort(), [
      'GET /v1/auth/signups/policy', 'POST /v1/auth/login-sessions',
      'POST /v1/auth/login-sessions/synthetic-session/refresh', 'DELETE /v1/auth/login-sessions/synthetic-session',
      'POST /v1/auth/signups', 'POST /v1/auth/password-recovery-requests', 'GET /v1/auth/status-views/active',
      'GET /v1/tenants', 'GET /v1/tenants/synthetic-tenant', 'GET /v1/workspaces',
      'POST /v1/iam/realms/synthetic-realm/users/synthetic-user/role-assignments',
      'DELETE /v1/iam/realms/synthetic-realm/users/synthetic-user/role-assignments',
      'PUT /v1/iam/realms/synthetic-realm/users/synthetic-user/groups/synthetic-group',
      'DELETE /v1/iam/realms/synthetic-realm/users/synthetic-user/groups/synthetic-group',
      'GET /v1/metrics/tenants/synthetic-tenant/quotas', 'GET /v1/metrics/tenants/synthetic-tenant/overview',
      'GET /v1/metrics/workspaces/synthetic-workspace/quotas', 'GET /v1/metrics/workspaces/synthetic-workspace/overview',
      'GET /v1/tenants/synthetic-tenant/plan', 'PUT /v1/plans/synthetic-plan/limits/max_workspaces'
    ].sort())
    const quotaReads = requests.slice(-6, -1)
    assert.equal(quotaReads.length, 5)
    for (const request of quotaReads) {
      assert.equal(request.method, 'GET')
      assert.equal(request.body, undefined)
      assert.equal(new URL(request.url, 'https://synthetic.example.test').search, '')
    }
    assert.deepEqual(JSON.parse(requests.at(-1).body), { value: 500 })
    await clients.setQuotaPlanLimit('synthetic-plan', 'max_workspaces', -1)
    assert.deepEqual(JSON.parse(requests.at(-1).body), { value: -1 })
  })]
]
