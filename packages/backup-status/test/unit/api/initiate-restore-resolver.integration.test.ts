/**
 * Integration-style tests for initiate-restore.action.ts::main that DO NOT mock
 * the ConfirmationsService — they exercise the real service code paths including
 * resolveTenantName.
 *
 * The goal is to prove three things:
 *   1. A same-tenant request with a properly wired fake resolver returns 202
 *      (the legitimate flow does NOT 500 when the resolver is wired).
 *   2. A same-tenant request with NO resolver configured (no env vars, no injected
 *      deps) returns 500 with code 'tenant_name_resolver_unavailable'
 *      (fail-closed, never echoes tenantId).
 *   3. The injection seam (`params._tenantNameResolverDeps.resolveTenantName`)
 *      is the mechanism used by tests to avoid live Keycloak + DB.
 *
 * What IS mocked:
 *   - backup-status.auth (validateToken)
 *   - adapters/registry (adapterRegistry, isActionAdapter)
 *   - operations/operations.repository (findActive)
 *   - confirmations/confirmations.repository (create + findByTokenHash via setClient)
 *   - audit/audit-trail (emitAuditEvent)
 *   - The confirmations SERVICE is NOT mocked — the real code runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted before imports)
// ---------------------------------------------------------------------------

vi.mock('../../../src/api/backup-status.auth.js', () => ({
  validateToken: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number
    constructor(msg: string, code: number) { super(msg); this.statusCode = code }
  },
}))

vi.mock('../../../src/adapters/registry.js', () => ({
  adapterRegistry: { get: vi.fn().mockReturnValue(null) },
  isActionAdapter: vi.fn().mockReturnValue(false),
}))

vi.mock('../../../src/operations/operations.repository.js', () => ({
  findActive: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
}))

vi.mock('../../../src/audit/audit-trail.js', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

// Stub the confirmations repository client so no real DB calls happen.
vi.mock('../../../src/confirmations/confirmations.repository.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/confirmations/confirmations.repository.js')>()
  return {
    ...original,
    ConfirmationsRepository: class FakeRepo {
      async create(data: Record<string, unknown>) {
        return {
          id: 'fake-confirmation-req-1',
          tokenHash: 'fakehash',
          tenantId: data.tenantId,
          componentType: data.componentType,
          instanceId: data.instanceId,
          snapshotId: data.snapshotId,
          requesterId: data.requesterId,
          requesterRole: data.requesterRole,
          scope: data.scope ?? 'partial',
          riskLevel: data.riskLevel ?? 'normal',
          status: 'pending_confirmation',
          prechecksResult: data.prechecksResult ?? [],
          warningsShown: data.warningsShown ?? [],
          availableSecondFactors: data.availableSecondFactors ?? [],
          expiresAt: data.expiresAt ?? new Date(Date.now() + 300_000),
          createdAt: new Date(),
        }
      }
    },
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { validateToken } from '../../../src/api/backup-status.auth.js'

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function makeToken(tenantId: string, scopes: string[] = ['backup:restore:global']) {
  const payload = {
    sub: `user-${tenantId.slice(0, 8)}`,
    tenant_id: tenantId,
    scopes,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  }
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.INVALIDSIGNATURE`
}

function makeParams(tokenTenantId: string, bodyTenantId: string, resolverDeps?: Record<string, unknown>) {
  const rawToken = makeToken(tokenTenantId)
  const body = {
    tenant_id: bodyTenantId,
    component_type: 'postgresql',
    instance_id: 'inst-1',
    snapshot_id: 'snap-1',
  }
  return {
    __ow_headers: { authorization: `Bearer ${rawToken}` },
    __ow_body: Buffer.from(JSON.stringify(body)).toString('base64'),
    ...resolverDeps ? { _tenantNameResolverDeps: resolverDeps } : {},
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('initiate-restore: real ConfirmationsService + resolver injection', () => {
  let main: (params: unknown) => Promise<{ statusCode: number; body: unknown; headers?: unknown }>

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('TEST_MODE', 'true')
    // Clear all Keycloak resolver config so the default (non-injected) resolver
    // fails closed — base URL cannot be derived and admin creds are absent.
    vi.stubEnv('KEYCLOAK_BASE_URL', '')
    vi.stubEnv('KEYCLOAK_JWKS_URL', '')
    vi.stubEnv('KEYCLOAK_ADMIN_CLIENT_ID', '')
    vi.stubEnv('KEYCLOAK_ADMIN_CLIENT_SECRET', '')
    vi.mocked(validateToken).mockResolvedValue({
      sub: `user-${TENANT_A.slice(0, 8)}`,
      tenantId: TENANT_A,
      scopes: ['backup:restore:global'],
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    })
    const actionMod = await import('../../../src/api/initiate-restore.action.js') as unknown as {
      main: (params: unknown) => Promise<{ statusCode: number; body: unknown }>
    }
    main = actionMod.main
  })

  it('INT-01: same-tenant request with injected fake resolver returns 202 (not 500)', async () => {
    // The injected resolver directly provides the display name — no Keycloak needed.
    const params = makeParams(TENANT_A, TENANT_A, {
      resolveTenantName: async (_tenantId: string) => 'Acme Corp',
    })

    const result = await main(params)

    expect(result.statusCode).toBe(202)
    // Must NOT be a resolver error
    expect((result.body as { error?: string }).error).not.toBe('tenant_name_resolver_unavailable')
    expect((result.body as { error?: string }).error).not.toBe('tenant_name_resolver_not_configured')
  })

  it('INT-02: no resolver configured → 500 with tenant_name_resolver_unavailable (fail-closed)', async () => {
    // No _tenantNameResolverDeps → createKeycloakTenantNameResolver() is used
    // but all KEYCLOAK_ADMIN_* env vars are empty → must fail closed.
    const params = makeParams(TENANT_A, TENANT_A)

    const result = await main(params)

    expect(result.statusCode).toBe(500)
    expect((result.body as { error?: string }).error).toBe('tenant_name_resolver_unavailable')
  })

  it('INT-03: no resolver configured → error is NOT the raw tenantId being echoed', async () => {
    // The critical security invariant: the raw tenantId must not be returned silently.
    const params = makeParams(TENANT_A, TENANT_A)

    const result = await main(params)

    // If the echo were in place, status would be 202 with confirmation token.
    // Fail-closed means we get 500, not 202.
    expect(result.statusCode).not.toBe(202)
    // The body must not silently contain a confirmation_token derived from an echo.
    expect((result.body as Record<string, unknown>).confirmation_token).toBeUndefined()
  })
})
