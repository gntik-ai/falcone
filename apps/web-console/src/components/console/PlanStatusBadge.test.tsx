import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanStatusBadge } from './PlanStatusBadge'

describe('PlanStatusBadge', () => {
  it('renders all statuses', () => {
    render(<div><PlanStatusBadge status='draft' /><PlanStatusBadge status='active' /><PlanStatusBadge status='deprecated' /><PlanStatusBadge status='archived' /></div>)
    expect(screen.getByText('Borrador')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Obsoleto')).toBeInTheDocument()
    expect(screen.getByText('Archivado')).toBeInTheDocument()
  })

  it('[#751] uses theme-aware translucent status tones instead of light-mode chips', () => {
    render(<div><PlanStatusBadge status='active' /><PlanStatusBadge status='deprecated' /></div>)

    const active = screen.getByText('Activo')
    expect(active).toHaveClass('border-emerald-500/30')
    expect(active).toHaveClass('bg-emerald-500/10')
    expect(active).toHaveClass('text-emerald-300')
    expect(active.className).not.toMatch(/(?:^|\s)(bg-emerald-(50|100)|text-emerald-(700|800|900))(?:\s|$)/)

    const deprecated = screen.getByText('Obsoleto')
    expect(deprecated).toHaveClass('border-amber-500/30')
    expect(deprecated).toHaveClass('bg-amber-500/10')
    expect(deprecated).toHaveClass('text-amber-300')
    expect(deprecated.className).not.toMatch(/(?:^|\s)(bg-amber-(50|100)|text-amber-(700|800|900))(?:\s|$)/)
  })
})
