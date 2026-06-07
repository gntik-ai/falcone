/**
 * Authoritative tenant-name resolver backed by the Keycloak admin API.
 *
 * Rationale: in this system the Keycloak realm name equals the tenantId
 * (see services/provisioning-orchestrator/src/reprovision/identifier-map.mjs::deriveIamRealm
 * which returns tenantId directly).  The human-readable name of the tenant is
 * the realm's `displayName` field — it is the ONLY authoritative source we can
 * compare `tenant_name_confirmation` against.
 *
 * Security contract (FAIL CLOSED):
 *   - If any required env var is missing           → throw ConfirmationError(500, 'tenant_name_resolver_unavailable')
 *   - If the admin-token fetch fails               → throw ConfirmationError(500, 'tenant_name_resolver_unavailable')
 *   - If the realm endpoint returns non-2xx        → throw ConfirmationError(500, 'tenant_name_resolver_unavailable')
 *   - If `displayName` is absent or empty          → throw ConfirmationError(500, 'tenant_name_resolver_unavailable')
 *   - Under NO circumstances is the raw tenantId   returned as a fallback.
 *
 * The HTTP layer is injectable via `deps.fetch` and `deps.getAdminToken` so
 * unit tests can supply fakes without network access.
 * A small in-memory TTL cache (5 min) avoids hitting Keycloak on every request.
 */

import { ConfirmationError } from './confirmations.service.js'

// ---------------------------------------------------------------------------
// Injectable dependencies interface
// ---------------------------------------------------------------------------

export interface TenantNameResolverDeps {
  /**
   * HTTP fetch implementation.  Defaults to the global `fetch`.
   */
  fetch?: typeof fetch
  /**
   * Returns a bearer token for Keycloak admin API calls.
   * If omitted, the default client-credentials flow is used.
   */
  getAdminToken?: (deps?: { fetch?: typeof fetch }) => Promise<string>
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CacheEntry {
  displayName: string
  expiresAt: number
}

interface ResolverConfig {
  adminBaseUrl: string
  tokenUrl: string
  clientId: string
  clientSecret: string
}

// ---------------------------------------------------------------------------
// TTL cache
// ---------------------------------------------------------------------------

const TTL_MS = 5 * 60 * 1000 // 5 minutes

function makeCache(): Map<string, CacheEntry> {
  return new Map()
}

// ---------------------------------------------------------------------------
// Helper: obtain an admin access token via client-credentials
// ---------------------------------------------------------------------------

async function fetchAdminToken(
  config: Pick<ResolverConfig, 'tokenUrl' | 'clientId' | 'clientSecret'>,
  fetchFn: typeof fetch,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    })
    const res = await fetchFn(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new ConfirmationError(500, 'tenant_name_resolver_unavailable', {
        detail: `admin token request failed with HTTP ${res.status}`,
      })
    }
    const data = await res.json() as Record<string, unknown>
    const token = data.access_token
    if (typeof token !== 'string' || !token) {
      throw new ConfirmationError(500, 'tenant_name_resolver_unavailable', {
        detail: 'admin token response did not contain access_token',
      })
    }
    return token
  } catch (err) {
    if (err instanceof ConfirmationError) throw err
    throw new ConfirmationError(500, 'tenant_name_resolver_unavailable', {
      detail: 'admin token fetch error',
    })
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Returns an authoritative resolver that fetches the Keycloak realm displayName.
 *
 * Required environment variables (read at call time so tests can stub them):
 *   KEYCLOAK_ADMIN_BASE_URL    — e.g. https://keycloak.internal/auth
 *   KEYCLOAK_ADMIN_TOKEN_URL   — e.g. https://keycloak.internal/auth/realms/master/protocol/openid-connect/token
 *   KEYCLOAK_ADMIN_CLIENT_ID   — client id with realm admin read rights
 *   KEYCLOAK_ADMIN_CLIENT_SECRET
 *
 * @param deps Optional injectable dependencies (fetch, getAdminToken) for testing.
 */
export function createKeycloakTenantNameResolver(
  deps?: TenantNameResolverDeps,
): (tenantId: string) => Promise<string> {
  const cache: Map<string, CacheEntry> = makeCache()

  return async function resolveKeycloakTenantName(tenantId: string): Promise<string> {
    // --- Config validation (fail closed) ---
    const adminBaseUrl = process.env.KEYCLOAK_ADMIN_BASE_URL
    const tokenUrl = process.env.KEYCLOAK_ADMIN_TOKEN_URL
    const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID
    const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET

    if (!adminBaseUrl || !tokenUrl || !clientId || !clientSecret) {
      throw new ConfirmationError(500, 'tenant_name_resolver_unavailable', {
        detail: 'missing required KEYCLOAK_ADMIN_* environment variables',
      })
    }

    // --- Cache hit ---
    const now = Date.now()
    const cached = cache.get(tenantId)
    if (cached && cached.expiresAt > now) {
      return cached.displayName
    }

    const fetchFn = deps?.fetch ?? fetch
    const config: ResolverConfig = { adminBaseUrl, tokenUrl, clientId, clientSecret }

    // --- Obtain admin token ---
    let adminToken: string
    if (deps?.getAdminToken) {
      try {
        adminToken = await deps.getAdminToken({ fetch: fetchFn })
      } catch (err) {
        if (err instanceof ConfirmationError) throw err
        throw new ConfirmationError(500, 'tenant_name_resolver_unavailable', {
          detail: 'getAdminToken failed',
        })
      }
    } else {
      adminToken = await fetchAdminToken(config, fetchFn)
    }

    // --- Fetch realm info ---
    const realmUrl = `${adminBaseUrl.replace(/\/+$/, '')}/admin/realms/${encodeURIComponent(tenantId)}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    let realmData: Record<string, unknown>
    try {
      const res = await fetchFn(realmUrl, {
        headers: { Authorization: `Bearer ${adminToken}`, Accept: 'application/json' },
        signal: controller.signal,
      })
      if (res.status === 404) {
        throw new ConfirmationError(500, 'tenant_name_resolver_unavailable', {
          detail: `realm not found: ${tenantId}`,
        })
      }
      if (!res.ok) {
        throw new ConfirmationError(500, 'tenant_name_resolver_unavailable', {
          detail: `realm fetch failed with HTTP ${res.status}`,
        })
      }
      realmData = await res.json() as Record<string, unknown>
    } catch (err) {
      if (err instanceof ConfirmationError) throw err
      throw new ConfirmationError(500, 'tenant_name_resolver_unavailable', {
        detail: 'realm fetch error',
      })
    } finally {
      clearTimeout(timer)
    }

    // --- Extract displayName (fail closed if absent or empty) ---
    const displayName = realmData.displayName
    if (typeof displayName !== 'string' || displayName.trim() === '') {
      throw new ConfirmationError(500, 'tenant_name_resolver_unavailable', {
        detail: `realm '${tenantId}' has no displayName`,
      })
    }

    // --- Populate cache ---
    cache.set(tenantId, { displayName, expiresAt: now + TTL_MS })

    return displayName
  }
}
