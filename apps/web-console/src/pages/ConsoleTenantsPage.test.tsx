import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleTenantsPage } from './ConsoleTenantsPage'

const mockUseConsoleContext = vi.fn()
const mockReadConsoleShellSession = vi.fn()

vi.mock('@/lib/console-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/console-context')>('@/lib/console-context')
  return { ...actual, useConsoleContext: () => mockUseConsoleContext() }
})
vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: () => mockReadConsoleShellSession(),
  requestConsoleSessionJson: vi.fn()
}))
vi.mock('@/lib/console-quotas', () => ({ useConsoleQuotas: () => ({ posture: null, workspacePosture: null, loading: false }) }))

const selectTenant = vi.fn()
const reloadTenants = vi.fn()

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    tenants: [],
    tenantsLoading: false,
    tenantsError: null,
    tenantsPageInfo: null,
    selectTenant,
    reloadTenants,
    ...overrides
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ConsoleTenantsPage />
    </MemoryRouter>
  )
}

describe('ConsoleTenantsPage', () => {
  afterEach(() => {
    cleanup()
    mockUseConsoleContext.mockReset()
    mockReadConsoleShellSession.mockReset()
    selectTenant.mockReset()
    reloadTenants.mockReset()
  })

  it('abre el wizard desde el CTA principal', async () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    mockUseConsoleContext.mockReturnValue(baseContext())
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByText('Gobierno de organizaciones')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /nueva organización/i }))
    expect(screen.getByRole('heading', { name: /nueva organización/i })).toBeInTheDocument()
  })

  it('[fn-console-tenant-inventory][Scenario: View and open a tenant] renderiza el inventario con slug, nombre y estado, y cada fila enlaza al plan de esa organización', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    mockUseConsoleContext.mockReturnValue(
      baseContext({
        tenants: [
          { tenantId: 'ten_alpha', label: 'Tenant Alpha', secondary: 'tenant-alpha', state: 'active', governanceStatus: null, quotaSummary: null, inventorySummary: null, consoleUserRealm: null, provisioningStatus: null },
          { tenantId: 'ten_beta', label: 'Tenant Beta', secondary: 'tenant-beta', state: 'suspended', governanceStatus: null, quotaSummary: null, inventorySummary: null, consoleUserRealm: null, provisioningStatus: null }
        ]
      })
    )
    renderPage()

    expect(screen.getByText('Tenant Alpha')).toBeInTheDocument()
    expect(screen.getByText('tenant-alpha')).toBeInTheDocument()
    expect(screen.getByText('Tenant Beta')).toBeInTheDocument()
    expect(screen.getByText('tenant-beta')).toBeInTheDocument()
    // #752: the static placeholder text must be gone — this is a real inventory now.
    expect(screen.queryByText(/inicia el alta guiada de nuevas organizaciones/i)).not.toBeInTheDocument()

    const alphaLink = screen.getByRole('link', { name: /abrir el plan de tenant alpha/i })
    expect(alphaLink).toHaveAttribute('href', '/console/tenants/ten_alpha/plan')
    const betaLink = screen.getByRole('link', { name: /abrir el plan de tenant beta/i })
    expect(betaLink).toHaveAttribute('href', '/console/tenants/ten_beta/plan')
  })

  it('[fn-console-tenant-inventory][Scenario: Operator manages tenants from the UI] al abrir el plan de una fila, fija esa organización como contexto activo', async () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    mockUseConsoleContext.mockReturnValue(
      baseContext({
        tenants: [{ tenantId: 'ten_alpha', label: 'Tenant Alpha', secondary: 'tenant-alpha', state: 'active', governanceStatus: null, quotaSummary: null, inventorySummary: null, consoleUserRealm: null, provisioningStatus: null }]
      })
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('link', { name: /abrir el plan de tenant alpha/i }))

    expect(selectTenant).toHaveBeenCalledWith('ten_alpha')
  })

  it('[fn-console-tenant-inventory] muestra un estado de carga mientras se consulta el inventario', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    mockUseConsoleContext.mockReturnValue(baseContext({ tenantsLoading: true }))
    renderPage()

    expect(screen.getByText(/cargando organizaciones/i)).toBeInTheDocument()
  })

  it('[fn-console-tenant-inventory] muestra un estado de error con reintento cuando falla la carga', async () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    mockUseConsoleContext.mockReturnValue(baseContext({ tenantsError: 'Organizaciones degradadas' }))
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText(/organizaciones degradadas/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(reloadTenants).toHaveBeenCalled()
  })

  it('[fn-console-tenant-inventory] muestra un estado vacío cuando no hay organizaciones', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    mockUseConsoleContext.mockReturnValue(baseContext())
    renderPage()

    expect(screen.getByText(/sin organizaciones/i)).toBeInTheDocument()
  })

  it('[fn-console-tenant-inventory] revela una nota honesta cuando hay más organizaciones que las mostradas', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    mockUseConsoleContext.mockReturnValue(
      baseContext({
        tenants: [{ tenantId: 'ten_alpha', label: 'Tenant Alpha', secondary: 'tenant-alpha', state: 'active', governanceStatus: null, quotaSummary: null, inventorySummary: null, consoleUserRealm: null, provisioningStatus: null }],
        tenantsPageInfo: { after: 'cursor-2' }
      })
    )
    renderPage()

    expect(screen.getByText(/mostrando las primeras 1 organizaciones/i)).toBeInTheDocument()
    expect(screen.getByText(/hay más organizaciones disponibles/i)).toBeInTheDocument()
  })

  it('[fn-console-tenant-inventory][role-aware] no revienta para un rol no-plataforma y muestra un estado honesto en vez de la tabla', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['tenant_owner'] } })
    mockUseConsoleContext.mockReturnValue(
      baseContext({
        tenants: [{ tenantId: 'ten_alpha', label: 'Tenant Alpha', secondary: 'tenant-alpha', state: 'active', governanceStatus: null, quotaSummary: null, inventorySummary: null, consoleUserRealm: null, provisioningStatus: null }]
      })
    )
    renderPage()

    expect(screen.getByText(/inventario no disponible para tu rol/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /abrir el plan de tenant alpha/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ir a mi plan/i })).toBeInTheDocument()
  })
})
