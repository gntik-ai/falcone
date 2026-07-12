/**
 * Reproduction tests for fix-restore-tokenhash-not-credential (issue #267)
 *
 * The bug: ConfirmationsRepository.findByTokenHash accepted already-hashed 64-hex
 * values as if they were raw tokens (passthrough branch). This allowed an attacker
 * who obtained the stored `token_hash` to confirm/abort a restore without the
 * original random token. The module-level `abort()` helper exploited this by
 * passing `request.tokenHash` as the `confirmationToken`.
 *
 * Fix under test:
 *   1. findByTokenHash ALWAYS computes hashToken(input) — hex passthrough removed.
 *   2. confirm({ confirmationToken: storedHash }) → 404 (stored hash rejected).
 *   3. ConfirmationsService.abortById(requestId, actor) aborts without
 *      routing through findByTokenHash at all.
 *   4. Module-level abort() delegates to abortById, never passes tokenHash as
 *      a bearer credential.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  ConfirmationsRepository,
  hashToken,
  setClient,
} from '../../../src/confirmations/confirmations.repository.js'
import {
  ConfirmationsService,
  ConfirmationError,
  abort as moduleAbort,
} from '../../../src/confirmations/confirmations.service.js'
import type { Actor, ConfirmationRequest } from '../../../src/confirmations/confirmations.types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function makeActor(tenantId: string, scopes: string[] = []): Actor {
  return { sub: `user-${tenantId.slice(0, 8)}`, tenantId, role: 'sre', scopes }
}

function makePendingRequest(overrides: Partial<ConfirmationRequest> = {}): ConfirmationRequest {
  return {
    id: 'req-1',
    tokenHash: hashToken('rawTok'),
    tenantId: TENANT_A,
    componentType: 'postgres',
    instanceId: 'inst-1',
    snapshotId: 'snap-1',
    requesterId: 'user-aaaaaaaa',
    requesterRole: 'sre',
    scope: 'partial',
    riskLevel: 'normal',
    status: 'pending_confirmation',
    prechecksResult: [],
    warningsShown: [],
    availableSecondFactors: [],
    expiresAt: new Date(Date.now() + 300_000),
    createdAt: new Date(),
    ...overrides,
  }
}

function makeServiceWithRepo(repo: Partial<ConfirmationsRepository>) {
  const fakeAudit = { emitAuditEvent: vi.fn().mockResolvedValue(undefined) }
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
    resolveTenantName: async () => 'Acme Corp',
  }
  return { service: new ConfirmationsService(repo as ConfirmationsRepository, fakeAudit, fakeDispatcher, fakeConfig), fakeAudit }
}

// ---------------------------------------------------------------------------
// Section 1: ConfirmationsRepository.findByTokenHash — hex passthrough REMOVED
// ---------------------------------------------------------------------------

describe('ConfirmationsRepository.findByTokenHash: hex passthrough is gone', () => {
  const rawTok = 'rawTok'
  const storedHash = hashToken(rawTok)  // the 64-hex value stored in the DB

  beforeEach(() => {
    setClient(null)  // reset between tests
  })

  it('always hashes input before querying — for raw token input', async () => {
    let queriedHash: unknown = null
    const mockDb = {
      query: vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
        queriedHash = params[0]
        return Promise.resolve({ rows: [] })
      }),
    }
    setClient(mockDb as any)

    const repo = new ConfirmationsRepository()
    await repo.findByTokenHash(rawTok)

    // Must query with hashToken('rawTok'), which equals storedHash
    expect(queriedHash).toBe(hashToken(rawTok))
  })

  it('always hashes input before querying — even for 64-hex input (no passthrough)', async () => {
    let queriedHash: unknown = null
    const mockDb = {
      query: vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
        queriedHash = params[0]
        return Promise.resolve({ rows: [] })
      }),
    }
    setClient(mockDb as any)

    const repo = new ConfirmationsRepository()
    // Pass the already-stored 64-hex hash as if it were the token
    await repo.findByTokenHash(storedHash)

    // MUST query hashToken(storedHash), NOT storedHash itself
    expect(queriedHash).toBe(hashToken(storedHash))
    expect(queriedHash).not.toBe(storedHash)
  })

  it('returns the request when called with the original raw token', async () => {
    const request = makePendingRequest({ tokenHash: storedHash })
    const mockDb = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          id: request.id,
          token_hash: request.tokenHash,
          tenant_id: request.tenantId,
          component_type: request.componentType,
          instance_id: request.instanceId,
          snapshot_id: request.snapshotId,
          requester_id: request.requesterId,
          requester_role: request.requesterRole,
          scope: request.scope,
          risk_level: request.riskLevel,
          status: request.status,
          prechecks_result: JSON.stringify(request.prechecksResult),
          warnings_shown: JSON.stringify(request.warningsShown),
          available_second_factors: JSON.stringify(request.availableSecondFactors),
          expires_at: request.expiresAt.toISOString(),
          created_at: request.createdAt.toISOString(),
          decision: null,
          decision_at: null,
          second_factor_type: null,
          second_actor_id: null,
          operation_id: null,
        }],
      }),
    }
    setClient(mockDb as any)

    const repo = new ConfirmationsRepository()
    const result = await repo.findByTokenHash(rawTok)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('req-1')
  })

  it('returns null when called with the stored 64-hex hash (hash of hash ≠ stored hash)', async () => {
    // DB has a row where token_hash = hashToken('rawTok')
    // Query is now hashToken(storedHash) which won't match
    const mockDb = {
      query: vi.fn().mockImplementation((_sql: string, _params: unknown[]) => {
        // simulate: no row matches hashToken(storedHash)
        return Promise.resolve({ rows: [] })
      }),
    }
    setClient(mockDb as any)

    const repo = new ConfirmationsRepository()
    const result = await repo.findByTokenHash(storedHash)
    // The stored 64-hex hash is NOT a valid credential; should return null
    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Section 2: ConfirmationsService.confirm — stored hash rejected as credential
// ---------------------------------------------------------------------------

describe('ConfirmationsService.confirm: stored token_hash rejected as bearer credential', () => {
  it('confirm({ confirmationToken: storedHash }) → 404 not_found', async () => {
    const request = makePendingRequest()
    const storedHash = request.tokenHash  // the 64-hex value in the DB

    // After fix: findByTokenHash(storedHash) computes hashToken(storedHash),
    // which won't match the stored hash, so repo returns null.
    const fakeRepo = {
      findByTokenHash: vi.fn().mockResolvedValue(null),  // hash-of-hash not in DB
      updateDecision: vi.fn(),
    }
    const { service } = makeServiceWithRepo(fakeRepo)
    const actor = makeActor(TENANT_A)

    await expect(
      service.confirm({ confirmationToken: storedHash, confirmed: false }, actor),
    ).rejects.toMatchObject({ statusCode: 404, code: 'confirmation_request_not_found' })
  })

  it('confirm({ confirmationToken: rawToken }) → succeeds (aborts pending)', async () => {
    const request = makePendingRequest()

    const fakeRepo = {
      findByTokenHash: vi.fn().mockResolvedValue(request),
      updateDecision: vi.fn().mockResolvedValue({ ...request, status: 'aborted', decision: 'aborted' }),
    }
    const { service } = makeServiceWithRepo(fakeRepo)
    const actor = makeActor(TENANT_A)

    const result = await service.confirm({ confirmationToken: 'rawTok', confirmed: false }, actor)
    expect(result.status).toBe('aborted')
    expect(result.confirmationRequestId).toBe('req-1')
  })
})

// ---------------------------------------------------------------------------
// Section 3: ConfirmationsService.abortById — new dedicated abort path
// ---------------------------------------------------------------------------

describe('ConfirmationsService.abortById', () => {
  it('aborts a pending request for the same-tenant actor', async () => {
    const request = makePendingRequest()

    const fakeRepo = {
      findById: vi.fn().mockResolvedValue(request),
      updateDecision: vi.fn().mockResolvedValue({ ...request, status: 'aborted', decision: 'aborted' }),
    }
    const { service, fakeAudit } = makeServiceWithRepo(fakeRepo)
    const actor = makeActor(TENANT_A, ['backup:restore:global'])

    const result = await (service as any).abortById('req-1', actor)

    expect(result.status).toBe('aborted')
    expect(result.confirmationRequestId).toBe('req-1')
    expect(fakeRepo.updateDecision).toHaveBeenCalledWith('req-1', 'aborted', {})
    // Audit event must be emitted
    expect(fakeAudit.emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'restore.aborted', result: 'aborted' }),
    )
    // CRITICAL: findByTokenHash must NOT be called
    expect((fakeRepo as any).findByTokenHash).toBeUndefined()
  })

  it('cross-tenant actor → 403 access_denied', async () => {
    const request = makePendingRequest({ tenantId: TENANT_B })

    const fakeRepo = {
      findById: vi.fn().mockResolvedValue(request),
      updateDecision: vi.fn(),
    }
    const { service } = makeServiceWithRepo(fakeRepo)
    const actorA = makeActor(TENANT_A, ['backup:restore:global'])

    await expect((service as any).abortById('req-1', actorA)).rejects.toMatchObject({
      statusCode: 403,
      code: 'access_denied',
    })
    expect(fakeRepo.updateDecision).not.toHaveBeenCalled()
  })

  it('superadmin can abort cross-tenant', async () => {
    const request = makePendingRequest({ tenantId: TENANT_B })

    const fakeRepo = {
      findById: vi.fn().mockResolvedValue(request),
      updateDecision: vi.fn().mockResolvedValue({ ...request, status: 'aborted', decision: 'aborted' }),
    }
    const { service } = makeServiceWithRepo(fakeRepo)
    const superadmin = makeActor(TENANT_A, ['superadmin'])

    const result = await (service as any).abortById('req-1', superadmin)
    expect(result.status).toBe('aborted')
  })

  it('non-existent id → 404', async () => {
    const fakeRepo = {
      findById: vi.fn().mockResolvedValue(null),
      updateDecision: vi.fn(),
    }
    const { service } = makeServiceWithRepo(fakeRepo)
    const actor = makeActor(TENANT_A, ['backup:restore:global'])

    await expect((service as any).abortById('no-such-id', actor)).rejects.toMatchObject({
      statusCode: 404,
      code: 'confirmation_request_not_found',
    })
  })

  it('non-pending status → 409', async () => {
    const request = makePendingRequest({ status: 'confirmed' })

    const fakeRepo = {
      findById: vi.fn().mockResolvedValue(request),
      updateDecision: vi.fn(),
    }
    const { service } = makeServiceWithRepo(fakeRepo)
    const actor = makeActor(TENANT_A, ['backup:restore:global'])

    await expect((service as any).abortById('req-1', actor)).rejects.toMatchObject({
      statusCode: 409,
      code: 'confirmation_request_not_pending',
    })
  })
})

// ---------------------------------------------------------------------------
// Section 4: module-level abort() — delegates to abortById, no hash-as-credential
// ---------------------------------------------------------------------------

describe('module-level abort(): uses abortById, not confirm({ tokenHash })', () => {
  beforeEach(() => {
    setClient(null)
  })

  it('abort() aborts a pending request without passing tokenHash as confirmationToken', async () => {
    const request = makePendingRequest()
    const storedHash = request.tokenHash

    // Wire mock DB: findById returns request; any token-hash query returns nothing
    const queryMock = vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
      const sql = _sql.trim()
      if (sql.includes('WHERE id =')) {
        // findById
        return Promise.resolve({
          rows: [{
            id: request.id,
            token_hash: storedHash,
            tenant_id: request.tenantId,
            component_type: request.componentType,
            instance_id: request.instanceId,
            snapshot_id: request.snapshotId,
            requester_id: request.requesterId,
            requester_role: request.requesterRole,
            scope: request.scope,
            risk_level: request.riskLevel,
            status: request.status,
            prechecks_result: JSON.stringify(request.prechecksResult),
            warnings_shown: JSON.stringify(request.warningsShown),
            available_second_factors: JSON.stringify(request.availableSecondFactors),
            expires_at: request.expiresAt.toISOString(),
            created_at: request.createdAt.toISOString(),
            decision: null,
            decision_at: null,
            second_factor_type: null,
            second_actor_id: null,
            operation_id: null,
          }],
        })
      }
      if (sql.includes('UPDATE')) {
        // updateDecision
        return Promise.resolve({
          rows: [{
            id: request.id,
            token_hash: storedHash,
            tenant_id: request.tenantId,
            component_type: request.componentType,
            instance_id: request.instanceId,
            snapshot_id: request.snapshotId,
            requester_id: request.requesterId,
            requester_role: request.requesterRole,
            scope: request.scope,
            risk_level: request.riskLevel,
            status: 'aborted',
            prechecks_result: JSON.stringify(request.prechecksResult),
            warnings_shown: JSON.stringify(request.warningsShown),
            available_second_factors: JSON.stringify(request.availableSecondFactors),
            expires_at: request.expiresAt.toISOString(),
            created_at: request.createdAt.toISOString(),
            decision: 'aborted',
            decision_at: new Date().toISOString(),
            second_factor_type: null,
            second_actor_id: null,
            operation_id: null,
          }],
        })
      }
      // SELECT by token_hash: should NOT be called in the fixed version
      // Return empty to catch the bug if it is still called with storedHash
      return Promise.resolve({ rows: [] })
    })
    setClient({ query: queryMock } as any)

    const actor = makeActor(TENANT_A, ['backup:restore:global'])
    const result = await moduleAbort('req-1', actor)

    expect(result.status).toBe('aborted')

    // Verify that the DB was never queried with the stored 64-hex hash as a token_hash lookup
    // (i.e. the SELECT by token_hash was never called with the storedHash value).
    const tokenHashLookups = queryMock.mock.calls.filter(
      ([sql, params]: [string, unknown[]]) =>
        sql.includes('WHERE token_hash =') && params[0] === storedHash,
    )
    expect(tokenHashLookups).toHaveLength(0)
  })
})
