/**
 * REAL Keycloak integration test for the tenant-name resolver.
 *
 * Skipped unless the Falcone test environment is running and exported:
 *   bash tests/env/up.sh && source tests/env/env.sh && npx vitest run \
 *     test/integration/tenant-name-resolver.keycloak.test.ts
 *
 * Exercises the ACTUAL resolver (real client-credentials flow + real Keycloak
 * admin API) — no mocked fetch. Proves the fix works end-to-end against the
 * internal Keycloak the project runs, and that it fails closed for unknown realms.
 */

import { describe, it, expect } from 'vitest'
import { createKeycloakTenantNameResolver } from '../../src/confirmations/tenant-name-resolver.js'

const RUN = process.env.FALCONE_TESTENV === '1' && !!process.env.KEYCLOAK_BASE_URL

describe.skipIf(!RUN)('tenant-name-resolver vs REAL Keycloak (tests/env)', () => {
  it('resolves a seeded realm displayName (tenant A)', async () => {
    const resolver = createKeycloakTenantNameResolver()
    const name = await resolver(process.env.TESTENV_TENANT_A as string)
    expect(name).toBe('Acme Corporation')
  })

  it('resolves a seeded realm displayName (tenant B)', async () => {
    const resolver = createKeycloakTenantNameResolver()
    const name = await resolver(process.env.TESTENV_TENANT_B as string)
    expect(name).toBe('Globex Industries')
  })

  it('fails closed for an unknown realm — never echoes the id', async () => {
    const resolver = createKeycloakTenantNameResolver()
    await expect(resolver('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })
})
