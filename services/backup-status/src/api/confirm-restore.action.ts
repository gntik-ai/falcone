import { validateToken, AuthError } from './backup-status.auth.js'
import { confirm, getStatus, ConfirmationError, toSnakeCaseConfirm } from '../confirmations/confirmations.service.js'

interface ActionParams {
  __ow_headers?: Record<string, string>
  __ow_method?: string
  __ow_body?: string
  __ow_path?: string
  confirmation_request_id?: string
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

    const actor = { sub: token.sub, tenantId: token.tenantId, role: token.scopes.includes('superadmin') ? 'superadmin' : 'sre', scopes: token.scopes }
    const method = (params.__ow_method ?? 'POST').toUpperCase()

    if (method === 'GET') {
      const requestId = params.confirmation_request_id ?? params.__ow_path?.split('/').filter(Boolean).pop()
      if (!requestId) {
        return { statusCode: 400, headers, body: { error: 'Missing confirmation_request_id' } }
      }
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
