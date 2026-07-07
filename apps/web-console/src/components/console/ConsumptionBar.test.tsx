import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConsumptionBar } from './ConsumptionBar'

afterEach(cleanup)

describe('ConsumptionBar', () => {
  it('renders within-limit usage', () => {
    render(<ConsumptionBar current={30} limit={100} />)
    expect(screen.getByText('30 / 100')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('renders unavailable usage', () => {
    render(<ConsumptionBar current={null} limit={100} />)
    expect(screen.getByText('Datos no disponibles')).toBeInTheDocument()
  })

  it('renders unlimited usage without progressbar', () => {
    render(<ConsumptionBar current={12} limit={-1} />)
    expect(screen.getByText('/ Sin límite')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  // #766: the fill width alone was the ONLY signal distinguishing severities — a 245%-over-limit
  // dimension and a barely-at-100% one both render a fill clamped to 100% width. Assert a
  // non-color, non-width breach cue (marker + striped fill) that a within-limit or warning-tier
  // bar never renders, and that a within-limit bar does NOT show it.
  it('renders a breach marker + striped fill for an over-limit dimension, absent for within-limit/warning ones', () => {
    const { unmount } = render(<ConsumptionBar current={245} limit={100} />)
    expect(screen.getByText('245 / 100')).toBeInTheDocument()
    expect(screen.getByTestId('consumption-bar-breach-marker')).toBeInTheDocument()
    expect(screen.getByText(/por encima del límite/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAccessibleName()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toMatch(/por encima del límite/i)
    const overLimitFill = screen.getByTestId('consumption-bar-fill')
    expect(overLimitFill.style.backgroundImage).toMatch(/repeating-linear-gradient/)
    unmount()

    render(<ConsumptionBar current={85} limit={100} />)
    expect(screen.queryByTestId('consumption-bar-breach-marker')).not.toBeInTheDocument()
    const warningFill = screen.getByTestId('consumption-bar-fill')
    expect(warningFill.style.backgroundImage).toBe('')
  })

  it('treats a dimension exactly at its limit as a breach too (matches the app-wide >=100% "isExceeded" rule)', () => {
    render(<ConsumptionBar current={100} limit={100} />)
    expect(screen.getByTestId('consumption-bar-breach-marker')).toBeInTheDocument()
  })

  it('renders values through an optional formatValue formatter (byte humanization)', () => {
    render(<ConsumptionBar current={2147483648} limit={5368709120} formatValue={(value) => `${value / (1024 ** 3)}.0 GB`} />)
    expect(screen.getByText('2.0 GB / 5.0 GB')).toBeInTheDocument()
  })
})
