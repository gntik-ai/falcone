import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockGetTenantAllocationSummary = vi.hoisted(() => vi.fn())

vi.mock('@/services/planManagementApi', () => ({
  getTenantAllocationSummary: mockGetTenantAllocationSummary
}))

import { ConsoleTenantAllocationSummaryPage } from './ConsoleTenantAllocationSummaryPage'

afterEach(() => {
  cleanup()
  mockGetTenantAllocationSummary.mockReset()
})

describe('ConsoleTenantAllocationSummaryPage', () => {
  it('renders the populated allocation table when the summary contains workspace rows', async () => {
    mockGetTenantAllocationSummary.mockResolvedValue({
      tenantId: 'pro-corp',
      dimensions: [
        {
          dimensionKey: 'max_pg_databases',
          displayLabel: 'PostgreSQL Databases',
          tenantEffectiveValue: 5,
          totalAllocated: 2,
          unallocated: 3,
          workspaces: [{ workspaceId: 'ws-prod', allocatedValue: 2 }],
          isFullyAllocated: false
        }
      ]
    })

    render(<ConsoleTenantAllocationSummaryPage />)

    expect(await screen.findByRole('table', { name: /workspace allocation summary/i })).toBeInTheDocument()
    expect(screen.getByText('ws-prod: 2')).toBeInTheDocument()
    expect(screen.queryByText('No workspace allocations yet')).not.toBeInTheDocument()
  })

  it('renders the no-allocation empty state only when every dimension has no workspaces', async () => {
    mockGetTenantAllocationSummary.mockResolvedValue({
      tenantId: 'pro-corp',
      dimensions: [
        {
          dimensionKey: 'max_pg_databases',
          displayLabel: 'PostgreSQL Databases',
          tenantEffectiveValue: 5,
          totalAllocated: 0,
          unallocated: 5,
          workspaces: [],
          isFullyAllocated: false
        }
      ]
    })

    render(<ConsoleTenantAllocationSummaryPage />)

    expect(await screen.findByText('No workspace allocations yet')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /workspace allocation summary/i })).not.toBeInTheDocument()
  })
})
