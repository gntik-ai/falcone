import type { OperationSummary } from './query'
export interface ReconciliationDelta {
  updated: OperationSummary[]; added: OperationSummary[]; terminal: OperationSummary[]; unavailable: string[]; unchanged: OperationSummary[]
}
export const TERMINAL_STATUSES: ReadonlySet<string>
export function reconcileOperations(local: ReadonlyMap<string, OperationSummary>, remote: readonly OperationSummary[]): ReconciliationDelta
