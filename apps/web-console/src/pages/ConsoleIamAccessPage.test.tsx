import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleIamAccessPage } from './ConsoleIamAccessPage'

import { useConsoleContext } from '@/lib/console-context'
import { requestConsoleSessionJson } from '@/lib/console-session'

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: vi.fn()
}))

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: vi.fn()
}))

const useConsoleContextMock = vi.mocked(useConsoleContext)
const requestConsoleSessionJsonMock = vi.mocked(requestConsoleSessionJson)

const rawKeycloakMessage = 'keycloak POST /realms/tenant-alpha/users/usr-1/role-mappings/realm -> 404: {"error":"verbatim upstream body"}'
const rawRealmUrlMessage = 'https://sso.example.test/realms/tenant-alpha/protocol/openid-connect/token -> 502: {"errorMessage":"verbatim upstream body"}'

function mockIamAccessResponses(mutationError: unknown = {
  status: 404,
  code: 'IAM_ASSIGN_ROLE_FAILED',
  message: rawKeycloakMessage
}) {
  requestConsoleSessionJsonMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/role-assignments')) {
      throw mutationError
    }
    if (url.endsWith('/users/usr-1/roles')) return { items: [], total: 0 }
    if (url.endsWith('/users/usr-1/groups')) return { items: [], total: 0 }
    if (url.endsWith('/users')) return { items: [{ id: 'usr-1', username: 'ada', email: 'ada@example.test', enabled: true }], total: 1 }
    if (url.endsWith('/roles')) return { items: [{ id: 'role-1', name: 'tenant_admin', description: null }], total: 1 }
    if (url.endsWith('/groups')) return { items: [], total: 0 }
    throw new Error(`unexpected request ${url}`)
  })
}

describe('ConsoleIamAccessPage', () => {
  beforeEach(() => {
    useConsoleContextMock.mockReturnValue({
      activeTenantId: 'tenant-alpha',
      activeTenant: {
        tenantId: 'tenant-alpha',
        label: 'Tenant Alpha',
        secondary: 'alpha',
        state: 'active',
        governanceStatus: null,
        consoleUserRealm: 'tenant-alpha',
        provisioningStatus: 'ready',
        quotaSummary: null,
        inventorySummary: null
      },
    } as never)

    mockIamAccessResponses()
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders a friendly localized IAM mutation alert without raw Keycloak details', async () => {
    const user = userEvent.setup()
    render(<ConsoleIamAccessPage />)

    await user.click(await screen.findByRole('button', { name: /ada/i }))
    await user.selectOptions(await screen.findByLabelText(/rol a asignar/i), 'tenant_admin')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/no se pudo actualizar el acceso iam/i)
    expect(alert).not.toHaveTextContent(/keycloak\s/i)
    expect(alert).not.toHaveTextContent(/\/realms\//i)
    expect(alert).not.toHaveTextContent(/verbatim upstream body/i)
  })

  it('falls back when an unknown IAM mutation error includes realm URL fragments', async () => {
    mockIamAccessResponses({
      status: 502,
      code: 'HTTP_502',
      message: rawRealmUrlMessage
    })

    const user = userEvent.setup()
    render(<ConsoleIamAccessPage />)

    await user.click(await screen.findByRole('button', { name: /ada/i }))
    await user.selectOptions(await screen.findByLabelText(/rol a asignar/i), 'tenant_admin')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/la operación de iam no pudo completarse/i)
    expect(alert).not.toHaveTextContent(/\/realms\//i)
    expect(alert).not.toHaveTextContent(/sso\.example\.test/i)
    expect(alert).not.toHaveTextContent(/verbatim upstream body/i)
  })
})
