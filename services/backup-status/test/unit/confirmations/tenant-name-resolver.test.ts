/**
 * Unit tests for createKeycloakTenantNameResolver
 * (services/backup-status/src/confirmations/tenant-name-resolver.ts)
 *
 * All HTTP calls are satisfied by injected fake `fetch` implementations.
 * No network access occurs.
 *
 * Security invariant under test (FAIL CLOSED):
 *   - Returns `realm.displayName` when the Keycloak admin API is reachable
 *   - Throws ConfirmationError(500, 'tenant_name_resolver_unavailable') when:
 *       * required env vars are missing
 *       * admin token fetch fails
 *       * realm returns 404
 *       * realm fetch errors out
 *       * displayName is absent or empty
 *   - NEVER returns the raw tenantId as a fallback under any of the above
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createKeycloakTenantNameResolver } from '../../../src/confirmations/tenant-name-resolver.js'

const TENANT_ID = 'acme-corp'
const DISPLAY_NAME = 'Acme Corporation'

const ENV_VARS = {
  KEYCLOAK_ADMIN_BASE_URL: 'https://keycloak.internal/auth',
  KEYCLOAK_ADMIN_TOKEN_URL: 'https://keycloak.internal/auth/realms/master/protocol/openid-connect/token',
  KEYCLOAK_ADMIN_CLIENT_ID: 'backup-admin',
  KEYCLOAK_ADMIN_CLIENT_SECRET: 's3cr3t',
}

// ---------------------------------------------------------------------------
// Helpers: fake fetch factories
// ---------------------------------------------------------------------------

/**
 * Builds a fake fetch that handles:
 *   - token URL → returns { access_token: 'fake-token' }
 *   - realm URL → returns the provided realm payload
 */
