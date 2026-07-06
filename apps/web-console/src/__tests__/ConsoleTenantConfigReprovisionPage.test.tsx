import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock API module
vi.mock('@/api/configReprovisionApi', () => ({
  reprovisionTenantConfig: vi.fn(),
  generateIdentifierMap: vi.fn(),
  ConfigReprovisionApiError: class ConfigReprovisionApiError extends Error {
    statusCode: number
    code?: string
    constructor(statusCode: number, message: string, code?: string) {
      super(message)
      this.statusCode = statusCode
      this.code = code
    }
  },
}))

import { ConsoleTenantConfigReprovisionPage } from '@/pages/ConsoleTenantConfigReprovisionPage'
import { generateIdentifierMap, ConfigReprovisionApiError } from '@/api/configReprovisionApi'

const mockGenerateIdentifierMap = generateIdentifierMap as ReturnType<typeof vi.fn>

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ConsoleTenantConfigReprovisionPage', () => {
  // [#743] the confirmed-repro shape (a raw backend transport message on a status the page
  // doesn't specifically own copy for) must never render verbatim — only localized Spanish.
  it('[#743] an unrecognized status code localizes the message — never the raw backend text', async () => {
    mockGenerateIdentifierMap.mockRejectedValue(
      new ConfigReprovisionApiError(403, 'requires superadmin', 'FORBIDDEN')
    )

    render(<ConsoleTenantConfigReprovisionPage tenantId="acme" />)

    fireEvent.change(screen.getByTestId('artifact-input'), { target: { value: '{"a":1}' } })
    fireEvent.click(screen.getByTestId('analyze-button'))

    await waitFor(() => {
      const errorEl = screen.getByTestId('page-error')
      expect(errorEl).toHaveTextContent(/no tienes permiso/i)
      expect(errorEl.textContent ?? '').not.toMatch(/requires superadmin/i)
    })
  })

  it('invalid JSON shows a localized parse-error message', async () => {
    render(<ConsoleTenantConfigReprovisionPage tenantId="acme" />)

    fireEvent.change(screen.getByTestId('artifact-input'), { target: { value: '{not json' } })
    fireEvent.click(screen.getByTestId('analyze-button'))

    await waitFor(() => {
      expect(screen.getByTestId('page-error')).toHaveTextContent(/no es un json válido/i)
    })
    expect(mockGenerateIdentifierMap).not.toHaveBeenCalled()
  })
})
