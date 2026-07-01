import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateTenantWizard } from './CreateTenantWizard'

const requestMock = vi.fn()
const readConsoleShellSessionMock = vi.fn()
const useConsoleQuotasMock = vi.fn()
const catalogPlans = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'enterprise-real',
    displayName: 'Enterprise Real',
    status: 'active',
    capabilities: {},
    quotaDimensions: {}
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'scale-real',
    displayName: 'Scale Real',
    status: 'active',
    capabilities: {},
    quotaDimensions: {}
  }
]

vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: () => readConsoleShellSessionMock(),
  requestConsoleSessionJson: (...args: unknown[]) => requestMock(...args)
}))
vi.mock('@/lib/console-quotas', () => ({ useConsoleQuotas: () => useConsoleQuotasMock() }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  requestMock.mockReset()
  readConsoleShellSessionMock.mockReset()
  useConsoleQuotasMock.mockReset()
  requestMock.mockImplementation((url: string, init?: { method?: string; body?: unknown }) => {
    if (url.startsWith('/v1/plans')) return Promise.resolve({ items: catalogPlans, total: catalogPlans.length, page: 1, pageSize: 100 })
    if (url === '/v1/tenants' && init?.method === 'POST') return Promise.resolve({ tenantId: 'ten_new' })
    return Promise.resolve({})
  })
  readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
  useConsoleQuotasMock.mockReturnValue({ posture: null, workspacePosture: null, loading: false })
})

describe('CreateTenantWizard', () => {
  it('carga planes activos del catálogo y envía el id real seleccionado', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><CreateTenantWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.type(screen.getByLabelText(/nombre de la organización/i), 'Tenant Nuevo')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(requestMock).toHaveBeenCalledWith('/v1/plans?status=active&page=1&pageSize=100', expect.objectContaining({ method: 'GET' }))
    expect(await screen.findByRole('option', { name: /enterprise real \(enterprise-real\)/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^starter$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^growth$/i })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/^plan$/i), '11111111-1111-4111-8111-111111111111')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/región/i), 'eu-west')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    // #504: the wizard must target the REAL route POST /v1/tenants (not the unrouted /v1/admin/tenants).
    expect(requestMock).toHaveBeenCalledWith('/v1/tenants', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ name: 'Tenant Nuevo', planId: '11111111-1111-4111-8111-111111111111', region: 'eu-west' }) }))
  })

  it('bloquea la selección cuando no hay planes activos del catálogo', async () => {
    requestMock.mockImplementation((url: string) => {
      if (url.startsWith('/v1/plans')) return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 100 })
      return Promise.resolve({})
    })
    const user = userEvent.setup()

    render(<MemoryRouter><CreateTenantWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.type(screen.getByLabelText(/nombre de la organización/i), 'Tenant Nuevo')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))

    expect(await screen.findByText(/no hay planes activos en el catálogo/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^plan$/i)).toBeDisabled()
    expect(screen.getByLabelText(/^plan$/i)).toHaveAttribute('aria-describedby', expect.stringContaining('tenant-plan-catalog-empty'))
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
  })

  it('permite reintentar cuando falla la carga del catálogo de planes', async () => {
    let planCatalogRequests = 0
    requestMock.mockImplementation((url: string, init?: { method?: string; body?: unknown }) => {
      if (url.startsWith('/v1/plans')) {
        planCatalogRequests += 1
        if (planCatalogRequests === 1) return Promise.reject(new Error('Catalog timeout'))
        return Promise.resolve({ items: catalogPlans, total: catalogPlans.length, page: 1, pageSize: 100 })
      }
      if (url === '/v1/tenants' && init?.method === 'POST') return Promise.resolve({ tenantId: 'ten_new' })
      return Promise.resolve({})
    })
    const user = userEvent.setup()

    render(<MemoryRouter><CreateTenantWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.type(screen.getByLabelText(/nombre de la organización/i), 'Tenant Nuevo')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/catalog timeout/i)
    expect(screen.getByLabelText(/^plan$/i)).toBeDisabled()
    expect(screen.getByLabelText(/^plan$/i)).toHaveAttribute('aria-describedby', expect.stringContaining('tenant-plan-catalog-error'))
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /reintentar/i }))

    expect(await screen.findByRole('option', { name: /enterprise real \(enterprise-real\)/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^plan$/i)).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
  })

  it('[RW-07] cuota excedida bloquea el wizard con aviso — RF-UI-025 / T02-AC7', async () => {
    const user = userEvent.setup()
    useConsoleQuotasMock.mockReturnValue({
      posture: { dimensions: [{ dimensionId: 'tenants.count', isExceeded: true, remainingToHardLimit: 0 }] },
      workspacePosture: null,
      loading: false
    })

    render(<MemoryRouter><CreateTenantWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.type(screen.getByLabelText(/nombre de la organización/i), 'Tenant Nuevo')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))

    expect(screen.queryByText(/sin cuota disponible/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
    expect(screen.getByLabelText(/plan/i)).toBeInTheDocument()
  })

  it('[RW-08] sin permisos muestra mensaje de permisos insuficientes — RF-UI-025 / T02-AC8', () => {
    readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['member'] } })

    render(<MemoryRouter><CreateTenantWizard open onOpenChange={vi.fn()} /></MemoryRouter>)

    expect(screen.getByText(/acceso bloqueado/i)).toBeInTheDocument()
  })
})
