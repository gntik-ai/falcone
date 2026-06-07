import { validateToken, AuthError } from './backup-status.auth.js'
import { confirm, getStatus, ConfirmationError, toSnakeCaseConfirm } from '../confirmations/confirmations.service.js'
import { createKeycloakTenantNameResolver, type TenantNameResolverDeps } from '../confirmations/tenant-name-resolver.js'

interface ActionParams {
  __ow_headers?: Record<string, string>
  __ow_method?: string
  __ow_body?: string
  __ow_path?: string
  confirmation_request_id?: string
  /**
   * Injection seam: supply an authoritative tenant-name resolver.
   * In production this is left unset and the action creates a Keycloak-backed
   * resolver from env vars.  In unit tests a fake resolver is injected here so
   * the test does not need a live Keycloak instance or a real database.
   */
  _tenantNameResolverDeps?: TenantNameResolverDeps & {
    resolveTenantName?: (tenantId: string) => Promise<string> | string
  }
}

export async function main(params: ActionParams) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

  try {
    const auth = params.__ow_headers?.authorization ?? params.__ow_headers?.Authorization
    const rawToken = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    if (!rawToken) return { statusCode: 401, headers, body: { error: 'Missing authorization' } }

    const token = await validateToken(rawToken)
    if (!token.scopes.includes('backup:restore:global') && !token.scopes.includes('superadmin')) {
      return { statusCode: 403, headers, body: { error: 'Insufficient scope' } }
    }

    const isSuperadmin = token.scopes.includes('superadmin')
    const actor = { sub: token.sub, tenantId: token.tenantId, role: isSuperadmin ? 'superadmin' : 'sre', scopes: token.scopes }
    const method = (params.__ow_method ?? 'POST').toUpperCase()

    if (method === 'GET') {
      const requestId = params.confirmation_request_id ?? params.__ow_path?.split('/').filter(Boolean).pop()
      if (!requestId) {
        return { statusCode: 400, headers, body: { error: 'Missing confirmation_request_id' } }
      }
      // getStatus enforces tenant isolation internally (actor.tenantId must match request.tenantId)
      const status = await getStatus(requestId, actor)
      return {
        statusCode: 200,
        headers,
        body: {
          schema_version: status.schemaVersion,
          id: status.id,
          status: status.status,
          risk_level: status.riskLevel,
          expires_at: status.expiresAt.toISOString(),
          created_at: status.createdAt.toISOString(),
        },
      }
    }

    if (!params.__ow_body) {
      return { statusCode: 400, headers, body: { error: 'Missing request body' } }
    }

    const body = JSON.parse(Buffer.from(params.__ow_body, 'base64').toString()) as Record<string, unknown>
    if (typeof body.confirmation_token !== 'string' || typeof body.confirmed !== 'boolean') {
      return { statusCode: 400, headers, body: { error: 'Missing required fields: confirmation_token, confirmed' } }
    }

    // Tenant binding: if body includes tenant_id, it must match the token's verified tenant
    // unless the caller holds a platform-level cross-tenant privilege (superadmin scope).
    if (typeof body.tenant_id === 'string' && !isSuperadmin) {
      if (body.tenant_id !== token.tenantId) {
        return { statusCode: 403, headers, body: { error: 'Tenant mismatch: restore target tenant does not match authenticated tenant' } }
      }
    }

    // Authoritative tenant-name resolver: injected via params for tests,
    // or created from Keycloak admin env vars in production.
    const tenantNameResolver = params._tenantNameResolverDeps?.resolveTenantName
      ?? createKeycloakTenantNameResolver(params._tenantNameResolverDeps)

    const response = await confirm(
      {
        confirmationToken: body.confirmation_token,
        confirmed: body.confirmed,
        tenantNameConfirmation: typeof body.tenant_name_confirmation === 'string' ? body.tenant_name_confirmation : undefined,
        acknowledgeWarnings: body.acknowledge_warnings === true,
        secondFactorType: body.second_factor_type as 'otp' | 'second_actor' | undefined,
        otpCode: typeof body.otp_code === 'string' ? body.otp_code : undefined,
        secondActorToken: typeof body.second_actor_token === 'string' ? body.second_actor_token : undefined,
      },
      actor,
      undefined,
      tenantNameResolver,
    )

    return { statusCode: response.status === 'aborted' ? 200 : 202, headers, body: toSnakeCaseConfirm(response) }
  } catch (err) {
    if (err instanceof ConfirmationError) {
      return { statusCode: err.statusCode, headers, body: { error: err.code, ...err.detail } }
    }
    if (err instanceof AuthError) {
      return { statusCode: err.statusCode, headers, body: { error: err.message } }
    }
    console.error('[confirm-restore] unexpected error:', err)
    return { statusCode: 500, headers, body: { error: 'Internal server error' } }
  }
}
