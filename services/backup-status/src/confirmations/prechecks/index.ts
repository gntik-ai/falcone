import type { PrecheckContext, PrecheckResult } from './precheck.types.js'
import { activeRestorePrecheck, type ActiveRestoreRepo } from './active-restore.precheck.js'
import { snapshotExistsPrecheck, type SnapshotLister as SnapshotListerForExists } from './snapshot-exists.precheck.js'
import { snapshotAgePrecheck } from './snapshot-age.precheck.js'
import { newerSnapshotsPrecheck, type SnapshotLister as SnapshotListerForNewer } from './newer-snapshots.precheck.js'
import { activeConnectionsPrecheck, type ConnectionChecker } from './active-connections.precheck.js'
import { operationalHoursPrecheck } from './operational-hours.precheck.js'

export interface PrecheckDeps {
  operationsRepo: ActiveRestoreRepo
  snapshotLister?: SnapshotListerForExists & SnapshotListerForNewer
  adapterClient?: (ConnectionChecker & SnapshotListerForExists & SnapshotListerForNewer) | null
  adapterContext?: unknown
  snapshotCreatedAt?: Date
  snapshotAgeWarningHours?: number
  operationalHours?: {
    enabled: boolean
    start: string
    end: string
  }
  resolveTenantName?: (tenantId: string) => Promise<string> | string
}

const DEFAULT_TIMEOUT_MS = 10_000

function timeoutWarning(code: string): PrecheckResult {
  return {
    code: 'precheck_timeout',
    result: 'warning',
    message: 'El precheck no respondió dentro del tiempo límite configurado.',
    metadata: { precheck: code },
  }
}

async function withTimeout<T>(promise: Promise<T>, code: string, timeoutMs: number): Promise<T | PrecheckResult> {
  return await Promise.race([
    promise,
    new Promise<PrecheckResult>((resolve) => {
      setTimeout(() => resolve(timeoutWarning(code)), timeoutMs)
    }),
  ])
}

export async function runAllPrechecks(ctx: PrecheckContext, deps: PrecheckDeps): Promise<PrecheckResult[]> {
  const timeoutMs = Number(process.env.PRECHECK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS)
  const snapshotCreatedAt = deps.snapshotCreatedAt ?? new Date(ctx.requestedAt)
  const snapshotAgeWarningHours = deps.snapshotAgeWarningHours ?? Number(process.env.PRECHECK_SNAPSHOT_AGE_WARNING_HOURS ?? '48')
  const operationalHours = deps.operationalHours ?? {
    enabled: process.env.PRECHECK_OPERATIONAL_HOURS_ENABLED !== 'false',
    start: process.env.PRECHECK_OPERATIONAL_HOURS_START ?? '08:00',
    end: process.env.PRECHECK_OPERATIONAL_HOURS_END ?? '20:00',
  }

  const adapterClient = deps.adapterClient ?? deps.snapshotLister ?? null

  const checks: Array<Promise<PrecheckResult> | Promise<PrecheckResult | { code: string; result: 'warning'; message: string }>> = [
    withTimeout(
      activeRestorePrecheck(ctx.tenantId, ctx.componentType, ctx.instanceId, deps.operationsRepo),
      'active_restore_check',
      timeoutMs,
    ) as Promise<PrecheckResult>,
    withTimeout(
      snapshotExistsPrecheck(ctx.tenantId, ctx.componentType, ctx.instanceId, ctx.snapshotId, adapterClient, deps.adapterContext),
      'snapshot_exists_check',
      timeoutMs,
    ) as Promise<PrecheckResult>,
    Promise.resolve(snapshotAgePrecheck(snapshotCreatedAt, snapshotAgeWarningHours, ctx.requestedAt)),
    withTimeout(
      newerSnapshotsPrecheck(ctx.tenantId, ctx.componentType, ctx.instanceId, ctx.snapshotId, snapshotCreatedAt, adapterClient, deps.adapterContext),
      'newer_snapshots_check',
      timeoutMs,
    ) as Promise<PrecheckResult>,
    withTimeout(
      activeConnectionsPrecheck(ctx.tenantId, ctx.componentType, ctx.instanceId, adapterClient as ConnectionChecker | null, deps.adapterContext),
      'active_connections_check',
      timeoutMs,
    ) as Promise<PrecheckResult>,
    Promise.resolve(operationalHoursPrecheck(ctx.requestedAt, operationalHours)),
  ]

  const settled = await Promise.allSettled(checks)
  return settled.map((entry) => {
    if (entry.status === 'fulfilled') return entry.value as PrecheckResult
    return timeoutWarning('unknown')
  })
}
