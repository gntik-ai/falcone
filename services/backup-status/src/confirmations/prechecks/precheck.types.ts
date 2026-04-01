import type { RestoreScope } from '../confirmations.types.js'

export type PrecheckResultStatus = 'ok' | 'warning' | 'blocking_error'

export type PrecheckCode =
  | 'active_restore_check'
  | 'snapshot_exists_check'
  | 'snapshot_age_check'
  | 'newer_snapshots_check'
  | 'active_connections_check'
  | 'operational_hours_check'
  | 'precheck_timeout'

export interface PrecheckResult {
  code: PrecheckCode | (string & {})
  result: PrecheckResultStatus
  message: string
  metadata?: Record<string, unknown>
}

export interface PrecheckContext {
  tenantId: string
  componentType: string
  instanceId: string
  snapshotId: string
  scope: RestoreScope
  requestedAt: Date
}

export type PrecheckFn = (ctx: PrecheckContext) => Promise<PrecheckResult>

export type PrecheckSummary = PrecheckResult[]
