import { describe, expect, it } from 'vitest'

import { formatBytes, formatDimensionValue, isByteUnitDimension } from './format'

describe('formatBytes', () => {
  it('renders 0 bytes and sub-KB counts as plain bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(5)).toBe('5 B')
    expect(formatBytes(500)).toBe('500 B')
  })

  it('renders null/undefined/NaN/negative as an em dash', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })

  it('matches the two previously-duplicated implementations for KB-range values', () => {
    // Byte-identical to the pre-existing ConsoleStoragePage/ConsoleMongoPage assertions.
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(4096)).toBe('4.0 KB')
    expect(formatBytes(8192)).toBe('8.0 KB')
    expect(formatBytes(16384)).toBe('16 KB')
  })

  it('humanizes a byte-unit quota hard limit instead of showing the raw byte count', () => {
    // #766: the Quotas page rendered the raw `5368709120` for `max_storage_bytes` — this must
    // now render as a humanized, non-raw string.
    const humanized = formatBytes(5368709120)
    expect(humanized).not.toBe('5368709120')
    expect(humanized).toBe('5.0 GB')
  })

  it('steps through MB/GB/TB boundaries', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB')
  })
})

describe('isByteUnitDimension', () => {
  it('trusts an explicit unit field', () => {
    expect(isByteUnitDimension('bytes', 'anything')).toBe(true)
    expect(isByteUnitDimension('count', 'max_storage_bytes')).toBe(false)
  })

  it('falls back to the dimensionId "_bytes"/".bytes" suffix convention when unit is missing', () => {
    expect(isByteUnitDimension(undefined, 'max_storage_bytes')).toBe(true)
    expect(isByteUnitDimension(null, 'storage_volume_bytes')).toBe(true)
    expect(isByteUnitDimension(undefined, 'storage.bytes')).toBe(true)
  })

  it('never treats a count dimension (API keys, requests, workspaces) as byte-unit', () => {
    expect(isByteUnitDimension(undefined, 'max_api_keys')).toBe(false)
    expect(isByteUnitDimension(undefined, 'api_requests')).toBe(false)
    expect(isByteUnitDimension(null, 'max_workspaces')).toBe(false)
    expect(isByteUnitDimension(undefined, undefined)).toBe(false)
  })
})

describe('formatDimensionValue', () => {
  it('humanizes only byte-unit dimensions', () => {
    expect(formatDimensionValue(5368709120, 'bytes', 'max_storage_bytes')).toBe('5.0 GB')
    expect(formatDimensionValue(49, 'count', 'max_api_keys')).toBe('49')
    expect(formatDimensionValue(245, undefined, 'api_requests')).toBe('245')
  })
})
