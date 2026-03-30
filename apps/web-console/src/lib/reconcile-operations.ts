import type { OperationStatus, OperationSummary } from './console-operations'

export type TerminalStatus = Extract<OperationStatus, 'completed' | 'failed' | 'timed_out' | 'cancelled'>

export const TERMINAL_STATUSES: ReadonlySet<OperationStatus> = new Set<OperationStatus>(['completed', 'failed', 'timed_out', 'cancelled'])

export interface ReconciliationDelta {
  updated: OperationSummary[]
  added: OperationSummary[]
  terminal: OperationSummary[]
  unavailable: string[]
  unchanged: OperationSummary[]
}

export function reconcileOperations(
  localSnapshot: ReadonlyMap<string, OperationSummary>,
  remoteOps: readonly OperationSummary[]
): ReconciliationDelta {
  const remoteMap = new Map(remoteOps.map((operation) => [operation.operationId, operation]))
  const updated: OperationSummary[] = []
  const added: OperationSummary[] = []
  const terminal: OperationSummary[] = []
  const unavailable: string[] = []
  const unchanged: OperationSummary[] = []

  for (const [operationId, localOperation] of localSnapshot.entries()) {
    const remoteOperation = remoteMap.get(operationId)

    if (!remoteOperation) {
      unavailable.push(operationId)
      continue
    }

    if (remoteOperation.status !== localOperation.status) {
      updated.push(remoteOperation)
      if (TERMINAL_STATUSES.has(remoteOperation.status)) {
        terminal.push(remoteOperation)
      }
      continue
    }

    unchanged.push(remoteOperation)
  }

  for (const remoteOperation of remoteOps) {
    if (!localSnapshot.has(remoteOperation.operationId)) {
      added.push(remoteOperation)
    }
  }

  return { updated, added, terminal, unavailable, unchanged }
}
