import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceSecret } from '@/services/secretsApi'

import { ConsoleWorkspaceSecretsPage } from './ConsoleWorkspaceSecretsPage'

const mockUseConsoleContext = vi.fn()
const mockListSecrets = vi.fn()
const mockCreateSecret = vi.fn()
const mockUpdateSecret = vi.fn()
const mockDeleteSecret = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

// Mock only the network methods; keep the pure helpers (readSecretName/secretEnvVarName) real.
vi.mock('@/services/secretsApi', async () => {
  const actual = await vi.importActual<typeof import('@/services/secretsApi')>('@/services/secretsApi')
  return {
    ...actual,
    listSecrets: (...args: unknown[]) => mockListSecrets(...args),
    createSecret: (...args: unknown[]) => mockCreateSecret(...args),
    updateSecret: (...args: unknown[]) => mockUpdateSecret(...args),
    deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args)
  }
})

function context(
  overrides: Partial<{
    activeTenantId: string | null
    activeWorkspaceId: string | null
    activeTenant: { label: string } | null
    activeWorkspace: { label: string; environment: string | null } | null
  }> = {}
) {
  return {
    activeTenantId: 'ten_alpha',
    activeWorkspaceId: 'wrk_alpha',
    activeTenant: { label: 'Acme' },
    activeWorkspace: { label: 'App Dev', environment: 'dev' },
    ...overrides
  }
}

function secret(overrides: Partial<WorkspaceSecret> = {}): WorkspaceSecret {
  return {
    secretName: 'db_password',
    name: 'db_password',
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_alpha',
    resolvedRefCount: 0,
    timestamps: { createdAt: '2026-03-29T07:00:00.000Z', updatedAt: '2026-03-29T07:30:00.000Z' },
    ...overrides
  }
}

function renderPage(ctx = context()) {
  mockUseConsoleContext.mockReturnValue(ctx)
  return render(<ConsoleWorkspaceSecretsPage />)
}

const apiError = (status: number, code: string, message = code) => Object.assign(new Error(message), { status, code, message })

