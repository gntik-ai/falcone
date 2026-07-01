import { afterEach, cleanup, render, screen } from '@testing-library/react'
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
})
