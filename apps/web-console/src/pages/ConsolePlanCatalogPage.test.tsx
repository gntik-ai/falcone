import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as planApi from '@/services/planManagementApi'
import { ConsolePlanCatalogPage } from './ConsolePlanCatalogPage'

vi.mock('@/services/planManagementApi', () => ({ listPlans: vi.fn().mockResolvedValue({ items: [{ id: 'p1', slug: 'starter', displayName: 'Starter', status: 'active', capabilities: {}, quotaDimensions: {}, assignedTenantCount: 2, updatedAt: '2026-03-31' }], total: 1, page: 1, pageSize: 20 }) }))

describe('ConsolePlanCatalogPage', () => {
  it('renders catalog rows', async () => {
    render(<MemoryRouter><ConsolePlanCatalogPage /></MemoryRouter>)
    expect(await screen.findByText('starter')).toBeInTheDocument()
    expect(screen.getByText('Starter')).toBeInTheDocument()
  })

  it('re-queries with the selected status when the filter changes (no crash)', async () => {
    const listPlans = vi.mocked(planApi.listPlans)
    listPlans.mockResolvedValue({ items: [{ id: 'p1', slug: 'starter', displayName: 'Starter', status: 'active', capabilities: {}, quotaDimensions: {}, assignedTenantCount: 2, updatedAt: '2026-03-31' }], total: 1, page: 1, pageSize: 20 })

    render(<MemoryRouter><ConsolePlanCatalogPage /></MemoryRouter>)
    // Wait for the initial render with a row visible
    expect(await screen.findByText('starter')).toBeInTheDocument()

    // Initial call: status 'all'
    expect(listPlans).toHaveBeenCalledWith(expect.objectContaining({ status: 'all' }))

    // Change the filter to 'draft' — on the buggy code this throws because
    // e.currentTarget is null when the functional setState updater runs, causing
    // TypeError: Cannot read properties of null (reading 'value'), which surfaces
    // as an uncaught error in the React render phase and fails the test.
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtro de estado' }), { target: { value: 'draft' } })

    // The fix reads the value synchronously before entering the updater, so no
    // throw occurs and listPlans is re-invoked with status: 'draft'.
    expect(listPlans).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }))
  })
})