describe('ConsoleWorkspaceSecretsPage', () => {
  beforeEach(() => {
    mockUseConsoleContext.mockReset()
    mockListSecrets.mockReset()
    mockCreateSecret.mockReset()
    mockUpdateSecret.mockReset()
    mockDeleteSecret.mockReset()
    mockListSecrets.mockResolvedValue({ items: [], page: { size: 0 } })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a "select a workspace" empty state and issues NO request when no workspace is active', () => {
    renderPage(context({ activeWorkspaceId: null }))
    expect(screen.getByRole('alert')).toHaveTextContent(/selecciona un área de trabajo/i)
    expect(mockListSecrets).not.toHaveBeenCalled()
  })

  it('lists secrets as metadata only (env-var, refCount, timestamps) with no value in the DOM', async () => {
    mockListSecrets.mockResolvedValue({ items: [secret({ resolvedRefCount: 2, description: 'prod db' })], page: { size: 1 } })
    renderPage()

    expect(await screen.findByText('db_password')).toBeInTheDocument()
    // Derived UPPER_SNAKE env-var name is shown.
    expect(screen.getByText('DB_PASSWORD')).toBeInTheDocument()
    // refCount + description render; there is NO version column and NO value anywhere.
    expect(screen.getByText('prod db')).toBeInTheDocument()
    expect(screen.queryByText(/version/i)).not.toBeInTheDocument()
    // The list payload (mock) carries no value; assert the rendered DOM has none either.
    expect(document.body.textContent).not.toMatch(/s3cr3t|secretValue/i)
    expect(mockListSecrets).toHaveBeenCalledWith('wrk_alpha')
  })

  it('create clears the value input after a successful submit and refreshes the list', async () => {
    mockListSecrets
      .mockResolvedValueOnce({ items: [], page: { size: 0 } })
      .mockResolvedValueOnce({ items: [secret({ secretName: 'api_key' })], page: { size: 1 } })
    mockCreateSecret.mockResolvedValue(secret({ secretName: 'api_key' }))
    renderPage()

    await screen.findByText(/no hay secretos/i)
    await userEvent.type(screen.getByLabelText(/nombre del secreto/i), 'api_key')
    const valueInput = screen.getByLabelText(/^valor del secreto$/i) as HTMLInputElement
    await userEvent.type(valueInput, 'super-secret-value')
    expect(valueInput.value).toBe('super-secret-value')
    await userEvent.click(screen.getByRole('button', { name: /crear secreto/i }))

    await waitFor(() => expect(mockCreateSecret).toHaveBeenCalledWith('wrk_alpha', { secretName: 'api_key', secretValue: 'super-secret-value' }))
    // Value input is cleared from component state after submit (write-only invariant).
    await waitFor(() => expect((screen.getByLabelText(/^valor del secreto$/i) as HTMLInputElement).value).toBe(''))
    // The list is refreshed (second listSecrets call) and the new secret appears.
    expect(await screen.findByText('api_key')).toBeInTheDocument()
    // The masked value never leaks into the DOM after submit.
    expect(document.body.textContent).not.toContain('super-secret-value')
  })

  it('blocks an invalid secret name client-side and issues no create request', async () => {
    renderPage()
    await screen.findByText(/no hay secretos/i)
    await userEvent.type(screen.getByLabelText(/nombre del secreto/i), 'DB_PASSWORD') // uppercase → invalid
    await userEvent.type(screen.getByLabelText(/^valor del secreto$/i), 'v')
    await userEvent.click(screen.getByRole('button', { name: /crear secreto/i }))
    expect(await screen.findByText(/debe coincidir con/i)).toBeInTheDocument()
    expect(mockCreateSecret).not.toHaveBeenCalled()
  })

  it('renders a 409 duplicate as a conflict directing the operator to replace', async () => {
    mockCreateSecret.mockRejectedValue(apiError(409, 'SECRET_ALREADY_EXISTS'))
    renderPage()
    await screen.findByText(/no hay secretos/i)
    await userEvent.type(screen.getByLabelText(/nombre del secreto/i), 'db_password')
    await userEvent.type(screen.getByLabelText(/^valor del secreto$/i), 'v')
    await userEvent.click(screen.getByRole('button', { name: /crear secreto/i }))
    expect(await screen.findByTestId('workspace-secrets-create-error')).toHaveTextContent(/ya existe un secreto/i)
  })

  it('delete confirmation shows the reference-safety warning (with the count when > 0)', async () => {
    mockListSecrets.mockResolvedValue({ items: [secret({ resolvedRefCount: 3 })], page: { size: 1 } })
    mockDeleteSecret.mockResolvedValue({ name: 'db_password', deleted: true })
    renderPage()

    // Row action carries a per-secret accessible name so screen-reader users can tell rows apart.
    await userEvent.click(await screen.findByRole('button', { name: /eliminar el secreto db_password/i }))
    const dialog = screen.getByRole('dialog', { name: /eliminar secreto/i })
    expect(within(dialog).getByTestId('workspace-secrets-delete-warning')).toHaveTextContent(/3 función/i)
    await userEvent.click(within(dialog).getByRole('button', { name: /eliminar secreto/i }))
    await waitFor(() => expect(mockDeleteSecret).toHaveBeenCalledWith('wrk_alpha', 'db_password'))
  })

  it('replace never pre-fills the value field and clears it after a successful submit', async () => {
    mockListSecrets
      .mockResolvedValueOnce({ items: [secret()], page: { size: 1 } })
      .mockResolvedValueOnce({ items: [secret()], page: { size: 1 } })
    mockUpdateSecret.mockResolvedValue(secret())
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /reemplazar/i }))
    const dialog = screen.getByRole('dialog', { name: /reemplazar secreto/i })
    const valueInput = within(dialog).getByLabelText(/nuevo valor del secreto/i) as HTMLInputElement
    // Never pre-filled from a read.
    expect(valueInput.value).toBe('')
    await userEvent.type(valueInput, 'rotated-value')
    await userEvent.click(within(dialog).getByRole('button', { name: /^reemplazar$/i }))
    await waitFor(() => expect(mockUpdateSecret).toHaveBeenCalledWith('wrk_alpha', 'db_password', { secretValue: 'rotated-value' }))
    expect(document.body.textContent).not.toContain('rotated-value')
  })

  it('renders a server 403 as a clean authorization error (defers to the server)', async () => {
    mockCreateSecret.mockRejectedValue(apiError(403, 'FORBIDDEN'))
    renderPage()
    await screen.findByText(/no hay secretos/i)
    await userEvent.type(screen.getByLabelText(/nombre del secreto/i), 'ok_name')
    await userEvent.type(screen.getByLabelText(/^valor del secreto$/i), 'v')
    await userEvent.click(screen.getByRole('button', { name: /crear secreto/i }))
    expect(await screen.findByTestId('workspace-secrets-create-error')).toHaveTextContent(/no tienes permisos/i)
  })

  it('renders 501 SECRETS_BACKEND_DISABLED as a first-class service-unavailable state', async () => {
    mockListSecrets.mockRejectedValue(apiError(501, 'SECRETS_BACKEND_DISABLED'))
    renderPage()
    expect(await screen.findByTestId('workspace-secrets-backend-disabled')).toBeInTheDocument()
    expect(screen.getByText(/servicio de secretos no disponible/i)).toBeInTheDocument()
  })

  it('shows a production stage badge for a production-environment workspace', async () => {
    renderPage(context({ activeWorkspace: { label: 'App Prod', environment: 'production' } }))
    expect(await screen.findByTestId('workspace-secrets-stage-badge')).toHaveTextContent(/producción/i)
  })

  it('submits the create form on Enter (real <form onSubmit>)', async () => {
    mockListSecrets
      .mockResolvedValueOnce({ items: [], page: { size: 0 } })
      .mockResolvedValueOnce({ items: [secret({ secretName: 'api_key' })], page: { size: 1 } })
    mockCreateSecret.mockResolvedValue(secret({ secretName: 'api_key' }))
    renderPage()

    await screen.findByText(/no hay secretos/i)
    await userEvent.type(screen.getByLabelText(/nombre del secreto/i), 'api_key')
    // Enter from within the masked value field submits the form (no explicit button click).
    await userEvent.type(screen.getByLabelText(/^valor del secreto$/i), 'super-secret-value{Enter}')
    await waitFor(() =>
      expect(mockCreateSecret).toHaveBeenCalledWith('wrk_alpha', { secretName: 'api_key', secretValue: 'super-secret-value' })
    )
  })

  it('announces the create outcome via an aria-live region without leaking the value', async () => {
    mockListSecrets
      .mockResolvedValueOnce({ items: [], page: { size: 0 } })
      .mockResolvedValueOnce({ items: [secret({ secretName: 'api_key' })], page: { size: 1 } })
    mockCreateSecret.mockResolvedValue(secret({ secretName: 'api_key' }))
    const { container } = renderPage()

    await screen.findByText(/no hay secretos/i)
    await userEvent.type(screen.getByLabelText(/nombre del secreto/i), 'api_key')
    await userEvent.type(screen.getByLabelText(/^valor del secreto$/i), 'super-secret-value')
    await userEvent.click(screen.getByRole('button', { name: /crear secreto/i }))

    const live = container.querySelector('[aria-live="polite"]') as HTMLElement
    await waitFor(() => expect(live).toHaveTextContent(/creado/i))
    expect(live.textContent).not.toContain('super-secret-value')
  })

  it('replace and delete dialogs expose aria-modal and close on Escape', async () => {
    mockListSecrets.mockResolvedValue({ items: [secret()], page: { size: 1 } })
    renderPage()

    // Replace dialog: modal semantics + Escape-to-close (shared Dialog focus/escape behavior).
    await userEvent.click(await screen.findByRole('button', { name: /reemplazar el secreto/i }))
    const replaceDialog = screen.getByRole('dialog', { name: /reemplazar secreto/i })
    expect(replaceDialog).toHaveAttribute('aria-modal', 'true')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /reemplazar secreto/i })).not.toBeInTheDocument())

    // Delete dialog: same modal contract; Escape dismisses without calling the API.
    await userEvent.click(await screen.findByRole('button', { name: /eliminar el secreto/i }))
    const deleteDialog = screen.getByRole('dialog', { name: /eliminar secreto/i })
    expect(deleteDialog).toHaveAttribute('aria-modal', 'true')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /eliminar secreto/i })).not.toBeInTheDocument())
    expect(mockDeleteSecret).not.toHaveBeenCalled()
  })

  it('returns focus to the row trigger after a dialog closes', async () => {
    mockListSecrets.mockResolvedValue({ items: [secret()], page: { size: 1 } })
    renderPage()

    const trigger = await screen.findByRole('button', { name: /reemplazar el secreto/i })
    await userEvent.click(trigger)
    await screen.findByRole('dialog', { name: /reemplazar secreto/i })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
