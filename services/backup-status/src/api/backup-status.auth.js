/**
 * JWT validation and scope enforcement for backup-status API.
 *
 * Production path: full cryptographic verification via jose + jwks-rsa.
 * TEST_MODE path: base64url payload parsing — refused in NODE_ENV=production.
 * Injectable JWKS override: _setJwksOverride(fn) for unit tests (no network).
 */
import { jwtVerify } from 'jose'
import jwksClient from 'jwks-rsa'

// Injectable override for unit tests.
let _jwksOverride = null

export function _setJwksOverride(fn) {
  _jwksOverride = fn
}

// Lazily-built JWKS key-set (cached per module instance).
let _remoteJwks = null

function getJwks() {
  if (_jwksOverride) return _jwksOverride
  if (_remoteJwks) return _remoteJwks

  const jwksUrl = process.env.KEYCLOAK_JWKS_URL
  if (!jwksUrl) throw new AuthError(500, 'JWKS URL not configured')

  const client = jwksClient({ jwksUri: jwksUrl, cache: true, cacheMaxAge: 600_000 })

  _remoteJwks = async (header) => {
    const kid = header.kid
    const signingKey = await client.getSigningKey(kid)
    const publicKey = signingKey.getPublicKey()
    const { createPublicKey } = await import('node:crypto')
    return createPublicKey(publicKey)
  }

  return _remoteJwks
}

/**
 * Validate a JWT token and return claims.
 */
export async function validateToken(token) {
  const testMode = process.env.TEST_MODE === 'true'
  const isProd = process.env.NODE_ENV === 'production'

  // TEST_MODE is not allowed in production — mis-configuration guard.
  if (isProd && testMode) {
    throw new AuthError(500, 'TEST_MODE is not permitted in NODE_ENV=production')
  }

  if (testMode) {
    try {
      const parts = token.split('.')
      const payload = JSON.parse(Buffer.from(parts[1] ?? parts[0], 'base64url').toString())
      return {
        sub: payload.sub ?? 'test-user',
        tenantId: payload.tenant_id ?? payload.tenantId,
        actorType: payload.actor_type ?? payload.actorType,
        scopes: payload.scopes ?? payload.scope?.split(' ') ?? [],
        exp: payload.exp ?? Math.floor(Date.now() / 1000) + 3600,
        iat: payload.iat ?? Math.floor(Date.now() / 1000),
      }
    } catch {
      throw new AuthError(401, 'Invalid token format')
    }
  }

  // --- Full cryptographic verification ---
  const jwksUrl = process.env.KEYCLOAK_JWKS_URL
  if (!jwksUrl) {
    throw new AuthError(500, 'JWKS URL not configured')
  }

  const issuer = process.env.KEYCLOAK_ISSUER
  const audience = process.env.KEYCLOAK_AUDIENCE

  try {
    const jwks = getJwks()
    const { payload } = await jwtVerify(token, jwks, {
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {}),
      clockTolerance: '5 seconds',
    })

    const rawScopes = Array.isArray(payload.scopes)
      ? payload.scopes
      : typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter(Boolean)
        : []

    return {
      sub: payload.sub ?? '',
      tenantId: payload.tenant_id ?? payload.tenantId,
      actorType: payload.actor_type ?? payload.actorType,
      scopes: rawScopes,
      exp: payload.exp ?? 0,
      iat: payload.iat ?? 0,
    }
  } catch (err) {
    if (err instanceof AuthError) throw err
    throw new AuthError(401, 'Invalid or expired token')
  }
}

export function enforceScope(claims, requiredScope) {
  if (!claims.scopes.includes(requiredScope)) {
    throw new AuthError(403, `Missing required scope: ${requiredScope}`)
  }
}

export class AuthError extends Error {
  statusCode

  constructor(statusCode, message) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = statusCode
  }
}
