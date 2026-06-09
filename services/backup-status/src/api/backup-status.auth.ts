/**
 * JWT validation and scope enforcement for backup-status API.
 *
 * Production path: full cryptographic verification via jose + jwks-rsa,
 * mirroring services/realtime-gateway/src/auth/token-validator.mjs::createTokenValidator.
 *
 * TEST_MODE path: base64url payload parsing (no signature check). Refused if
 * NODE_ENV === 'production' to prevent accidental mis-configuration.
 *
 * Injectable JWKS override: export _setJwksOverride(fn) to allow unit tests to
 * supply a local key-set without network calls.
 */

import { jwtVerify, decodeProtectedHeader, type JWTVerifyGetKey, createLocalJWKSet } from 'jose'
import jwksClient from 'jwks-rsa'

export interface TokenClaims {
  sub: string
  tenantId?: string
  actorType?: string
  scopes: string[]
  exp: number
  iat: number
}

// ---------------------------------------------------------------------------
// Environment — read once at module load so we capture startup config.
// The JWKS key-set is built lazily (first request) so tests that set env
// vars before importing still get the correct values.
// ---------------------------------------------------------------------------

const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const IS_TEST_MODE = process.env.TEST_MODE === 'true'

// Injectable override for unit tests (no network required).
let _jwksOverride: JWTVerifyGetKey | null = null

export function _setJwksOverride(fn: JWTVerifyGetKey | null): void {
  _jwksOverride = fn
}

// Lazily-built JWKS key-set (cached per-import-instance).
let _remoteJwks: JWTVerifyGetKey | null = null

function getJwks(): JWTVerifyGetKey {
  if (_jwksOverride) return _jwksOverride
  if (_remoteJwks) return _remoteJwks

  const jwksUrl = process.env.KEYCLOAK_JWKS_URL
  if (!jwksUrl) throw new AuthError(500, 'JWKS URL not configured')

  // Build a jwks-rsa client and wrap it as a jose-compatible key getter.
  const client = jwksClient({ jwksUri: jwksUrl, cache: true, cacheMaxAge: 600_000 })

  _remoteJwks = async (header) => {
    const kid = header.kid
    const signingKey = await client.getSigningKey(kid)
    const publicKey = signingKey.getPublicKey()
    // jose accepts CryptoKey or KeyObject; createPublicKey is available in Node.
    const { createPublicKey } = await import('node:crypto')
    return createPublicKey(publicKey)
  }

  return _remoteJwks
}

/**
 * Validate a JWT token and return claims.
 *
 * In TEST_MODE (non-production only), parses the token as a base64url-encoded
 * JSON payload without signature verification.
 *
 * In production (or when TEST_MODE is not set), performs full JWKS-based
 * cryptographic verification including issuer, audience, exp, and nbf.
 */
export async function validateToken(token: string): Promise<TokenClaims> {
  // Production guard: TEST_MODE must never be accepted in production.
  if (IS_PRODUCTION && IS_TEST_MODE) {
    throw new AuthError(500, 'TEST_MODE is not permitted in NODE_ENV=production')
  }

  // Re-check at call time so env changes after module load (e.g. in tests) are respected.
  const testMode = process.env.TEST_MODE === 'true'
  const isProd = process.env.NODE_ENV === 'production'
  if (isProd && testMode) {
    throw new AuthError(500, 'TEST_MODE is not permitted in NODE_ENV=production')
  }

  // Block TEST_MODE whenever a real JWKS URL is configured — a non-empty KEYCLOAK_JWKS_URL
  // signals a deployment wired to a real IdP (staging, CI, etc.), where unsigned-payload
  // parsing would allow fully-forged token bypass regardless of NODE_ENV.
  const jwksConfigured = !!(process.env.KEYCLOAK_JWKS_URL && process.env.KEYCLOAK_JWKS_URL.trim())
  if (testMode && jwksConfigured) {
    throw new AuthError(500, 'TEST_MODE is not permitted when a JWKS URL is configured')
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

  // --- Production / non-TEST path: full cryptographic verification ---

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

    const rawScopes: string[] = Array.isArray(payload.scopes)
      ? (payload.scopes as string[])
      : typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter(Boolean)
        : []

    return {
      sub: payload.sub ?? '',
      tenantId: (payload as Record<string, unknown>).tenant_id as string | undefined
        ?? (payload as Record<string, unknown>).tenantId as string | undefined,
      actorType: (payload as Record<string, unknown>).actor_type as string | undefined
        ?? (payload as Record<string, unknown>).actorType as string | undefined,
      scopes: rawScopes,
      exp: payload.exp ?? 0,
      iat: payload.iat ?? 0,
    }
  } catch (err) {
    if (err instanceof AuthError) throw err
    throw new AuthError(401, 'Invalid or expired token')
  }
}

export function enforceScope(claims: TokenClaims, requiredScope: string): void {
  if (!claims.scopes.includes(requiredScope)) {
    throw new AuthError(403, `Missing required scope: ${requiredScope}`)
  }
}

export class AuthError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = statusCode
  }
}
