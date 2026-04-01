import type { RiskLevel, RestoreScope } from './confirmations.types.js'
import type { PrecheckResult } from './prechecks/precheck.types.js'

export interface RiskCalculatorConfig {
  criticalMultiWarningThreshold: number
  snapshotAgeWarningHours: number
}

function count(results: PrecheckResult[], predicate: (r: PrecheckResult) => boolean): number {
  return results.filter(predicate).length
}

export function hasBlockingErrors(results: PrecheckResult[]): boolean {
  return results.some((r) => r.result === 'blocking_error')
}

export function extractWarnings(results: PrecheckResult[]): string[] {
  return results
    .filter((r) => r.result === 'warning' || r.result === 'blocking_error')
    .map((r) => r.message)
}

export function calculateRiskLevel(
  scope: RestoreScope,
  precheckResults: PrecheckResult[],
  snapshotAgeHours: number,
  isOutsideOperationalHours: boolean,
  config: RiskCalculatorConfig,
): RiskLevel
export function calculateRiskLevel(input: {
  scope: RestoreScope
  precheckResults: PrecheckResult[]
  snapshotAgeHours: number
  isOutsideOperationalHours: boolean
  config: RiskCalculatorConfig
}): RiskLevel
export function calculateRiskLevel(
  scopeOrInput: RestoreScope | {
    scope: RestoreScope
    precheckResults: PrecheckResult[]
    snapshotAgeHours: number
    isOutsideOperationalHours: boolean
    config: RiskCalculatorConfig
  },
  precheckResults: PrecheckResult[] = [],
  snapshotAgeHours = 0,
  isOutsideOperationalHours = false,
  config: RiskCalculatorConfig = { criticalMultiWarningThreshold: 3, snapshotAgeWarningHours: 48 },
): RiskLevel {
  const input = typeof scopeOrInput === 'string'
    ? { scope: scopeOrInput, precheckResults, snapshotAgeHours, isOutsideOperationalHours, config }
    : scopeOrInput

  const warningCount = count(input.precheckResults, (r) => r.result === 'warning')
  const hasTimeout = input.precheckResults.some((r) => r.code === 'precheck_timeout')

  if (input.scope === 'full' || warningCount >= input.config.criticalMultiWarningThreshold) {
    return 'critical'
  }

  if (
    input.snapshotAgeHours > input.config.snapshotAgeWarningHours
    || warningCount > 0
    || input.isOutsideOperationalHours
    || hasTimeout
  ) {
    return 'elevated'
  }

  return 'normal'
}
