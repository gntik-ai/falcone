import { validateToken } from '../../api/backup-status.auth.js'

export interface SecondActorVerificationResult {
  valid: boolean
  secondActorId?: string
  error?: 'invalid_token' | 'insufficient_role' | 'same_actor' | 'no_tenant_access'
}

function hasSuperadminRole(scopes: string[]): boolean {
  return scopes.includes('superadmin') || scopes.includes('backup:restore:global')
}

function hasTenantAccess(claims: { tenantId?: string; tenant_ids?: string[]; tenants?: string[] }, tenantId: string): boolean {
  if (claims.tenantId === tenantId) return true
  if (Array.isArray(claims.tenant_ids) && claims.tenant_ids.includes(tenantId)) return true
  if (Array.isArray(claims.tenants) && claims.tenants.includes(tenantId)) return true
  return false
}

export async function verifySecondActor(
  secondActorToken: string,
  requesterId: string,
  tenantId: string,
): Promise<SecondActorVerificationResult> {
  try {
    const claims = await validateToken(secondActorToken)
    if (claims.sub === requesterId) {
      return { valid: false, error: 'same_actor' }
    }

    if (!hasSuperadminRole(claims.scopes)) {
      return { valid: false, error: 'insufficient_role' }
    }

    if (!hasTenantAccess(claims as { tenantId?: string; tenant_ids?: string[]; tenants?: string[] }, tenantId)) {
      return { valid: false, error: 'no_tenant_access' }
    }

    return { valid: true, secondActorId: claims.sub }
  } catch {
    return { valid: false, error: 'invalid_token' }
  }
}
