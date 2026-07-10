import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

  it('[#751] renders the catalog through the shared Table primitive with clickable row affordance', async () => {
    const { container } = render(<MemoryRouter><ConsolePlanCatalogPage /></MemoryRouter>)

    const table = await screen.findByRole('table', { name: /catálogo de planes/i })
    expect(table).toHaveAttribute('data-slot', 'table')
    expect(container.querySelector('[data-slot="table-container"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="table-header"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="table-body"]')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Slug' })).toHaveAttribute('data-slot', 'table-head')

    const slugCell = screen.getByText('starter').closest('[data-slot="table-cell"]')
    expect(slugCell).toBeInTheDocument()
    const row = slugCell?.closest('[data-slot="table-row"]')
    expect(row).toHaveClass('cursor-pointer')
    expect(row).toHaveClass('hover:bg-accent/40')
  })

  it('keeps filtered empty states recoverable from the catalog page', async () => {
    const listPlans = vi.mocked(planApi.listPlans)
    const catalogPlan = { id: 'p1', slug: 'starter', displayName: 'Starter', status: 'active', capabilities: {}, quotaDimensions: {}, assignedTenantCount: 2, updatedAt: '2026-03-31' } as const
    listPlans
      .mockResolvedValueOnce({ items: [catalogPlan], total: 1, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [catalogPlan], total: 1, page: 1, pageSize: 20 })

    render(<MemoryRouter><ConsolePlanCatalogPage /></MemoryRouter>)
    expect(await screen.findByText('starter')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Filtro de estado' }), { target: { value: 'draft' } })

    expect(await screen.findByRole('status', { name: /no hay planes con estado borrador/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filtro de estado' })).toHaveValue('draft')

    fireEvent.click(screen.getByRole('button', { name: /ver todos los planes/i }))

    await waitFor(() => expect(listPlans).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'all' })))
    expect(await screen.findByText('starter')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filtro de estado' })).toHaveValue('all')
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
    await waitFor(() => expect(listPlans).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' })))
  })
})
