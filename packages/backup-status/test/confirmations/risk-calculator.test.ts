import { describe, it, expect } from 'vitest'
import { calculateRiskLevel, hasBlockingErrors, extractWarnings } from '../../src/confirmations/risk-calculator.js'

const config = {
  criticalMultiWarningThreshold: 3,
  snapshotAgeWarningHours: 48,
}

describe('calculateRiskLevel', () => {
  it('returns critical for full scope', () => {
    expect(calculateRiskLevel('full', [], 0, false, config)).toBe('critical')
  })

  it('returns critical when warning count reaches threshold', () => {
    const prechecks = [
      { result: 'warning', code: 'snapshot_age_check', message: 'a' },
      { result: 'warning', code: 'newer_snapshots_check', message: 'b' },
      { result: 'warning', code: 'active_connections_check', message: 'c' },
    ] as const
    expect(calculateRiskLevel('partial', [...prechecks], 0, false, config)).toBe('critical')
  })

  it('returns elevated when snapshot is old or there are warnings', () => {
    expect(calculateRiskLevel('partial', [], 49, false, config)).toBe('elevated')
    expect(calculateRiskLevel('partial', [{ result: 'warning', code: 'snapshot_age_check', message: 'a' }], 1, false, config)).toBe('elevated')
    expect(calculateRiskLevel('partial', [], 1, true, config)).toBe('elevated')
  })

  it('returns normal otherwise', () => {
    expect(calculateRiskLevel('partial', [], 1, false, config)).toBe('normal')
  })
})

describe('helpers', () => {
  it('detects blocking errors', () => {
    expect(hasBlockingErrors([{ result: 'blocking_error', code: 'snapshot_exists_check', message: 'x' }])).toBe(true)
    expect(hasBlockingErrors([{ result: 'ok', code: 'snapshot_exists_check', message: 'x' }])).toBe(false)
  })

  it('extracts warnings and blocking messages', () => {
    expect(
      extractWarnings([
        { result: 'ok', code: 'snapshot_exists_check', message: 'ok' },
        { result: 'warning', code: 'snapshot_age_check', message: 'warn' },
        { result: 'blocking_error', code: 'active_restore_check', message: 'block' },
      ]),
    ).toEqual(['warn', 'block'])
  })
})