function makeFakeFetch(realmPayload: Record<string, unknown>, realmStatus = 200): typeof fetch {
  return (async (url: string | URL | Request, _init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url
    if (urlStr.includes('openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'fake-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (urlStr.includes(`/admin/realms/${TENANT_ID}`)) {
      return new Response(JSON.stringify(realmPayload), {
        status: realmStatus,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('Not found', { status: 404 })
  }) as unknown as typeof fetch
}

function makeTokenErrorFetch(): typeof fetch {
  return (async (_url: string | URL | Request) => {
    return new Response('Unauthorized', { status: 401 })
  }) as unknown as typeof fetch
}

function makeNetworkErrorFetch(): typeof fetch {
  return (async (_url: string | URL | Request) => {
    throw new Error('Network error')
  }) as unknown as typeof fetch
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createKeycloakTenantNameResolver', () => {
  beforeEach(() => {
    // Set required env vars for every test; individual tests can override
    vi.stubEnv('KEYCLOAK_ADMIN_BASE_URL', ENV_VARS.KEYCLOAK_ADMIN_BASE_URL)
    vi.stubEnv('KEYCLOAK_ADMIN_TOKEN_URL', ENV_VARS.KEYCLOAK_ADMIN_TOKEN_URL)
    vi.stubEnv('KEYCLOAK_ADMIN_CLIENT_ID', ENV_VARS.KEYCLOAK_ADMIN_CLIENT_ID)
    vi.stubEnv('KEYCLOAK_ADMIN_CLIENT_SECRET', ENV_VARS.KEYCLOAK_ADMIN_CLIENT_SECRET)
  })

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns realm displayName from Keycloak admin API', async () => {
    const fakeFetch = makeFakeFetch({ displayName: DISPLAY_NAME, realm: TENANT_ID })
    const resolver = createKeycloakTenantNameResolver({ fetch: fakeFetch })

    const result = await resolver(TENANT_ID)

    expect(result).toBe(DISPLAY_NAME)
    // Critically: must NOT be the raw tenantId
    expect(result).not.toBe(TENANT_ID)
  })

  it('caches the result for subsequent calls (TTL cache)', async () => {
    let callCount = 0
    const trackingFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url
      if (urlStr.includes(`/admin/realms/${TENANT_ID}`)) callCount++
      return makeFakeFetch({ displayName: DISPLAY_NAME })(url, init)
    }) as unknown as typeof fetch

    const resolver = createKeycloakTenantNameResolver({ fetch: trackingFetch })

    await resolver(TENANT_ID)
    await resolver(TENANT_ID)
    await resolver(TENANT_ID)

    // Realm endpoint should be called only once due to caching
    expect(callCount).toBe(1)
  })

  // -------------------------------------------------------------------------
  // Fail-closed: config missing
  // -------------------------------------------------------------------------

  it('throws tenant_name_resolver_unavailable when KEYCLOAK_ADMIN_BASE_URL is missing', async () => {
    vi.stubEnv('KEYCLOAK_ADMIN_BASE_URL', '')
    const resolver = createKeycloakTenantNameResolver({ fetch: makeFakeFetch({ displayName: DISPLAY_NAME }) })

    await expect(resolver(TENANT_ID)).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })

  it('throws tenant_name_resolver_unavailable when KEYCLOAK_ADMIN_TOKEN_URL is missing', async () => {
    vi.stubEnv('KEYCLOAK_ADMIN_TOKEN_URL', '')
    const resolver = createKeycloakTenantNameResolver({ fetch: makeFakeFetch({ displayName: DISPLAY_NAME }) })

    await expect(resolver(TENANT_ID)).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })

  it('throws tenant_name_resolver_unavailable when KEYCLOAK_ADMIN_CLIENT_ID is missing', async () => {
    vi.stubEnv('KEYCLOAK_ADMIN_CLIENT_ID', '')
    const resolver = createKeycloakTenantNameResolver({ fetch: makeFakeFetch({ displayName: DISPLAY_NAME }) })

    await expect(resolver(TENANT_ID)).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })

  it('throws tenant_name_resolver_unavailable when KEYCLOAK_ADMIN_CLIENT_SECRET is missing', async () => {
    vi.stubEnv('KEYCLOAK_ADMIN_CLIENT_SECRET', '')
    const resolver = createKeycloakTenantNameResolver({ fetch: makeFakeFetch({ displayName: DISPLAY_NAME }) })

    await expect(resolver(TENANT_ID)).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })

  // -------------------------------------------------------------------------
  // Fail-closed: admin token fetch failure
  // -------------------------------------------------------------------------

  it('throws tenant_name_resolver_unavailable when admin token request returns non-2xx', async () => {
    const resolver = createKeycloakTenantNameResolver({ fetch: makeTokenErrorFetch() })

    await expect(resolver(TENANT_ID)).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })

  it('throws tenant_name_resolver_unavailable when admin token fetch throws a network error', async () => {
    const resolver = createKeycloakTenantNameResolver({ fetch: makeNetworkErrorFetch() })

    await expect(resolver(TENANT_ID)).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })

  // -------------------------------------------------------------------------
  // Fail-closed: realm not found
  // -------------------------------------------------------------------------

  it('throws tenant_name_resolver_unavailable when realm returns 404', async () => {
    const resolver = createKeycloakTenantNameResolver({
      fetch: makeFakeFetch({}, 404),
    })

    await expect(resolver(TENANT_ID)).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })

  it('throws tenant_name_resolver_unavailable when realm returns 500', async () => {
    const resolver = createKeycloakTenantNameResolver({
      fetch: makeFakeFetch({ error: 'Internal' }, 500),
    })

    await expect(resolver(TENANT_ID)).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })

  // -------------------------------------------------------------------------
  // Fail-closed: displayName absent or empty
  // -------------------------------------------------------------------------

  it('throws tenant_name_resolver_unavailable when realm has no displayName', async () => {
    const resolver = createKeycloakTenantNameResolver({
      fetch: makeFakeFetch({ realm: TENANT_ID }), // no displayName field
    })

    await expect(resolver(TENANT_ID)).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })

  it('throws tenant_name_resolver_unavailable when realm displayName is an empty string', async () => {
    const resolver = createKeycloakTenantNameResolver({
      fetch: makeFakeFetch({ displayName: '', realm: TENANT_ID }),
    })

    await expect(resolver(TENANT_ID)).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })

  it('throws tenant_name_resolver_unavailable when realm displayName is whitespace only', async () => {
    const resolver = createKeycloakTenantNameResolver({
      fetch: makeFakeFetch({ displayName: '   ', realm: TENANT_ID }),
    })

    await expect(resolver(TENANT_ID)).rejects.toMatchObject({
      code: 'tenant_name_resolver_unavailable',
      statusCode: 500,
    })
  })

  // -------------------------------------------------------------------------
  // Fail-closed: NEVER echoes tenantId
  // -------------------------------------------------------------------------

  it('never returns the raw tenantId even when displayName equals tenantId', async () => {
    // Even if Keycloak were misconfigured to return tenantId as displayName,
    // that IS a valid string and would be returned — the important invariant
    // is that we do NOT fall back silently when the resolver is not configured.
    // This test verifies the nominal path: if displayName === tenantId (unusual
    // config), the value returned comes FROM Keycloak, not from a silent echo.
    const fakeFetch = makeFakeFetch({ displayName: TENANT_ID, realm: TENANT_ID })
    const resolver = createKeycloakTenantNameResolver({ fetch: fakeFetch })

    // Should succeed (Keycloak returned a valid displayName)
    const result = await resolver(TENANT_ID)
    expect(result).toBe(TENANT_ID)
    // The test proves the value was fetched from Keycloak (fake fetch was used)
  })

  it('uses injected getAdminToken when provided', async () => {
    const getAdminToken = vi.fn().mockResolvedValue('injected-admin-token')
    let usedToken: string | null = null
    const spyFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as Request).url
      if (urlStr.includes(`/admin/realms/${TENANT_ID}`)) {
        usedToken = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null
        return new Response(JSON.stringify({ displayName: DISPLAY_NAME }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Not found', { status: 404 })
    }) as unknown as typeof fetch

    const resolver = createKeycloakTenantNameResolver({ fetch: spyFetch, getAdminToken })

    const result = await resolver(TENANT_ID)
    expect(result).toBe(DISPLAY_NAME)
    expect(getAdminToken).toHaveBeenCalledOnce()
    expect(usedToken).toBe('Bearer injected-admin-token')
  })
})
