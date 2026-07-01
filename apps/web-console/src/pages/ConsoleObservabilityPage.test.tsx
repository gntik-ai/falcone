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

  it('mantiene activo el rango temporal para métricas workspace', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: 'wrk_1', activeTenant: { label: 'Tenant' }, activeWorkspace: { label: 'Workspace' } })
    mockUseConsoleMetrics.mockReturnValue({ overview: { generatedAt: 'now', overallPosture: 'within_limit', dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 5, hardLimit: 10, pctUsed: 50, policyMode: 'enforced', freshnessStatus: 'fresh' }], hasQuotaWarning: false }, loading: false, error: null, reload: vi.fn() })
    mockUseConsoleAuditRecords.mockReturnValue({ records: [], loading: false, error: null, reload: vi.fn() })
    render(<ConsoleObservabilityPage />)
    expect(screen.getByText('API')).toBeInTheDocument()
    const rangeSelect = screen.getByLabelText(/ventana de métricas/i) as HTMLSelectElement
    expect(rangeSelect).toBeEnabled()
    expect(Array.from(rangeSelect.options).map((option) => option.value)).toEqual(['24h', '7d', '30d'])
    expect(screen.queryByRole('option', { name: /custom/i })).not.toBeInTheDocument()

    await user.selectOptions(rangeSelect, '7d')

    await waitFor(() => {
      expect(mockUseConsoleMetrics).toHaveBeenCalledWith('ten_1', 'wrk_1', expect.objectContaining({ preset: '7d' }))
    })
  })

  it('marca el rango temporal como no aplicable en métricas tenant', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: null, activeTenant: { label: 'Tenant' }, activeWorkspace: null })
    mockUseConsoleMetrics.mockReturnValue({ overview: { generatedAt: 'now', overallPosture: 'within_limit', dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 5, hardLimit: 10, pctUsed: 50, policyMode: 'enforced', freshnessStatus: 'fresh' }], hasQuotaWarning: false }, loading: false, error: null, reload: vi.fn() })
    mockUseConsoleAuditRecords.mockReturnValue({ records: [], loading: false, error: null, reload: vi.fn() })

    render(<ConsoleObservabilityPage />)

    const rangeSelect = screen.getByLabelText(/ventana de métricas/i)
    expect(rangeSelect).toBeDisabled()
    expect(rangeSelect).toHaveDisplayValue('Sin ventana activa')
    expect(rangeSelect).toHaveAccessibleDescription(/rango temporal no está activo/i)
    expect(screen.getByText(/rango temporal no está activo/i)).toBeInTheDocument()
    expect(screen.getByText(/selecciona un área de trabajo/i)).toBeInTheDocument()
    expect(mockUseConsoleMetrics).toHaveBeenCalledWith('ten_1', null, expect.objectContaining({ preset: '24h' }))
  })

  it('[#803] renderiza la página de observabilidad con la copia citada en español', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: null, activeTenant: { label: 'Tenant activo' }, activeWorkspace: null })
    mockUseConsoleMetrics.mockReturnValue({ overview: { generatedAt: 'now', overallPosture: 'within_limit', dimensions: [{ dimensionId: 'api', displayName: 'API', measuredValue: 5, hardLimit: 10, pctUsed: 50, policyMode: 'enforced', freshnessStatus: 'fresh' }], hasQuotaWarning: false }, loading: false, error: null, reload: vi.fn() })
    mockUseConsoleAuditRecords.mockReturnValue({ records: [], loading: false, error: null, reload: vi.fn() })

    render(<ConsoleObservabilityPage />)

    expect(screen.getByRole('heading', { name: 'Observabilidad' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Métricas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Auditoría' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Observability' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Metrics' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Audit' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Auditoría' }))

    expect(screen.getByLabelText('Categoría')).toBeInTheDocument()
    expect(screen.getByLabelText('Resultado')).toHaveDisplayValue('Todos')
    expect(screen.getByRole('option', { name: 'Éxito' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Fallo' })).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Auditoría' }))
    await user.click(screen.getByRole('button', { name: 'evt_1' }))
    expect(screen.getByText(/correlación/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /exportar/i }))
    await waitFor(() => expect(mockExportAuditRecords).toHaveBeenCalled())
    const exportPanel = await screen.findByText('Manifiesto de auditoría listo')
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

  it('anuncia y deshabilita la exportación mientras espera respuesta', async () => {
    const user = userEvent.setup()
    let resolveExport: (value: unknown) => void = () => {}
    const exportPromise = new Promise((resolve) => {
      resolveExport = resolve
    })

    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: null, activeTenant: { label: 'Tenant' }, activeWorkspace: null })
    mockUseConsoleMetrics.mockReturnValue({ overview: null, loading: false, error: null, reload: vi.fn() })
    mockUseConsoleAuditRecords.mockReturnValue({ records: [], loading: false, error: null, reload: vi.fn() })
    mockExportAuditRecords.mockReturnValue(exportPromise)

    render(<ConsoleObservabilityPage />)
    await user.click(screen.getByRole('button', { name: 'Auditoría' }))
    const exportButton = screen.getByRole('button', { name: /exportar auditoría/i })

    await user.click(exportButton)

    expect(exportButton).toBeDisabled()
    expect(exportButton).toHaveAccessibleName(/exportando auditoría/i)
    expect(screen.getByText('Solicitando exportación de auditoría')).toBeInTheDocument()
    expect(screen.getByText(/esperando la respuesta del servidor/i)).toBeInTheDocument()

    resolveExport({ status: 'accepted', message: 'queued' })
    expect(await screen.findByText('Manifiesto no disponible')).toBeInTheDocument()
  })

  it('no muestra éxito ni descarga cuando el backend solo acepta sin artefacto', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: null, activeTenant: { label: 'Tenant' }, activeWorkspace: null })
    mockUseConsoleMetrics.mockReturnValue({ overview: null, loading: false, error: null, reload: vi.fn() })
    mockUseConsoleAuditRecords.mockReturnValue({ records: [], loading: false, error: null, reload: vi.fn() })
    mockExportAuditRecords.mockResolvedValue({ status: 'accepted', message: 'Export queued; artifact pending.' })

    render(<ConsoleObservabilityPage />)
    await user.click(screen.getByRole('button', { name: 'Auditoría' }))
    await user.click(screen.getByRole('button', { name: /exportar/i }))

    expect(await screen.findByText('Manifiesto no disponible')).toBeInTheDocument()
    expect(screen.getByText('Export queued; artifact pending.')).toBeInTheDocument()
    expect(screen.getByText('No se descargó ningún archivo porque la respuesta no incluyó un manifiesto.')).toBeInTheDocument()
    expect(screen.queryByText('Exportación iniciada correctamente.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /descargar json/i })).not.toBeInTheDocument()
  })

  it('muestra error explícito cuando falla la exportación', async () => {
    const user = userEvent.setup()
    mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_1', activeWorkspaceId: null, activeTenant: { label: 'Tenant' }, activeWorkspace: null })
    mockUseConsoleMetrics.mockReturnValue({ overview: null, loading: false, error: null, reload: vi.fn() })
    mockUseConsoleAuditRecords.mockReturnValue({ records: [], loading: false, error: null, reload: vi.fn() })
    mockExportAuditRecords.mockRejectedValue(new Error('Audit export unavailable'))

    render(<ConsoleObservabilityPage />)
    await user.click(screen.getByRole('button', { name: 'Auditoría' }))
    await user.click(screen.getByRole('button', { name: /exportar/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se pudo exportar la auditoría')
    expect(alert).toHaveTextContent('Audit export unavailable')
    expect(screen.queryByText('Exportación iniciada correctamente.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /descargar json/i })).not.toBeInTheDocument()
  })
})
