import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { BackupScopeLegend, getCoverageBadgeClass } from './BackupScopeLegend'

afterEach(cleanup)

describe('BackupScopeLegend', () => {
  it('renders every coverage and operational badge', () => {
    render(<BackupScopeLegend />)
    expect(screen.getByText('Gestionado por la plataforma')).toBeInTheDocument()
    expect(screen.getByText('No soportado')).toBeInTheDocument()
    expect(screen.getByText('Operativo')).toBeInTheDocument()
  })

  it('[#744][Scenario: Dark-theme table/panel] no badge uses hardcoded light-mode color classes', () => {
    render(<BackupScopeLegend />)
    expect(screen.getByTestId('backup-scope-legend').innerHTML).not.toMatch(/bg-\w+-100|bg-\w+-900|bg-white|bg-slate-\d|text-slate-\d/)
  })

  it('getCoverageBadgeClass falls back to a neutral dark-root-safe tone for unknown statuses', () => {
    expect(getCoverageBadgeClass('does-not-exist')).not.toMatch(/bg-slate-\d|text-slate-\d/)
  })
})
