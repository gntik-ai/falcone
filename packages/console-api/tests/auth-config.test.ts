// @vitest-environment jsdom
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { loginSession, recordFetch, withSession } from './cases/support.mjs'

it('the auth-config client sends exactly the four legacy method, path and payload shapes', () => withSession(async () => {
  const client = await import('@in-falcone/console-api/auth-config')
  const { persistConsoleShellSession } = await import('@in-falcone/console-api/session')
  persistConsoleShellSession(loginSession())
  const requests = recordFetch(() => Response.json({ identityProviders: [] }))
  const secret = 'synthetic-client-secret'
  await client.getTenantAuthConfig('ten 1')
  await client.updateTenantAuthConfig('ten 1', { verifyEmail: true })
  await client.upsertTenantIdentityProvider('ten 1', 'git hub', { providerId: 'github', enabled: true, displayName: 'GitHub', config: { clientId: 'id', clientSecret: secret, defaultScope: '' } })
  await client.upsertTenantIdentityProvider('ten 1', 'github', { providerId: 'github', enabled: false })
  await client.deleteTenantIdentityProvider('ten 1', 'github')
  assert.deepEqual(requests.map(({ method, url }) => `${method} ${url}`), [
    'GET /v1/tenants/ten%201/auth-config',
    'PUT /v1/tenants/ten%201/auth-config',
    'PUT /v1/tenants/ten%201/auth-config/identity-providers/git%20hub',
    'PUT /v1/tenants/ten%201/auth-config/identity-providers/github',
    'DELETE /v1/tenants/ten%201/auth-config/identity-providers/github'
  ])
  assert.equal(requests[0].body, undefined)
  assert.deepEqual(JSON.parse(requests[1].body), { verifyEmail: true })
  assert.deepEqual(JSON.parse(requests[2].body), { providerId: 'github', enabled: true, displayName: 'GitHub', config: { clientId: 'id', clientSecret: secret, defaultScope: '' } })
  assert.deepEqual(JSON.parse(requests[3].body), { providerId: 'github', enabled: false })
  assert.equal(requests[4].body, undefined)
  // Only the create request carries the secret.
  assert.deepEqual(requests.map(({ body }) => String(body).includes(secret)), [false, false, true, false, false])
  assert.deepEqual(client.SOCIAL_PROVIDER_TEMPLATES.map(({ id }) => id), ['google', 'github', 'microsoft', 'gitlab', 'facebook', 'linkedin-openid-connect'])
}))
