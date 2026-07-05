import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BackupScopeMatrix } from '@/components/console/BackupScopeMatrix'
import { mockEntries } from './fixtures/backupScopeFixtures'

afterEach(cleanup)

describe('BackupScopeMatrix', () => {
  it('renders table with 7 rows', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    expect(screen.getByTestId('backup-scope-matrix')).toBeInTheDocument()
    expect(screen.getAllByTestId(/^matrix-row-/)).toHaveLength(7)
  })

  it('renders platform-managed entries with dark-root-safe emerald badge class', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    const pgRow = screen.getByTestId('matrix-row-postgresql')
    const badge = pgRow.querySelector('.text-emerald-300')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('platform-managed')
  })

  it('renders not-supported entries with dark-root-safe red badge class', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    const apisixRow = screen.getByTestId('matrix-row-apisix_config')
    const badge = apisixRow.querySelector('.text-red-300')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('not-supported')
  })

  it('renders operator-managed entries with dark-root-safe amber badge class', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    const kafkaRow = screen.getByTestId('matrix-row-kafka')
    const badge = kafkaRow.querySelector('.text-amber-300')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe('operator-managed')
  })

  it('[#744][Scenario: Dark-theme table/panel] no coverage or operational badge uses hardcoded light-mode classes', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    expect(screen.getByTestId('backup-scope-matrix').innerHTML).not.toMatch(/bg-\w+-100|bg-\w+-900|bg-white|bg-slate-\d|text-slate-\d/)
  })

  it('[#744] renders through the shared Table primitive (bordered overflow container)', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    // The shared Table primitive wraps the <table> in a `data-slot="table-container"` that carries
    // the console's rounded-bordered, horizontally-scrollable panel idiom — locking the migration
    // away from the former hand-rolled <table> with its one-off `border-b` header.
    expect(screen.getByTestId('backup-scope-matrix').closest('[data-slot="table-container"]')).not.toBeNull()
  })

  it('renders RPO tooltip for entries with rpoRangeMinutes', () => {
    render(<BackupScopeMatrix entries={mockEntries} isLoading={false} />)
    const pgRow = screen.getByTestId('matrix-row-postgresql')
    const rpoCell = pgRow.querySelectorAll('td')[4]
    expect(rpoCell.getAttribute('title')).toContain('RPO')
  })

  it('renders loading skeleton when isLoading=true', () => {
    render(<BackupScopeMatrix entries={[]} isLoading={true} />)
    expect(screen.getByTestId('matrix-loading')).toBeInTheDocument()
  })

  it('renders empty state when no entries', () => {
    render(<BackupScopeMatrix entries={[]} isLoading={false} />)
    expect(screen.getByTestId('matrix-empty')).toBeInTheDocument()
  })
})
