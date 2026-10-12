import assert from 'node:assert/strict'
import { loginSession, recordFetch, withSession } from './support.mjs'

export const clientCases = [
  ['all exported clients use exactly the auth and three shell METHOD+path contracts', () => withSession(async () => {
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
      listTenants: [], getTenant: ['synthetic-tenant'], listWorkspaces: ['synthetic-tenant']
    }
    assert.deepEqual(Object.keys(clients).sort(), Object.keys(calls).sort())
    for (const [name, args] of Object.entries(calls)) await clients[name](...args)
    assert.equal(requests.length, 10)
    for (const { url } of requests) {
      assert.ok(url.startsWith('/v1/'), url)
      assert.equal(url.includes('://'), false, url)
    }
    assert.deepEqual(requests.map(({ method, url }) => `${method} ${new URL(url, 'https://synthetic.example.test').pathname}`).sort(), [
      'GET /v1/auth/signups/policy', 'POST /v1/auth/login-sessions',
      'POST /v1/auth/login-sessions/synthetic-session/refresh', 'DELETE /v1/auth/login-sessions/synthetic-session',
      'POST /v1/auth/signups', 'POST /v1/auth/password-recovery-requests', 'GET /v1/auth/status-views/active',
      'GET /v1/tenants', 'GET /v1/tenants/synthetic-tenant', 'GET /v1/workspaces'
    ].sort())
  })]
]
