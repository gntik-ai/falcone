import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceAllocationSummaryTable } from './WorkspaceAllocationSummaryTable'

afterEach(cleanup)

describe('WorkspaceAllocationSummaryTable', () => {
  it('[#774] renders allocation summary rows with units and human-readable workspace labels', () => {
    const rawWorkspaceUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    render(<WorkspaceAllocationSummaryTable rows={[{ dimensionKey: 'max_pg_databases', displayLabel: 'PostgreSQL Databases', unit: 'count', tenantEffectiveValue: 20, totalAllocated: 13, unallocated: 7, workspaces: [{ workspaceId: 'ws-prod', workspaceDisplayName: 'Producción', allocatedValue: 8 }, { workspaceId: rawWorkspaceUuid, allocatedValue: 5 }], isFullyAllocated: false }]} />)

    expect(screen.getByText('PostgreSQL Databases')).toBeInTheDocument()
    expect(screen.getByText('20 count')).toBeInTheDocument()
    expect(screen.getByText('13 count')).toBeInTheDocument()
    expect(screen.getByText('7 count')).toBeInTheDocument()
    expect(screen.getByText('Producción')).toBeInTheDocument()
    expect(screen.getByText('Área de trabajo 2')).toBeInTheDocument()
    expect(screen.getByText('8 count')).toBeInTheDocument()
    expect(screen.getByText('5 count')).toBeInTheDocument()
    expect(screen.queryByText(rawWorkspaceUuid)).not.toBeInTheDocument()
    expect(screen.queryByText(/Producción: 8/)).not.toBeInTheDocument()
  })

  it('renders the shared reserve fallback in Spanish', () => {
    render(<WorkspaceAllocationSummaryTable rows={[{ dimensionKey: 'max_pg_databases', displayLabel: 'Bases PostgreSQL', tenantEffectiveValue: 20, totalAllocated: 0, unallocated: 20, workspaces: [], isFullyAllocated: false }]} />)
    expect(screen.getByText('Reserva compartida')).toBeInTheDocument()
  })

  it('[#774] ignores UUID-like optional labels as primary workspace copy', () => {
    const rawWorkspaceUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    render(<WorkspaceAllocationSummaryTable rows={[{ dimensionKey: 'max_storage_bytes', displayLabel: 'Storage', unit: 'bytes', tenantEffectiveValue: 10737418240, totalAllocated: 4294967296, unallocated: 6442450944, workspaces: [{ workspaceId: rawWorkspaceUuid, displayLabel: rawWorkspaceUuid, allocatedValue: 4294967296 }], isFullyAllocated: false }]} />)

    expect(screen.getByText('Área de trabajo 1')).toBeInTheDocument()
    expect(screen.getAllByText('4.0 GB').length).toBeGreaterThan(0)
    expect(screen.queryByText(rawWorkspaceUuid)).not.toBeInTheDocument()
  })
})
