import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { NodeStatusBadge, formatDuration } from './NodeStatusBadge'
import type { NodeStatus } from '@/services/flowsMonitoringApi'

afterEach(cleanup)

const STATUSES: Array<{ status: NodeStatus; label: string }> = [
  { status: 'scheduled', label: 'Scheduled' },
  { status: 'started', label: 'Running' },
  { status: 'retrying', label: 'Retrying' },
  { status: 'completed', label: 'Completed' },
  { status: 'failed', label: 'Failed' },
  { status: 'skipped', label: 'Skipped' }
]

describe('NodeStatusBadge', () => {
  it.each(STATUSES)('renders the correct label and data-status for "$status"', ({ status, label }) => {
    render(<NodeStatusBadge status={status} />)
    const badge = screen.getByTestId('node-status-badge')
    expect(badge).toHaveAttribute('data-status', status)
    expect(badge).toHaveTextContent(label)
  })

  it('applies a distinct className per status (visual differentiation)', () => {
    const classes = new Set<string>()
    for (const { status } of STATUSES) {
      const { unmount } = render(<NodeStatusBadge status={status} />)
      classes.add(screen.getByTestId('node-status-badge').className)
      unmount()
    }
    // Each of the six statuses must yield a distinct class string.
    expect(classes.size).toBe(STATUSES.length)
  })

  it('shows the attempt number only when greater than 1', () => {
    const { rerender } = render(<NodeStatusBadge status="retrying" attemptNumber={1} />)
    expect(screen.queryByTestId('node-status-attempt')).toBeNull()
    rerender(<NodeStatusBadge status="retrying" attemptNumber={3} />)
    expect(screen.getByTestId('node-status-attempt')).toHaveTextContent('attempt 3')
  })

  it('renders the elapsed duration from start/complete timestamps', () => {
    render(
      <NodeStatusBadge status="completed" startedAt="2026-01-01T00:00:00Z" completedAt="2026-01-01T00:00:02.5Z" />
    )
    expect(screen.getByTestId('node-status-duration')).toHaveTextContent('2.5s')
  })

  it('formatDuration handles ms / s / m+s and missing start', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:00.340Z')).toBe('340ms')
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:05Z')).toBe('5.0s')
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:02:05Z')).toBe('2m 5s')
  })
})
