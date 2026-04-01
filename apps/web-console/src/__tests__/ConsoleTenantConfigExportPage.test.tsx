import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock API module
vi.mock('@/api/configExportApi', () => ({
  getExportableDomains: vi.fn(),
  exportTenantConfig: vi.fn(),
  ConfigExportApiError: class ConfigExportApiError extends Error {
    statusCode: number
    constructor(statusCode: number, message: string) {
      super(message)
      this.statusCode = statusCode
    }
  },
}))

import ConsoleTenantConfigExportPage from '@/pages/ConsoleTenantConfigExportPage'
import { getExportableDomains, exportTenantConfig, ConfigExportApiError } from '@/api/configExportApi'

const mockGetDomains = getExportableDomains as ReturnType<typeof vi.fn>
const mockExport = exportTenantConfig as ReturnType<typeof vi.fn>

const DOMAINS_RESPONSE = {
  tenant_id: 'acme',
  deployment_profile: 'standard',
  queried_at: '2026-04-01T12:00:00Z',
  domains: [
    { domain_key: 'iam', availability: 'available' as const, description: 'IAM configuration' },
    { domain_key: 'kafka', availability: 'available' as const, description: 'Kafka topics' },
    { domain_key: 'functions', availability: 'not_available' as const, description: 'Functions', reason: 'OW disabled' },
  ],
}

const ARTIFACT = {
  export_timestamp: '2026-04-01T12:00:00Z',
  tenant_id: 'acme',
  format_version: '1.0',
  deployment_profile: 'standard',
  correlation_id: 'req-test',
  domains: [
    { domain_key: 'iam', status: 'ok', exported_at: '2026-04-01T12:00:01Z', items_count: 3, data: {} },
  ],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ConsoleTenantConfigExportPage', () => {
  it('on mount, calls getExportableDomains and populates domain selector', async () => {
    mockGetDomains.mockResolvedValue(DOMAINS_RESPONSE)
    render(<ConsoleTenantConfigExportPage tenantId="acme" />)
    await waitFor(() => {
      expect(mockGetDomains).toHaveBeenCalledWith('acme')
      expect(screen.getByTestId('domain-selector')).toBeInTheDocument()
    })
  })

  it('export button triggers exportTenantConfig with selected domains', async () => {
    mockGetDomains.mockResolvedValue(DOMAINS_RESPONSE)
    mockExport.mockResolvedValue({ artifact: ARTIFACT, status: 200 })

    render(<ConsoleTenantConfigExportPage tenantId="acme" />)
    await waitFor(() => expect(screen.getByTestId('export-btn')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('export-btn'))
    await waitFor(() => {
      expect(mockExport).toHaveBeenCalledWith('acme', { domains: ['iam', 'kafka'] })
    })
  })

  it('403 response shows permission denied message', async () => {
    mockGetDomains.mockResolvedValue(DOMAINS_RESPONSE)
    mockExport.mockRejectedValue(new ConfigExportApiError(403, 'Forbidden'))

    render(<ConsoleTenantConfigExportPage tenantId="acme" />)
    await waitFor(() => expect(screen.getByTestId('export-btn')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('export-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('page-error')).toHaveTextContent('Permiso denegado')
    })
  })

  it('422 response shows artifact-too-large message with filter hint', async () => {
    mockGetDomains.mockResolvedValue(DOMAINS_RESPONSE)
    mockExport.mockRejectedValue(new ConfigExportApiError(422, 'Artifact too large'))

    render(<ConsoleTenantConfigExportPage tenantId="acme" />)
    await waitFor(() => expect(screen.getByTestId('export-btn')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('export-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('page-error')).toHaveTextContent('demasiado grande')
    })
  })
})
