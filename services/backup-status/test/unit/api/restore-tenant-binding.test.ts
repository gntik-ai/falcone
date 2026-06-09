/**
 * Vitest unit tests for scope-restore-to-authenticated-tenant (issue #206)
 *
 * Tests are placed here (not in tests/blackbox/) because:
 *   - initiate-restore.action.ts and confirm-restore.action.ts import
 *     confirmations.service.js (which chains to pg, otp-verifier, network, etc.).
 *     The blackbox runner (`node --test` from repo root) cannot resolve the `.js`
 *     extension → `.ts` source mapping in the TypeScript import convention used by
 *     this service (imports use `.js` suffix but actual files are `.ts`).
 *   - These tests use vi.mock to stub the deep service layer so the action handler's
 *     tenant binding guard can be tested without DB or JWKS calls.
 *
 * Covered scenarios (matching OpenSpec change scope-restore-to-authenticated-tenant):
 *   A1: JWT tenant A + body.tenant_id=B on initiate → 403, initiate() NOT called
 *   A2: JWT tenant A + body.tenant_id=A on initiate → proceeds (scope gate still applies)
 *   A3: superadmin scope can initiate for a different tenant (platform privilege)
 *   B1: JWT tenant A + body.tenant_id=B on confirm → 403, confirm() NOT called
 *   B2: JWT tenant A + body.tenant_id=A on confirm → proceeds past tenant binding
 *   C1: getStatus for B's request by actor A → 403 (no cross-tenant status reveal)
 *   D1: resolveTenantName with no resolver wired → error (no echo of raw tenantId)
 *   D2: confirm with raw tenantId as tenantNameConfirmation when resolver wired → 422
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

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

// ---------------------------------------------------------------------------
// A + B: Action handler tests — confirmations service is mocked
// ---------------------------------------------------------------------------

// Spy containers used across tests
const initiateStub = vi.fn()
const confirmStub = vi.fn()
const getStatusStub = vi.fn()

vi.mock('../../../src/confirmations/confirmations.service.js', () => {
  class ConfirmationError extends Error {
    statusCode: number
    code: string
    detail?: Record<string, unknown>
    constructor(statusCode: number, code: string, detail?: Record<string, unknown>) {
      super(code)
      this.statusCode = statusCode
      this.code = code
      this.detail = detail
    }
  }

  return {
    initiate: initiateStub,
    confirm: confirmStub,
    getStatus: getStatusStub,
    ConfirmationError,
    toSnakeCaseInitiate: (r: unknown) => r,
    toSnakeCaseConfirm: (r: unknown) => r,
  }
})

vi.mock('../../../src/adapters/registry.js', () => ({
  adapterRegistry: { get: vi.fn().mockReturnValue(null) },
  isActionAdapter: vi.fn().mockReturnValue(false),
}))

vi.mock('../../../src/operations/operations.repository.js', () => ({
  findActive: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ id: 'op-mock-1', acceptedAt: new Date() }),
}))

vi.stubEnv('TEST_MODE', 'true')
vi.stubEnv('KEYCLOAK_JWKS_URL', '')

// ---------------------------------------------------------------------------
// A: initiate-restore tenant binding
// ---------------------------------------------------------------------------

describe('initiate-restore: tenant binding', () => {
  let main: (params: unknown) => Promise<{ statusCode: number; body: unknown }>

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('TEST_MODE', 'true')
    initiateStub.mockClear()
    const actionMod = await import('../../../src/api/initiate-restore.action.js') as any
    main = actionMod.main
  })

  function makeInitiateParams(tokenTenantId: string, bodyTenantId: string, scopes?: string[]) {
    const rawToken = makeToken(tokenTenantId, scopes)
    const body = {
      tenant_id: bodyTenantId,
      component_type: 'postgres',
      instance_id: 'inst-1',
      snapshot_id: 'snap-1',
    }
    return {
      __ow_headers: { authorization: `Bearer ${rawToken}` },
      __ow_body: Buffer.from(JSON.stringify(body)).toString('base64'),
    }
  }

  it('A1: JWT tenant A + body.tenant_id=B → 403 BEFORE initiate()', async () => {
    const params = makeInitiateParams(TENANT_A, TENANT_B)
    const result = await main(params)

    expect(result.statusCode).toBe(403)
    expect(initiateStub).not.toHaveBeenCalled()
  })

  it('A2: JWT tenant A + body.tenant_id=A → proceeds past tenant binding', async () => {
    initiateStub.mockResolvedValueOnce({
      schemaVersion: '2',
      confirmationToken: 'tok',
      confirmationRequestId: 'req-1',
      expiresAt: new Date(),
      ttlSeconds: 300,
      riskLevel: 'normal',
      availableSecondFactors: [],
      prechecks: [],
      warnings: [],
      target: {
        tenantId: TENANT_A,
        tenantName: 'Tenant A',
        componentType: 'postgres',
        instanceId: 'inst-1',
        snapshotId: 'snap-1',
        snapshotCreatedAt: new Date(),
        snapshotAgeHours: 1,
      },
    })

    const params = makeInitiateParams(TENANT_A, TENANT_A)
    const result = await main(params)

    expect(result.statusCode).not.toBe(403)
    expect(initiateStub).toHaveBeenCalledOnce()
  })

  it('A3: superadmin scope CAN initiate for a different tenant (platform privilege)', async () => {
    initiateStub.mockResolvedValueOnce({
      schemaVersion: '2',
      confirmationToken: 'tok',
      confirmationRequestId: 'req-1',
      expiresAt: new Date(),
      ttlSeconds: 300,
      riskLevel: 'normal',
      availableSecondFactors: [],
      prechecks: [],
      warnings: [],
      target: {
        tenantId: TENANT_B,
        tenantName: 'Tenant B',
        componentType: 'postgres',
        instanceId: 'inst-1',
        snapshotId: 'snap-1',
        snapshotCreatedAt: new Date(),
        snapshotAgeHours: 1,
      },
    })

    const params = makeInitiateParams(TENANT_A, TENANT_B, ['backup:restore:global', 'superadmin'])
    const result = await main(params)

    // superadmin → cross-tenant is allowed
    expect(result.statusCode).not.toBe(403)
    expect(initiateStub).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// B: confirm-restore tenant binding
// ---------------------------------------------------------------------------

describe('confirm-restore: tenant binding', () => {
  let main: (params: unknown) => Promise<{ statusCode: number; body: unknown }>

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('TEST_MODE', 'true')
    confirmStub.mockClear()
    const actionMod = await import('../../../src/api/confirm-restore.action.js') as any
    main = actionMod.main
  })

  it('B1: JWT tenant A + body.tenant_id=B on confirm → 403 BEFORE confirm()', async () => {
    const rawToken = makeToken(TENANT_A)
    const body = { tenant_id: TENANT_B, confirmation_token: 'tok', confirmed: true }
    const params = {
      __ow_headers: { authorization: `Bearer ${rawToken}` },
      __ow_method: 'POST',
      __ow_body: Buffer.from(JSON.stringify(body)).toString('base64'),
    }

    const result = await main(params)

    expect(result.statusCode).toBe(403)
    expect(confirmStub).not.toHaveBeenCalled()
  })

  it('B2: JWT tenant A + body.tenant_id=A on confirm → proceeds past tenant binding', async () => {
    confirmStub.mockResolvedValueOnce({
      schemaVersion: '2',
      operationId: 'op-1',
      status: 'accepted',
      acceptedAt: new Date(),
      confirmationRequestId: 'req-1',
    })

    const rawToken = makeToken(TENANT_A)
    const body = { tenant_id: TENANT_A, confirmation_token: 'tok', confirmed: true }
    const params = {
      __ow_headers: { authorization: `Bearer ${rawToken}` },
      __ow_method: 'POST',
      __ow_body: Buffer.from(JSON.stringify(body)).toString('base64'),
    }

    const result = await main(params)

    expect(result.statusCode).not.toBe(403)
    expect(confirmStub).toHaveBeenCalledOnce()
  })

  it('B3: omitting tenant_id entirely → 400 (required field), confirm() NOT called', async () => {
    const rawToken = makeToken(TENANT_A)
    // tenant_id deliberately omitted — the core bypass vector
    const body = { confirmation_token: 'tok', confirmed: true }
    const params = {
      __ow_headers: { authorization: `Bearer ${rawToken}` },
      __ow_method: 'POST',
      __ow_body: Buffer.from(JSON.stringify(body)).toString('base64'),
    }

    const result = await main(params)

    expect(result.statusCode).toBe(400)
    expect(confirmStub).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// E: ConfirmationsService.confirm — service-layer tenant gate (issue #252)
// Tests the ConfirmationsService class directly, bypassing the action-layer mock.
// ---------------------------------------------------------------------------

describe('ConfirmationsService.confirm: tenant gate', () => {
  function makeConfirmService(tenantId: string) {
    return async (overrides: { isSuperadmin?: boolean } = {}) => {
      const { ConfirmationsService, ConfirmationError } = (await vi.importActual(
        '../../../src/confirmations/confirmations.service.js',
      )) as typeof import('../../../src/confirmations/confirmations.service.js')

      const fakeRequest: any = {
        id: 'req-b-1',
        tenantId: TENANT_B, // request belongs to tenant B
        requesterId: 'user-b',
        requesterRole: 'sre',
        status: 'pending_confirmation',
        riskLevel: 'normal',
        expiresAt: new Date(Date.now() + 300_000),
        createdAt: new Date(),
        prechecksResult: [],
        warningsShown: [],
        availableSecondFactors: [],
        componentType: 'postgres',
        instanceId: 'inst-1',
        snapshotId: 'snap-1',
        scope: 'partial',
        tokenHash: 'hash',
      }

      const fakeRepo: any = {
        findByTokenHash: vi.fn().mockResolvedValue(fakeRequest),
        updateDecision: vi.fn(),
      }
      const fakeAudit = { emitAuditEvent: vi.fn() }
      const fakeDispatcher = { dispatch: vi.fn().mockResolvedValue(undefined) }
      const fakeConfig: any = {
        ttlSeconds: 300,
        precheckTimeoutMs: 10_000,
        snapshotAgeWarningHours: 48,
        criticalMultiWarningThreshold: 3,
        operationalHoursEnabled: false,
        operationalHoursStart: '08:00',
        operationalHoursEnd: '20:00',
        mfaEnabled: false,
        keycloakOtpVerifyUrl: '',
        resolveTenantName: async (_: string) => 'Tenant B',
      }

      const service = new ConfirmationsService(fakeRepo, fakeAudit, fakeDispatcher, fakeConfig)
      const scopes = overrides.isSuperadmin
        ? ['backup:restore:global', 'superadmin']
        : ['backup:restore:global']
      const actor = { sub: `user-${tenantId.slice(0, 8)}`, tenantId, role: overrides.isSuperadmin ? 'superadmin' : 'sre', scopes }
      return { service, actor, fakeRepo, fakeAudit, ConfirmationError }
    }
  }

  it('E1: actor tenant A confirms request from tenant B (no superadmin) → 403, no state change', async () => {
    const build = makeConfirmService(TENANT_A)
    const { service, actor } = await build()

    const body = {
      confirmationToken: 'tok',
      confirmed: true,
      tenantNameConfirmation: 'Tenant B',
      acknowledgeWarnings: true,
    }

    await expect(service.confirm(body, actor)).rejects.toMatchObject({
      statusCode: 403,
      code: 'access_denied',
    })
  })

  it('E2: superadmin actor with mismatched tenant passes the service-layer gate', async () => {
    const build = makeConfirmService(TENANT_A)
    const { service, actor, fakeRepo } = await build({ isSuperadmin: true })

    // updateDecision called means the gate did not block
    fakeRepo.updateDecision.mockResolvedValue(undefined)

    const body = {
      confirmationToken: 'tok',
      confirmed: false, // abort path — simplest valid flow past the gate
    }

    // Superadmin aborting a cross-tenant request must NOT throw 403
    const result = await service.confirm(body, actor)
    expect(result.status).toBe('aborted')
  })
})

// ---------------------------------------------------------------------------
// C: getStatus — tenant isolation
// Tests the ConfirmationsService class directly (NOT through the mock above),
// so we use a separate dynamic import that bypasses the module-level vi.mock.
// ---------------------------------------------------------------------------

describe('ConfirmationsService.getStatus: tenant isolation', () => {
  it('C1: actor A cannot read tenant B request status → 403', async () => {
    // Use importOriginal-like approach: get the real ConfirmationsService
    // by importing confirmations.service.ts directly (bypassing the mock)
    const { ConfirmationsService, ConfirmationError } = (await vi.importActual(
      '../../../src/confirmations/confirmations.service.js',
    )) as typeof import('../../../src/confirmations/confirmations.service.js')

    const fakeRequest = {
      id: 'req-b-1',
      tenantId: TENANT_B,
      requesterId: 'user-b',
      requesterRole: 'sre',
      status: 'pending_confirmation',
      riskLevel: 'normal',
      expiresAt: new Date(Date.now() + 300_000),
      createdAt: new Date(),
    }

    const fakeRepo = { findById: vi.fn().mockResolvedValue(fakeRequest) } as any
    const fakeAudit = { emitAuditEvent: vi.fn() }
    const fakeDispatcher = { dispatch: vi.fn() }
    const fakeConfig: any = {
      ttlSeconds: 300,
      precheckTimeoutMs: 10_000,
      snapshotAgeWarningHours: 48,
      criticalMultiWarningThreshold: 3,
      operationalHoursEnabled: false,
      operationalHoursStart: '08:00',
      operationalHoursEnd: '20:00',
      mfaEnabled: false,
      keycloakOtpVerifyUrl: '',
    }

    const service = new ConfirmationsService(fakeRepo, fakeAudit, fakeDispatcher, fakeConfig)

    const actorA = { sub: 'user-a', tenantId: TENANT_A, role: 'sre', scopes: ['backup:restore:global'] }

    // Actor A tries to read tenant B's request → must get 403
    await expect(service.getStatus('req-b-1', actorA)).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ---------------------------------------------------------------------------
// D: resolveTenantName — fail-safe (no echo default)
// ---------------------------------------------------------------------------

describe('ConfirmationsService.resolveTenantName: fail-safe', () => {
  it('D1: resolveTenantName with no resolver throws instead of echoing tenantId', async () => {
    const { ConfirmationsService } = (await vi.importActual(
      '../../../src/confirmations/confirmations.service.js',
    )) as typeof import('../../../src/confirmations/confirmations.service.js')

    const fakeRepo: any = { findById: vi.fn(), create: vi.fn(), findByTokenHash: vi.fn() }
    const fakeAudit = { emitAuditEvent: vi.fn() }
    const fakeDispatcher = { dispatch: vi.fn() }
    const fakeConfig: any = {
      ttlSeconds: 300,
      precheckTimeoutMs: 10_000,
      snapshotAgeWarningHours: 48,
      criticalMultiWarningThreshold: 3,
      operationalHoursEnabled: false,
      operationalHoursStart: '08:00',
      operationalHoursEnd: '20:00',
      mfaEnabled: false,
      keycloakOtpVerifyUrl: '',
      // No resolveTenantName: must throw, NOT echo tenantId
    }

    const service = new ConfirmationsService(fakeRepo, fakeAudit, fakeDispatcher, fakeConfig)

    // Pre-fix: returns tenantId as-is (the raw UUID is echoed back)
    // Post-fix: throws a configuration error
    await expect((service as any).resolveTenantName(TENANT_A)).rejects.toThrow()
  })

  it('D2: confirm with raw tenantId as tenantNameConfirmation (resolver wired) → 422', async () => {
    const { ConfirmationsService, ConfirmationError } = (await vi.importActual(
      '../../../src/confirmations/confirmations.service.js',
    )) as typeof import('../../../src/confirmations/confirmations.service.js')

    const fakeRequest: any = {
      id: 'req-a-1',
      tenantId: TENANT_A,
      requesterId: 'user-a',
      requesterRole: 'sre',
      status: 'pending_confirmation',
      riskLevel: 'normal',
      expiresAt: new Date(Date.now() + 300_000),
      createdAt: new Date(),
      prechecksResult: [],
      warningsShown: [],
      availableSecondFactors: [],
      componentType: 'postgres',
      instanceId: 'inst-1',
      snapshotId: 'snap-1',
      scope: 'partial',
      tokenHash: 'hash',
    }

    const fakeRepo: any = {
      findByTokenHash: vi.fn().mockResolvedValue(fakeRequest),
      updateDecision: vi.fn(),
    }
    const fakeAudit = { emitAuditEvent: vi.fn() }
    const fakeDispatcher = { dispatch: vi.fn() }
    const fakeConfig: any = {
      ttlSeconds: 300,
      precheckTimeoutMs: 10_000,
      snapshotAgeWarningHours: 48,
      criticalMultiWarningThreshold: 3,
      operationalHoursEnabled: false,
      operationalHoursStart: '08:00',
      operationalHoursEnd: '20:00',
      mfaEnabled: false,
      keycloakOtpVerifyUrl: '',
      // Resolver is wired and returns a display name (not the raw UUID)
      resolveTenantName: async (_: string) => 'Acme Corp',
    }

    const service = new ConfirmationsService(fakeRepo, fakeAudit, fakeDispatcher, fakeConfig)
    const actorA = { sub: 'user-a', tenantId: TENANT_A, role: 'sre', scopes: ['backup:restore:global'] }

    // Supply raw UUID as tenantNameConfirmation → must fail 422 (mismatch with 'Acme Corp')
    const body = {
      confirmationToken: 'tok',
      confirmed: true,
      tenantNameConfirmation: TENANT_A, // raw UUID, not 'Acme Corp'
      acknowledgeWarnings: true,
    }

    await expect(service.confirm(body, actorA)).rejects.toMatchObject({
      statusCode: 422,
      code: 'tenant_name_confirmation_mismatch',
    })
  })
})
