import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { ConsoleMetricDimensionRow } from './ConsoleMetricDimensionRow'
import type { ConsoleMetricDimensionView } from '@/lib/console-metrics'

afterEach(cleanup)

function renderRow(dimension: ConsoleMetricDimensionView) {
  return render(<ConsoleMetricDimensionRow dimension={dimension} />, { wrapper: MemoryRouter })
}

const baseDimension: ConsoleMetricDimensionView = {
  dimensionId: 'max_api_keys',
  displayName: 'Maximum API Keys',
  measuredValue: 49,
  hardLimit: 20,
  pctUsed: 245,
  policyMode: 'enforced',
  freshnessStatus: 'fresh',
  isWarning: false,
  isExceeded: true
}

describe('ConsoleMetricDimensionRow', () => {
  it('[#766] renders a breach-honest cue for a 245%-over-limit dimension: not a native <progress> clamp', () => {
    renderRow(baseDimension)

    // The old native `<progress max={100} value={245}>` is gone.
    expect(document.querySelector('progress')).not.toBeInTheDocument()
    // A destructive, non-color-only cue on the value itself, AND the shared ConsumptionBar's own
    // breach marker (distinct from the fill's clamped width) — both say "Por encima del límite".
    expect(screen.getByText('245% usado')).toBeInTheDocument()
    expect(screen.getAllByText('Por encima del límite')).toHaveLength(2)
    expect(screen.getByTestId('consumption-bar-breach-marker')).toBeInTheDocument()
    // Cross-link to the Quotas view (#766 wayfinding deliverable).
    expect(screen.getByRole('link', { name: /ver cuotas/i })).toHaveAttribute('href', '/console/quotas')
  })

  it('[#766] a 245%-over-limit dimension is distinguishable from a within-limit (50%) dimension', () => {
    const { unmount } = renderRow(baseDimension)
    expect(screen.getByTestId('consumption-bar-breach-marker')).toBeInTheDocument()
    expect(screen.getAllByText('Por encima del límite').length).toBeGreaterThan(0)
    unmount()

    renderRow({
      dimensionId: 'api_requests',
      displayName: 'API Requests',
      measuredValue: 5,
      hardLimit: 10,
      pctUsed: 50,
      policyMode: 'enforced',
      freshnessStatus: 'fresh',
      isWarning: false,
      isExceeded: false
    })
    expect(screen.getByText('50% usado')).toBeInTheDocument()
    expect(screen.queryByTestId('consumption-bar-breach-marker')).not.toBeInTheDocument()
    expect(screen.queryByText('Por encima del límite')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /ver cuotas/i })).not.toBeInTheDocument()
  })

  it('[#766] humanizes a byte-unit dimension limit/usage instead of showing the raw byte count', () => {
    renderRow({
      dimensionId: 'max_storage_bytes',
      displayName: 'Storage',
      measuredValue: 1073741824,
      hardLimit: 5368709120,
      pctUsed: 20,
      policyMode: 'enforced',
      freshnessStatus: 'fresh',
      isWarning: false,
      isExceeded: false,
      unit: 'bytes'
    })

    expect(screen.getByText('1.0 GB / 5.0 GB')).toBeInTheDocument()
    expect(screen.queryByText('1073741824')).not.toBeInTheDocument()
    expect(screen.queryByText(/5368709120/)).not.toBeInTheDocument()
  })

  it('never humanizes a count-unit dimension (API keys stay a plain integer)', () => {
    renderRow(baseDimension)
    expect(screen.getByText('49 / 20')).toBeInTheDocument()
  })
})
