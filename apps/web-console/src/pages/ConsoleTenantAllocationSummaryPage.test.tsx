import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

    expect(await screen.findByRole('table', { name: /resumen de asignación de áreas de trabajo/i })).toBeInTheDocument()
    expect(screen.getByText('ws-prod: 2')).toBeInTheDocument()
    expect(screen.queryByText('Todavía no hay asignaciones de área de trabajo')).not.toBeInTheDocument()
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

    expect(await screen.findByText('Todavía no hay asignaciones de área de trabajo')).toBeInTheDocument()
    expect(screen.getByText(/reserva compartida de la organización/i)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /resumen de asignación de áreas de trabajo/i })).not.toBeInTheDocument()
  })

  it('renders a platform-admin no-personal-plan state without self-tenant allocation lookup or raw backend code', async () => {
    mockReadConsoleShellSession.mockReturnValue(createSession({ platformRoles: ['superadmin'], tenantIds: [] }))
    mockGetTenantAllocationSummary.mockRejectedValue(new Error('TENANT_NOT_FOUND'))

    render(<ConsoleTenantAllocationSummaryPage />)

    expect(await screen.findByRole('status', { name: /sin plan de organización personal/i })).toBeInTheDocument()
    expect(screen.getByText(/no hay asignaciones personales de organización/i)).toBeInTheDocument()
    expect(screen.queryByText(/TENANT_NOT_FOUND/)).not.toBeInTheDocument()
    expect(mockGetTenantAllocationSummary).not.toHaveBeenCalled()
  })

  it('[#743] localiza un error 403 del backend y permite reintentar en lugar de mostrar el texto crudo', async () => {
    mockReadConsoleShellSession.mockReturnValue(createSession({ platformRoles: ['tenant_owner'], tenantIds: ['ten_alpha'] }))
    mockGetTenantAllocationSummary
      .mockRejectedValueOnce({ status: 403, code: 'FORBIDDEN', message: 'requires superadmin' })
      .mockResolvedValueOnce({ tenantId: 'pro-corp', dimensions: [] })
    const user = userEvent.setup()

    render(<ConsoleTenantAllocationSummaryPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no tienes permiso/i)
    expect(alert.textContent ?? '').not.toMatch(/requires superadmin/i)

    await user.click(screen.getByRole('button', { name: /reintentar/i }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(mockGetTenantAllocationSummary).toHaveBeenCalledTimes(2)
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
