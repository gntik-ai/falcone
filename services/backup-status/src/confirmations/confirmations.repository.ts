import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import type {
  ConfirmationDecision,
  ConfirmationRequest,
  ConfirmationStatus,
  SecondFactorType,
} from './confirmations.types.js'
import type { PrecheckResult } from './prechecks/precheck.types.js'

export interface CreateConfirmationRequestDto {
  tokenHash: string
  tenantId: string
  componentType: string
  instanceId: string
  snapshotId: string
  requesterId: string
  requesterRole: string
  scope: ConfirmationRequest['scope']
  riskLevel: ConfirmationRequest['riskLevel']
  status: ConfirmationStatus
  prechecksResult: PrecheckResult[]
  warningsShown: string[]
  availableSecondFactors: SecondFactorType[]
  expiresAt: Date
}

interface DbClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

let client: DbClient | null = null

function getClient(): DbClient {
  if (client) return client
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg') as typeof import('pg')
  client = new Pool({ connectionString: process.env.DB_URL }) as Pool
  return client
}

export function setClient(mockClient: DbClient | null): void {
  client = mockClient
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function rowToRequest(row: Record<string, unknown>): ConfirmationRequest {
  return {
    id: row.id as string,
    tokenHash: row.token_hash as string,
    tenantId: row.tenant_id as string,
    componentType: row.component_type as string,
    instanceId: row.instance_id as string,
    snapshotId: row.snapshot_id as string,
    requesterId: row.requester_id as string,
    requesterRole: row.requester_role as string,
    scope: row.scope as ConfirmationRequest['scope'],
    riskLevel: row.risk_level as ConfirmationRequest['riskLevel'],
    status: row.status as ConfirmationStatus,
    prechecksResult: (typeof row.prechecks_result === 'string' ? JSON.parse(row.prechecks_result) : row.prechecks_result) as PrecheckResult[],
    warningsShown: (typeof row.warnings_shown === 'string' ? JSON.parse(row.warnings_shown) : row.warnings_shown) as string[],
    availableSecondFactors: (typeof row.available_second_factors === 'string' ? JSON.parse(row.available_second_factors) : row.available_second_factors) as SecondFactorType[],
    decision: (row.decision as ConfirmationDecision | null) ?? undefined,
    decisionAt: row.decision_at ? new Date(row.decision_at as string) : undefined,
    secondFactorType: (row.second_factor_type as SecondFactorType | null) ?? undefined,
    secondActorId: (row.second_actor_id as string | null) ?? undefined,
    operationId: (row.operation_id as string | null) ?? undefined,
    expiresAt: new Date(row.expires_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

export class ConfirmationsRepository {
  private get db(): DbClient {
    return getClient()
  }

  async create(data: CreateConfirmationRequestDto): Promise<ConfirmationRequest> {
    const result = await this.db.query(
      `INSERT INTO restore_confirmation_requests
        (token_hash, tenant_id, component_type, instance_id, snapshot_id,
         requester_id, requester_role, scope, risk_level, status,
         prechecks_result, warnings_shown, available_second_factors,
         expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        data.tokenHash,
        data.tenantId,
        data.componentType,
        data.instanceId,
        data.snapshotId,
        data.requesterId,
        data.requesterRole,
        data.scope,
        data.riskLevel,
        data.status,
        JSON.stringify(data.prechecksResult),
        JSON.stringify(data.warningsShown),
        JSON.stringify(data.availableSecondFactors),
        data.expiresAt,
      ],
    )

    return rowToRequest(result.rows[0])
  }

  async findByTokenHash(tokenOrHash: string): Promise<ConfirmationRequest | null> {
    const tokenHash = /^[a-f0-9]{64}$/i.test(tokenOrHash) ? tokenOrHash : hashToken(tokenOrHash)
    const result = await this.db.query(
      'SELECT * FROM restore_confirmation_requests WHERE token_hash = $1',
      [tokenHash],
    )
    return result.rows.length ? rowToRequest(result.rows[0]) : null
  }

  async findById(id: string): Promise<ConfirmationRequest | null> {
    const result = await this.db.query(
      'SELECT * FROM restore_confirmation_requests WHERE id = $1',
      [id],
    )
    return result.rows.length ? rowToRequest(result.rows[0]) : null
  }

  async updateDecision(
    id: string,
    decision: ConfirmationDecision,
    updates: Partial<Pick<ConfirmationRequest, 'operationId' | 'secondFactorType' | 'secondActorId'>>,
  ): Promise<ConfirmationRequest> {
    const fields: string[] = ['decision = $2', 'decision_at = NOW()', 'status = $3']
    const params: unknown[] = [id, decision, decision === 'confirmed' ? 'confirmed' : decision === 'aborted' ? 'aborted' : 'expired']
    let idx = 4

    if (updates.operationId !== undefined) {
      fields.push(`operation_id = $${idx++}`)
      params.push(updates.operationId)
    }
    if (updates.secondFactorType !== undefined) {
      fields.push(`second_factor_type = $${idx++}`)
      params.push(updates.secondFactorType)
    }
    if (updates.secondActorId !== undefined) {
      fields.push(`second_actor_id = $${idx++}`)
      params.push(updates.secondActorId)
    }

    const result = await this.db.query(
      `UPDATE restore_confirmation_requests SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    )
    return rowToRequest(result.rows[0])
  }

  async findExpiredPending(now: Date = new Date()): Promise<ConfirmationRequest[]> {
    const result = await this.db.query(
      `SELECT * FROM restore_confirmation_requests
       WHERE status = 'pending_confirmation' AND expires_at < $1
       ORDER BY expires_at ASC`,
      [now],
    )
    return result.rows.map(rowToRequest)
  }

  async findActivePendingByTarget(
    tenantId: string,
    componentType: string,
    instanceId: string,
  ): Promise<ConfirmationRequest[]> {
    const result = await this.db.query(
      `SELECT * FROM restore_confirmation_requests
       WHERE tenant_id = $1 AND component_type = $2 AND instance_id = $3
         AND status = 'pending_confirmation'
       ORDER BY created_at DESC`,
      [tenantId, componentType, instanceId],
    )
    return result.rows.map(rowToRequest)
  }
}

// Backwards-compatible function exports for the current worktree.
const defaultRepository = new ConfirmationsRepository()
export const create = (data: CreateConfirmationRequestDto) => defaultRepository.create(data)
export const findByTokenHash = (tokenOrHash: string) => defaultRepository.findByTokenHash(tokenOrHash)
export const findById = (id: string) => defaultRepository.findById(id)
export const updateDecision = (
  id: string,
  decision: ConfirmationDecision,
  updates: Partial<Pick<ConfirmationRequest, 'operationId' | 'secondFactorType' | 'secondActorId'>>,
) => defaultRepository.updateDecision(id, decision, updates)
export const findExpiredPending = (now?: Date) => defaultRepository.findExpiredPending(now)
export const findActivePendingByTarget = (
  tenantId: string,
  componentType: string,
  instanceId: string,
) => defaultRepository.findActivePendingByTarget(tenantId, componentType, instanceId)
