import { cleanup, render, screen, within } from '@testing-library/react'
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
    activeTenantId: null,
    selectTenant,
    reloadTenants,
    ...overrides
  }
}

const tenantOption = (overrides: Record<string, unknown> = {}) => ({
  tenantId: 'ten_alpha',
  label: 'Tenant Alpha',
  secondary: 'tenant-alpha',
  state: 'active',
  governanceStatus: null,
  quotaSummary: null,
  inventorySummary: null,
  consoleUserRealm: null,
  provisioningStatus: null,
  ...overrides
})

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
    const { container } = renderPage()
    expect(screen.getByText('Gobierno de organizaciones')).toBeInTheDocument()
    expect(container.querySelector('main')).not.toBeInTheDocument()
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

  it('[fn-console-tenant-inventory] el estado vacío ofrece un acceso directo al alta que abre el wizard', async () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    mockUseConsoleContext.mockReturnValue(baseContext())
    const user = userEvent.setup()
    renderPage()

    // The empty state must be actionable, not just descriptive: its CTA opens the same wizard as
    // the header CTA so the operator can create the first organization without hunting for it. It
    // carries a distinct label from the header CTA so screen-reader users don't hear two identical
    // "Nueva organización" buttons.
    await user.click(screen.getByRole('button', { name: /dar de alta la primera organización/i }))
    expect(screen.getByRole('heading', { name: /nueva organización/i })).toBeInTheDocument()
  })

  it('[fn-console-tenant-inventory][role-aware] un rol de plataforma sin superadmin no ve un enlace de plan que le rebotaría, sino una acción honesta para fijar el contexto', async () => {
    // platform_operator can read the inventory but the /console/tenants/:id/plan route is
    // superadmin-gated (RequireSuperadminRoute → /console/my-plan). The row must NOT offer a link
    // that silently bounces them; it offers "Usar como activa" instead (#752).
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['platform_operator'] } })
    mockUseConsoleContext.mockReturnValue(baseContext({ tenants: [tenantOption()] }))
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Tenant Alpha')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /abrir el plan de tenant alpha/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /usar tenant alpha como organización activa/i }))
    expect(selectTenant).toHaveBeenCalledWith('ten_alpha')
  })

  it('[fn-console-tenant-inventory] marca la organización activa con distintivo accesible y aria-current', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
    mockUseConsoleContext.mockReturnValue(
      baseContext({
        activeTenantId: 'ten_alpha',
        tenants: [tenantOption(), tenantOption({ tenantId: 'ten_beta', label: 'Tenant Beta', secondary: 'tenant-beta' })]
      })
    )
    renderPage()

    const activeRow = screen.getByRole('row', { name: /tenant alpha/i })
    expect(activeRow).toHaveAttribute('aria-current', 'true')
    expect(within(activeRow).getByText('Activa')).toBeInTheDocument()
    // The non-active row must not carry the marker.
    const inactiveRow = screen.getByRole('row', { name: /tenant beta/i })
    expect(inactiveRow).not.toHaveAttribute('aria-current')
    // Superadmin still gets the plan link on the active row.
    expect(screen.getByRole('link', { name: /abrir el plan de tenant alpha/i })).toBeInTheDocument()
  })

  it('[fn-console-tenant-inventory][role-aware] deshabilita la acción de contexto de la fila ya activa para un rol de plataforma', () => {
    mockReadConsoleShellSession.mockReturnValue({ principal: { platformRoles: ['platform_operator'] } })
    mockUseConsoleContext.mockReturnValue(baseContext({ activeTenantId: 'ten_alpha', tenants: [tenantOption()] }))
    renderPage()

    expect(screen.getByRole('button', { name: /tenant alpha ya es la organización activa/i })).toBeDisabled()
  })
})
