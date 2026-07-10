import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
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
      tenantId: 'c58ee69d-6f0a-4d8b-8bd0-84f00a8dfd31',
      dimensions: [
        {
          dimensionKey: 'max_pg_databases',
          displayLabel: 'PostgreSQL Databases',
          unit: 'count',
          tenantEffectiveValue: 5,
          totalAllocated: 2,
          unallocated: 3,
          workspaces: [{ workspaceId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', workspaceDisplayName: 'Producción', allocatedValue: 2 }],
          isFullyAllocated: false
        }
      ]
    })

    renderPage()

    const table = await screen.findByRole('table', { name: /resumen de asignación de áreas de trabajo/i })
    expect(within(table).getByText('Producción')).toBeInTheDocument()
    expect(within(table).getAllByText('2 count').length).toBeGreaterThan(0)
    expect(screen.queryByText(/c58ee69d-6f0a-4d8b-8bd0-84f00a8dfd31/)).not.toBeInTheDocument()
    expect(screen.queryByText(/f47ac10b-58cc-4372-a567-0e02b2c3d479/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Producción: 2/)).not.toBeInTheDocument()
    expect(screen.queryByText('Todavía no hay asignaciones de área de trabajo')).not.toBeInTheDocument()
  })

  it('[#774] renders the page heading and wayfinding before the loading state', () => {
    mockReadConsoleShellSession.mockReturnValue(createSession({ platformRoles: ['tenant_owner'], tenantIds: ['ten_alpha'] }))
    mockGetTenantAllocationSummary.mockReturnValue(new Promise(() => {}))

    renderPage()

    const heading = screen.getByRole('heading', { name: /resumen de asignación/i, level: 1 })
    const state = screen.getByRole('status', { name: /cargando resumen de asignación/i })
    expect(heading.compareDocumentPosition(state) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: /mi plan/i })).toHaveAttribute('href', '/console/my-plan')
    expect(within(state).getByTestId('allocation-loading-state-icon')).toBeInTheDocument()
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

    renderPage()

    const heading = screen.getByRole('heading', { name: /resumen de asignación/i, level: 1 })
    const state = await screen.findByRole('status', { name: /todavía no hay asignaciones de área de trabajo/i })
    expect(heading.compareDocumentPosition(state) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(state).getByText(/reserva compartida de la organización/i)).toBeInTheDocument()
    expect(within(state).getByTestId('allocation-empty-state-icon')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /resumen de asignación de áreas de trabajo/i })).not.toBeInTheDocument()
  })

  it('renders a platform-admin no-personal-plan state without self-tenant allocation lookup or raw backend code', async () => {
    mockReadConsoleShellSession.mockReturnValue(createSession({ platformRoles: ['superadmin'], tenantIds: [] }))
    mockGetTenantAllocationSummary.mockRejectedValue(new Error('TENANT_NOT_FOUND'))

    renderPage()

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

    renderPage()

    const alert = await screen.findByRole('alert')
    const heading = screen.getByRole('heading', { name: /resumen de asignación/i, level: 1 })
    expect(heading.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(alert).getByTestId('allocation-error-state-icon')).toBeInTheDocument()
    expect(alert).toHaveTextContent(/no tienes permiso/i)
    expect(alert.textContent ?? '').not.toMatch(/requires superadmin/i)

    await user.click(screen.getByRole('button', { name: /reintentar/i }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(mockGetTenantAllocationSummary).toHaveBeenCalledTimes(2)
  })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ConsoleTenantAllocationSummaryPage />
    </MemoryRouter>
  )
}

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
