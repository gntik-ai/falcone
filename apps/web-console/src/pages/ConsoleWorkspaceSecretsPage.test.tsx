import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceSecret } from '@/services/secretsApi'

import { ConsoleWorkspaceSecretsPage } from './ConsoleWorkspaceSecretsPage'

const mockUseConsoleContext = vi.fn()
const mockListSecrets = vi.fn()
const mockCreateSecret = vi.fn()
const mockUpdateSecret = vi.fn()
const mockDeleteSecret = vi.fn()
const mockReadConsoleShellSession = vi.fn()

vi.mock('@/lib/console-context', () => ({
  getConsoleContextStatusBadgeClasses: (tone: 'healthy' | 'warning' | 'restricted' | 'neutral') => {
    if (tone === 'restricted') return 'border-destructive/40 bg-destructive/10 text-red-300'
    if (tone === 'warning') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    if (tone === 'healthy') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    return 'border-border bg-muted/40 text-muted-foreground'
  },
  useConsoleContext: () => mockUseConsoleContext()
}))
vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: () => mockReadConsoleShellSession()
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
    workspaces: Array<{ workspaceId: string; tenantId: string; label: string; secondary: string }>
    workspacesLoading: boolean
    workspacesError: string | null
    selectWorkspace: (workspaceId: string | null) => void
    reloadWorkspaces: () => Promise<void>
  }> = {}
) {
  return {
    activeTenantId: 'ten_alpha',
    activeWorkspaceId: 'wrk_alpha',
    activeTenant: { label: 'Acme' },
    activeWorkspace: { label: 'App Dev', environment: 'dev' },
    workspaces: [],
    workspacesLoading: false,
    workspacesError: null,
    selectWorkspace: vi.fn(),
    reloadWorkspaces: vi.fn(),
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
  return render(<ConsoleWorkspaceSecretsPage />, { wrapper: MemoryRouter })
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
    mockReadConsoleShellSession.mockReset()
    mockReadConsoleShellSession.mockReturnValue({ principal: { userId: 'usr_1', platformRoles: ['tenant_owner'] } })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a "select a workspace" empty state and issues NO request when no workspace is active', () => {
    renderPage(context({ activeWorkspaceId: null }))
    expect(screen.getByRole('status')).toHaveTextContent(/selecciona un área de trabajo/i)
    expect(mockListSecrets).not.toHaveBeenCalled()
  })

  // #742: the no-workspace guard is the shared WorkspaceRequiredState — assert its inline action.
  it('[#742] offers a create-workspace CTA when the active organization has none', () => {
    renderPage(context({ activeWorkspaceId: null, workspaces: [] }))
    expect(screen.getByRole('link', { name: /crear área de trabajo/i })).toHaveAttribute('href', '/console/workspaces')
    expect(mockListSecrets).not.toHaveBeenCalled()
  })

  it('[#742] offers an inline picker that activates the chosen workspace when workspaces already exist', async () => {
    const user = userEvent.setup()
    const selectWorkspace = vi.fn()
    renderPage(
      context({
        activeWorkspaceId: null,
        workspaces: [
          { workspaceId: 'wrk_alpha', tenantId: 'ten_alpha', label: 'App Dev', secondary: 'dev' },
          { workspaceId: 'wrk_beta', tenantId: 'ten_alpha', label: 'App Staging', secondary: 'staging' }
        ],
        selectWorkspace
      })
    )

    await user.selectOptions(screen.getByRole('combobox', { name: /seleccionar área de trabajo/i }), 'wrk_beta')
    expect(selectWorkspace).toHaveBeenCalledWith('wrk_beta')
  })

  it('lists secrets as metadata only (env-var, refCount, timestamps) with no value in the DOM', async () => {
    mockListSecrets.mockResolvedValue({ items: [secret({ resolvedRefCount: 2, description: 'prod db' })], page: { size: 1 } })
    renderPage()

    expect(await screen.findByText('db_password')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: /secretos de función/i })
    expect(table).toHaveAttribute('data-slot', 'table')
    const removedHardWidthClass = ['min-w', '[64rem]'].join('-')
    expect(table.className).not.toContain(removedHardWidthClass)
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

  it('[#772] reports name and value validation per field in one submit', async () => {
    renderPage()
    await screen.findByText(/no hay secretos/i)
    const nameInput = screen.getByLabelText(/nombre del secreto/i)
    const valueInput = screen.getByLabelText(/^valor del secreto$/i)

    await userEvent.click(screen.getByRole('button', { name: /crear secreto/i }))

    const nameError = screen.getByText(/el nombre del secreto es obligatorio/i)
    const valueError = screen.getByText(/el valor del secreto es obligatorio/i)
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(valueInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput.getAttribute('aria-describedby')).toContain(nameError.id)
    expect(valueInput.getAttribute('aria-describedby')).toContain(valueError.id)
    expect(mockCreateSecret).not.toHaveBeenCalled()
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

  it('[#772] requires type-to-confirm delete and shows referenced functions in the shared destructive dialog', async () => {
    mockListSecrets.mockResolvedValue({ items: [secret({ resolvedRefCount: 3 })], page: { size: 1 } })
    mockDeleteSecret.mockResolvedValue({ name: 'db_password', deleted: true })
    renderPage()

    // Row action carries a per-secret accessible name so screen-reader users can tell rows apart.
    await userEvent.click(await screen.findByRole('button', { name: /eliminar el secreto db_password/i }))
    const dialog = screen.getByRole('alertdialog', { name: /eliminar secreto del área de trabajo/i })
    expect(dialog).toHaveTextContent(/3 función/i)
    expect(dialog).toHaveTextContent(/funciones que lo usan\s*\/\s*3/i)
    const confirmButton = within(dialog).getByRole('button', { name: /^eliminar$/i })
    expect(confirmButton).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/escribe exactamente el nombre/i), 'db_password')
    expect(confirmButton).toBeEnabled()
    await userEvent.click(confirmButton)
    await waitFor(() => expect(mockDeleteSecret).toHaveBeenCalledWith('wrk_alpha', 'db_password'))
    const feedback = await screen.findByTestId('workspace-secrets-table-feedback')
    expect(feedback).toHaveTextContent(/eliminado/i)
    expect(feedback).toHaveAttribute('role', 'status')
    expect(feedback).toHaveAttribute('aria-live', 'polite')
  })

  it('[#772] requires type-to-confirm delete in production even when no references are currently detected', async () => {
    mockListSecrets.mockResolvedValue({ items: [secret({ resolvedRefCount: 0 })], page: { size: 1 } })
    renderPage(context({ activeWorkspace: { label: 'App Prod', environment: 'production' } }))

    await userEvent.click(await screen.findByRole('button', { name: /eliminar el secreto db_password/i }))
    const dialog = screen.getByRole('alertdialog', { name: /eliminar secreto del área de trabajo/i })
    expect(dialog).toHaveTextContent(/producción/i)
    expect(within(dialog).getByRole('button', { name: /^eliminar$/i })).toBeDisabled()
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
    const replaceButton = within(dialog).getByRole('button', { name: /^reemplazar$/i })
    await userEvent.click(replaceButton)
    const validation = await within(dialog).findByText(/el valor del secreto es obligatorio/i)
    expect(valueInput).toHaveAttribute('aria-invalid', 'true')
    expect(valueInput.getAttribute('aria-describedby')).toContain(validation.id)
    expect(mockUpdateSecret).not.toHaveBeenCalled()
    await userEvent.type(valueInput, 'rotated-value')
    expect(valueInput).not.toHaveAttribute('aria-invalid')
    await userEvent.click(replaceButton)
    await waitFor(() => expect(mockUpdateSecret).toHaveBeenCalledWith('wrk_alpha', 'db_password', { secretValue: 'rotated-value' }))
    const feedback = await screen.findByTestId('workspace-secrets-row-feedback')
    expect(feedback).toHaveTextContent(/reemplazado/i)
    expect(feedback).toHaveAttribute('role', 'status')
    expect(feedback).toHaveAttribute('aria-live', 'polite')
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
    const badge = await screen.findByTestId('workspace-secrets-stage-badge')
    expect(badge).toHaveTextContent(/producción/i)
    expect(badge.className).toContain('bg-destructive/10')
    expect(badge.className).toContain('text-red-300')
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
    const status = within(live).getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status.textContent).not.toContain('super-secret-value')
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
    const deleteDialog = screen.getByRole('alertdialog', { name: /confirmar acción/i })
    expect(deleteDialog).toHaveAttribute('aria-modal', 'true')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
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
