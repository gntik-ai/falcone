import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { OperationStatusBadge } from './OperationStatusBadge'

describe('OperationStatusBadge', () => {
  it('F01 renders pending state with spanish label', () => {
    render(<OperationStatusBadge status="pending" />)

    const badge = screen.getByText('Pendiente')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-slate-100')
  })

  it('F02 renders running state with pulse animation', () => {
    render(<OperationStatusBadge status="running" />)

    const badge = screen.getByText('En curso')
    expect(badge.className).toContain('animate-pulse')
  })

  it('F03 renders completed state with green styling', () => {
    render(<OperationStatusBadge status="completed" />)

    const badge = screen.getByText('Completada')
    expect(badge.className).toContain('text-green-600')
  })

  it('F04 renders failed state', () => {
    render(<OperationStatusBadge status="failed" />)

    const badge = screen.getByText('Fallida')
    expect(badge.className).toContain('bg-red-600')
  })

  it('F05 renders timed out state', () => {
    render(<OperationStatusBadge status="timed_out" />)

    const badge = screen.getByText('Expirada')
    expect(badge.className).toContain('bg-amber-100')
  })

  it('F06 renders cancelled state', () => {
    render(<OperationStatusBadge status="cancelled" />)

    const badge = screen.getByText('Cancelada')
    expect(badge.className).toContain('bg-zinc-100')
  })
})
