import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleObservabilityPage } from './ConsoleObservabilityPage'

const mockUseConsoleContext = vi.fn()
const mockUseConsoleMetrics = vi.fn()
const mockUseConsoleAuditRecords = vi.fn()
const mockExportAuditRecords = vi.fn()

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => mockUseConsoleContext() }))
vi.mock('@/lib/console-metrics', () => ({
  useConsoleMetrics: (...args: unknown[]) => mockUseConsoleMetrics(...args),
  useConsoleAuditRecords: (...args: unknown[]) => mockUseConsoleAuditRecords(...args),
  exportAuditRecords: (...args: unknown[]) => mockExportAuditRecords(...args)
}))

describe('ConsoleObservabilityPage', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    mockUseConsoleContext.mockReset()
    mockUseConsoleMetrics.mockReset()
    mockUseConsoleAuditRecords.mockReset()
    mockExportAuditRecords.mockReset()
  })

  it('renderiza métricas y cambia rango', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleMetrics.mockReturnValue({ overview: { generatedAt: 'now', overallPosture: 'within_limit', dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 5, hardLimit: 10, pctUsed: 50, policyMode: 'enforced', freshnessStatus: 'fresh' }], hasQuotaWarning: false }, loading: false, error: null, reload: vi.fn() })
    mockUseConsoleAuditRecords.mockReturnValue({ records: [], loading: false, error: null, reload: vi.fn() })
    render(<ConsoleObservabilityPage />)
    expect(screen.getByText('API')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/rango temporal/i), '7d')
  })

  it('renderiza auditoría, detalle y exportación', async () => {
    const user = userEvent.setup()
    if (!('createObjectURL' in URL)) {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn() })
    }
    if (!('revokeObjectURL' in URL)) {
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    }
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audit-export')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: null, activeTenant: { label: 'Tenant' }, activeWorkspace: null })
    mockUseConsoleMetrics.mockReturnValue({ overview: null, loading: false, error: null, reload: vi.fn() })
    mockUseConsoleAuditRecords.mockReturnValue({ records: [{ eventId: 'evt_1', eventTimestamp: 'now', correlationId: 'corr', actor: { actorId: 'usr_1', actorType: 'tenant_user', displayName: 'User' }, action: { actionId: 'create', category: 'resource_creation' }, resource: null, result: { outcome: 'succeeded' }, origin: { ipAddress: '127.0.0.1' }, scope: null, metadata: null }], loading: false, error: null, reload: vi.fn() })
    mockExportAuditRecords.mockResolvedValue({
      exportId: 'exp_audit_1',
      status: 'completed',
      itemCount: 2,
      maskedItemCount: 1,
      items: [{ eventId: 'evt_1', maskingApplied: true }]
    })

    render(<ConsoleObservabilityPage />)
    await user.click(screen.getByRole('button', { name: 'Audit' }))
    await user.click(screen.getByRole('button', { name: 'evt_1' }))
    expect(screen.getByText(/correlation/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /exportar/i }))
    await waitFor(() => expect(mockExportAuditRecords).toHaveBeenCalled())
    const exportPanel = await screen.findByText('Exportación completada')
    const panel = exportPanel.closest('section')
    expect(panel).not.toBeNull()
    expect(panel!).toHaveTextContent('exp_audit_1')
    expect(panel!).toHaveTextContent(/Registros exportados\s*2/)
    expect(panel!).toHaveTextContent(/Registros enmascarados\s*1/)
    expect(screen.queryByText('Exportación iniciada correctamente.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /descargar json/i }))
    expect(createObjectURL).toHaveBeenCalled()
    expect(anchorClick).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audit-export')
  })

  it('no muestra éxito ni descarga cuando el backend solo acepta sin artefacto', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: null, activeTenant: { label: 'Tenant' }, activeWorkspace: null })
    mockUseConsoleMetrics.mockReturnValue({ overview: null, loading: false, error: null, reload: vi.fn() })
    mockUseConsoleAuditRecords.mockReturnValue({ records: [], loading: false, error: null, reload: vi.fn() })
    mockExportAuditRecords.mockResolvedValue({ status: 'accepted', message: 'Export queued; artifact pending.' })

    render(<ConsoleObservabilityPage />)
    await user.click(screen.getByRole('button', { name: 'Audit' }))
    await user.click(screen.getByRole('button', { name: /exportar/i }))

    expect(await screen.findByText('Exportación no disponible todavía')).toBeInTheDocument()
    expect(screen.getByText('Export queued; artifact pending.')).toBeInTheDocument()
    expect(screen.queryByText('Exportación iniciada correctamente.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /descargar json/i })).not.toBeInTheDocument()
  })
})
