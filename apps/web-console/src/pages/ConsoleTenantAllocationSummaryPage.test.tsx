import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockGetTenantAllocationSummary, mockReadConsoleShellSession } = vi.hoisted(() => ({
  mockGetTenantAllocationSummary: vi.fn(),
  mockReadConsoleShellSession: vi.fn()
}))

vi.mock('@/services/planManagementApi', () => ({
  getTenantAllocationSummary: mockGetTenantAllocationSummary
}))

vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: mockReadConsoleShellSession
}))

import { ConsoleTenantAllocationSummaryPage } from './ConsoleTenantAllocationSummaryPage'

afterEach(() => {
  cleanup()
  mockGetTenantAllocationSummary.mockReset()
  mockReadConsoleShellSession.mockReset()
})

describe('ConsoleTenantAllocationSummaryPage', () => {
  it('renders the populated allocation table when the summary contains workspace rows', async () => {
    mockReadConsoleShellSession.mockReturnValue(createSession({ platformRoles: ['tenant_owner'], tenantIds: ['ten_alpha'] }))
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
    mockReadConsoleShellSession.mockReturnValue(createSession({ platformRoles: ['tenant_owner'], tenantIds: ['ten_alpha'] }))
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

  it('renders a platform-admin no-personal-plan state without self-tenant allocation lookup or raw backend code', async () => {
    mockReadConsoleShellSession.mockReturnValue(createSession({ platformRoles: ['superadmin'], tenantIds: [] }))
    mockGetTenantAllocationSummary.mockRejectedValue(new Error('TENANT_NOT_FOUND'))

    render(<ConsoleTenantAllocationSummaryPage />)

    expect(await screen.findByRole('status', { name: /no personal tenant plan/i })).toBeInTheDocument()
    expect(screen.getByText(/no personal tenant allocations/i)).toBeInTheDocument()
    expect(screen.queryByText(/TENANT_NOT_FOUND/)).not.toBeInTheDocument()
    expect(mockGetTenantAllocationSummary).not.toHaveBeenCalled()
  })
})

function createSession({
  platformRoles,
  tenantIds
}: {
  platformRoles: string[]
  tenantIds?: string[]
}) {
  return {
    principal: {
      userId: 'usr_test',
      username: 'operator',
      displayName: 'Operator',
      primaryEmail: 'operator@example.com',
      state: 'active',
      platformRoles,
      tenantIds
    }
  }
}
