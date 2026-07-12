/**
 * Storage E2E auth helper (change: add-seaweedfs-storage-e2e).
 *
 * The control-plane authenticates every request with a Keycloak-signed Bearer JWT and
 * derives the tenant identity from the token's `tenant_id` / `workspace_id` claims (see
 * apps/control-plane/server.mjs `authenticate`). These specs therefore mint a
 * tenant-scoped token per fixture tenant via the OIDC `client_credentials` grant against
 * a Keycloak client whose hardcoded-claim mappers carry that tenant's UUIDs.
 *
 * The token URL + client credentials come from the environment so the suite stays
 * skip-gated by default (no E2E_KC_TOKEN_URL => mintTenantToken returns null => the
 * live-gate skips). For the real run, point E2E_KC_TOKEN_URL at the realm token endpoint
 * and (optionally) override the per-tenant client ids/secrets:
 *
 *   E2E_KC_TOKEN_URL=http://localhost:18080/realms/in-falcone-platform/protocol/openid-connect/token
 *   E2E_KC_CLIENT_ID_A / E2E_KC_CLIENT_SECRET_A   (default e2e-storage-tenant-a / e2e-storage-secret-a)
 *   E2E_KC_CLIENT_ID_B / E2E_KC_CLIENT_SECRET_B   (default e2e-storage-tenant-b / e2e-storage-secret-b)
 */

import type { APIRequestContext } from '@playwright/test'
import { TENANT_B } from './tenant-fixtures'
import type { TenantIdentity } from './storage-api-client'

function clientFor(identity: TenantIdentity): { clientId: string; clientSecret: string } {
  if (identity.tenantId === TENANT_B.tenantId) {
    return {
      clientId: process.env.E2E_KC_CLIENT_ID_B ?? 'e2e-storage-tenant-b',
      clientSecret: process.env.E2E_KC_CLIENT_SECRET_B ?? 'e2e-storage-secret-b',
    }
  }
  return {
    clientId: process.env.E2E_KC_CLIENT_ID_A ?? 'e2e-storage-tenant-a',
    clientSecret: process.env.E2E_KC_CLIENT_SECRET_A ?? 'e2e-storage-secret-a',
  }
}

/**
 * Mint a tenant-scoped Bearer token via Keycloak `client_credentials`.
 * Returns null when E2E_KC_TOKEN_URL is unset or the grant fails — callers treat null
 * as "auth unavailable" and skip the live-gated specs gracefully.
 */
export async function mintTenantToken(
  request: APIRequestContext,
  identity: TenantIdentity,
): Promise<string | null> {
  const tokenUrl = process.env.E2E_KC_TOKEN_URL
  if (!tokenUrl) return null
  const { clientId, clientSecret } = clientFor(identity)
  try {
    const res = await request.post(tokenUrl, {
      form: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret },
    })
    if (!res.ok()) return null
    const body = await res.json()
    return typeof body.access_token === 'string' ? body.access_token : null
  } catch {
    return null
  }
}

/**
 * Whether per-tenant SeaweedFS S3 identities are active (add-seaweedfs-tenant-identities).
 * Cross-tenant object/bucket isolation is enforced at the S3-credential layer, so the
 * cross-tenant assertions only hold when each tenant is signed with its OWN identity.
 * Without it the control-plane proxies with a single shared root credential and does not
 * deny cross-tenant reads — so those probes skip with a clear reason (matching the
 * migration-validation smoke's PER_TENANT_S3_CREDS gate).
 */
export function perTenantS3Enabled(): boolean {
  return process.env.E2E_PER_TENANT_S3 === '1'
}

export const PER_TENANT_S3_SKIP_REASON =
  'Per-tenant SeaweedFS S3 identities are not active (add-seaweedfs-tenant-identities). ' +
  'Cross-tenant isolation is enforced at the S3-credential layer; set E2E_PER_TENANT_S3=1 ' +
  'once per-tenant identities are provisioned to assert the denial probes.'
