import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConsoleTenantPlanPage } from './ConsoleTenantPlanPage'

// getEffectiveEntitlements returns the REAL effective-entitlements API shape
// (services/provisioning-orchestrator EffectiveEntitlementProfile): quota limits
// live under `quantitativeLimits` with a per-item `currentUsage` — NOT under
// `quotaDimensions`/`observedUsage`. On main the component reads
// `summary.quotaDimensions` (undefined here) and `.map` throws, so render fails and
// this test ERRORS (RED). On the branch it reads `quantitativeLimits` and renders the
// row (GREEN). The asserted "Flow signal rate" text comes from the mocked
// `quantitativeLimits` entry, so the guard is not tautological.
vi.mock('@/services/planManagementApi', () => ({ getTenantCurrentPlan: vi.fn().mockResolvedValue({ assignment: { planId: 'p1' }, plan: { displayName: 'Starter', status: 'active' } }), getEffectiveEntitlements: vi.fn().mockResolvedValue({ tenantId: 'ten_1', planSlug: 'starter', planStatus: 'active', quantitativeLimits: [{ dimensionKey: 'flow_signal_rate_per_minute', displayLabel: 'Flow signal rate', unit: 'per_minute', effectiveValue: 100, source: 'plan', quotaType: 'hard', currentUsage: 12, usageStatus: 'within_limit' }], capabilities: [] }), getPlanChangeHistory: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }), listPlans: vi.fn().mockResolvedValue({ items: [{ id: 'p1', displayName: 'Starter', status: 'active' }], total: 1, page: 1, pageSize: 20 }), assignPlan: vi.fn() }))

describe('ConsoleTenantPlanPage', () => {
  it('renders current assignment, change action, and quota limits from quantitativeLimits', async () => {
    render(<MemoryRouter initialEntries={['/console/tenants/ten_1/plan']}><Routes><Route path='/console/tenants/:tenantId/plan' element={<ConsoleTenantPlanPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Starter')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change plan/i })).toBeInTheDocument()
    // Limit row is populated from the API's `quantitativeLimits` (the discriminating guard).
    expect(await screen.findByText('Flow signal rate')).toBeInTheDocument()
  })
})
