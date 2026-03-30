import type { OperationSummary } from './console-operations'

export const TERMINAL_STATUSES: ReadonlySet<'completed' | 'failed' | 'timed_out' | 'cancelled'>

export function reconcileOperations(
  localSnapshot: ReadonlyMap<string, OperationSummary>,
  remoteOps: readonly OperationSummary[]
): {
  updated: OperationSummary[]
  added: OperationSummary[]
  terminal: OperationSummary[]
  unavailable: string[]
  unchanged: OperationSummary[]
}
