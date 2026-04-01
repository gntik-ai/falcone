import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigExportResultPanel } from '@/components/ConfigExportResultPanel'
import type { ExportArtifact } from '@/api/configExportApi'

afterEach(cleanup)

const ARTIFACT: ExportArtifact = {
  export_timestamp: '2026-04-01T12:00:00.000Z',
  tenant_id: 'acme',
  format_version: '1.0',
  deployment_profile: 'standard',
  correlation_id: 'req-abc123',
  domains: [
    { domain_key: 'iam', status: 'ok', exported_at: '2026-04-01T12:00:01.000Z', items_count: 5, data: {} },
    { domain_key: 'kafka', status: 'empty', exported_at: '2026-04-01T12:00:02.000Z', items_count: 0, data: {} },
    { domain_key: 'mongo_metadata', status: 'error', exported_at: '2026-04-01T12:00:03.000Z', error: 'Connection timeout', data: null },
    { domain_key: 'functions', status: 'not_available', exported_at: '2026-04-01T12:00:04.000Z', reason: 'OW disabled', data: null },
  ],
}

describe('ConfigExportResultPanel', () => {
  it('renders loading spinner when isLoading', () => {
    render(<ConfigExportResultPanel artifact={null} isLoading={true} />)
    expect(screen.getByTestId('result-loading')).toBeInTheDocument()
  })

  it('renders correct status badges for mixed statuses', () => {
    render(<ConfigExportResultPanel artifact={ARTIFACT} isLoading={false} />)
    expect(screen.getByTestId('domain-result-iam')).toHaveTextContent('ok')
    expect(screen.getByTestId('domain-result-kafka')).toHaveTextContent('empty')
    expect(screen.getByTestId('domain-result-mongo_metadata')).toHaveTextContent('error')
    expect(screen.getByTestId('domain-result-functions')).toHaveTextContent('not_available')
  })

  it('shows error message for domain with status: error', () => {
    render(<ConfigExportResultPanel artifact={ARTIFACT} isLoading={false} />)
    expect(screen.getByTestId('domain-error-mongo_metadata')).toHaveTextContent('Connection timeout')
  })

  it('"Download JSON" button triggers download', () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined)
    const clickSpy = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click: clickSpy, set onclick(_: unknown) {} } as unknown as HTMLAnchorElement
      }
      return document.createElement(tag)
    })

    render(<ConfigExportResultPanel artifact={ARTIFACT} isLoading={false} />)
    fireEvent.click(screen.getByTestId('download-json-btn'))
    expect(clickSpy).toHaveBeenCalled()
    createSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  it('renders error string when no artifact', () => {
    render(<ConfigExportResultPanel artifact={null} isLoading={false} error="Something went wrong" />)
    expect(screen.getByTestId('result-error')).toHaveTextContent('Something went wrong')
  })
})
