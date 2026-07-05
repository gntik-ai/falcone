import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const useConsoleContextMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/console-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/console-context')>('@/lib/console-context')

  return {
    ...actual,
    useConsoleContext: useConsoleContextMock
  }
})

import { ConsoleOverviewPage } from './ConsoleOverviewPage'

const NO_SCAFFOLDING_PATTERNS = [/EP-\d+/, /US-UI/i, /consola base/i, /pantalla temporal/i, /entrada base/i, /iteración posterior/i]

describe('ConsoleOverviewPage', () => {
  afterEach(() => {
    cleanup()
    useConsoleContextMock.mockReset()
  })

  it('[#744][Scenario: Tenant owner views any authenticated page] muestra copy de producto real, sin IDs de seguimiento ni texto de estado de desarrollo', () => {
    useConsoleContextMock.mockReturnValue(createContextValue())

    render(
      <MemoryRouter>
        <ConsoleOverviewPage />
      </MemoryRouter>
    )

    expect(screen.getByRole('heading', { name: /vista general de la consola/i })).toBeInTheDocument()

    const pageText = document.body.textContent ?? ''
    for (const pattern of NO_SCAFFOLDING_PATTERNS) {
      expect(pageText).not.toMatch(pattern)
    }
  })

  it('muestra los resúmenes de cuotas e inventario cuando hay datos disponibles', () => {
    useConsoleContextMock.mockReturnValue(createContextValue())

    render(
      <MemoryRouter>
        <ConsoleOverviewPage />
      </MemoryRouter>
    )

    expect(screen.getByTestId('console-tenant-quota-summary')).toBeInTheDocument()
    expect(screen.getByText(/estado de cuotas de la organización activa/i)).toBeInTheDocument()
    expect(screen.getByText(/invocations_per_minute/i)).toBeInTheDocument()

    expect(screen.getByTestId('console-tenant-inventory-summary')).toBeInTheDocument()
    expect(screen.getByText(/composición de la organización activa/i)).toBeInTheDocument()
    expect(screen.getByText(/workspace-prod/i)).toBeInTheDocument()
  })

  it('oculta las secciones opcionales cuando no hay datos de cuota o inventario', () => {
    useConsoleContextMock.mockReturnValue(
      createContextValue({
        activeTenant: {
          ...createContextValue().activeTenant,
          quotaSummary: null,
          inventorySummary: null
        }
      })
    )

    render(
      <MemoryRouter>
        <ConsoleOverviewPage />
      </MemoryRouter>
    )

    expect(screen.queryByTestId('console-tenant-quota-summary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('console-tenant-inventory-summary')).not.toBeInTheDocument()
  })
})

function createContextValue(overrides: Record<string, unknown> = {}) {
  return {
    tenants: [],
    workspaces: [],
    activeTenantId: 'ten_alpha',
    activeWorkspaceId: 'wrk_prod',
    activeTenant: {
      tenantId: 'ten_alpha',
      label: 'Tenant Alpha',
      secondary: 'tenant-alpha',
      state: 'active',
      governanceStatus: 'nominal',
      provisioningStatus: 'completed',
      quotaSummary: {
        totals: { nominal: 1, warning: 1, blocked: 1 },
        items: [
          {
            metricKey: 'invocations_per_minute',
            scope: 'workspace',
            used: 1000,
            limit: 1000,
            remaining: 0,
            utilizationPercent: 100,
            severity: 'blocked',
            unit: 'rpm'
          }
        ]
      },
      inventorySummary: {
        tenantId: 'ten_alpha',
        workspaceCount: 2,
        applicationCount: 7,
        managedResourceCount: 19,
        serviceAccountCount: 4,
        workspaces: [
          {
            workspaceId: 'wrk_prod',
            workspaceSlug: 'workspace-prod',
            environment: 'prod',
            state: 'active',
            applicationCount: 5,
            serviceAccountCount: 3,
            managedResourceCount: 11
          }
        ]
      }
    },
    activeWorkspace: {
      workspaceId: 'wrk_prod',
      tenantId: 'ten_alpha',
      label: 'Workspace Prod',
      secondary: 'workspace-prod · prod',
      environment: 'prod',
      state: 'active',
      provisioningStatus: 'completed'
    },
    operationalAlerts: [],
    tenantsLoading: false,
    workspacesLoading: false,
    tenantsError: null,
    workspacesError: null,
    selectTenant: vi.fn(),
    selectWorkspace: vi.fn(),
    reloadTenants: vi.fn(),
    reloadWorkspaces: vi.fn(),
    ...overrides
  }
}
