import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateWorkspaceWizard } from './CreateWorkspaceWizard'

const requestMock = vi.fn()
const readConsoleShellSessionMock = vi.fn()
const useConsoleQuotasMock = vi.fn()

vi.mock('@/lib/console-context', () => ({ useConsoleContext: () => ({ activeTenantId: 'ten_alpha', activeWorkspaceId: 'wrk_a1' }) }))
vi.mock('@/lib/console-session', () => ({ readConsoleShellSession: () => readConsoleShellSessionMock(), requestConsoleSessionJson: (...args: unknown[]) => requestMock(...args) }))
vi.mock('@/lib/console-quotas', () => ({ useConsoleQuotas: () => useConsoleQuotasMock() }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  requestMock.mockReset()
  readConsoleShellSessionMock.mockReset()
  useConsoleQuotasMock.mockReset()
  readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['superadmin'] } })
  useConsoleQuotasMock.mockReturnValue({ posture: null, workspacePosture: null, loading: false })
})

async function advanceToConfigStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /siguiente/i }))
  await user.type(screen.getByLabelText(/nombre del workspace/i), 'Workspace Nuevo')
  await user.click(screen.getByRole('button', { name: /siguiente/i }))
}

describe('CreateWorkspaceWizard', () => {
  it('[RW-01] happy path confirma creación — RF-UI-025 / T02-AC1', async () => {
    const user = userEvent.setup()
    requestMock.mockResolvedValue({ workspaceId: 'wrk_new' })
    render(<MemoryRouter><CreateWorkspaceWizard open onOpenChange={vi.fn()} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/nombre del workspace/i), 'Workspace Nuevo')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/descripción/i), 'Workspace principal')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(requestMock).toHaveBeenCalledWith('/v1/tenants/ten_alpha/workspaces', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ name: 'Workspace Nuevo', initialLimits: { maxFunctions: 10, maxDatabases: 5 } }) }))
    expect(await screen.findByText(/recurso creado correctamente/i)).toBeInTheDocument()
  })

  it.each([
    { field: /máx\. funciones/i, value: '', error: /máx\. funciones es obligatorio/i },
    { field: /máx\. funciones/i, value: 'abc', error: /máx\. funciones debe ser un número entero/i },
    { field: /máx\. funciones/i, value: '0', error: /máx\. funciones debe estar entre 1 y 9007199254740991/i },
    { field: /máx\. funciones/i, value: '-1', error: /máx\. funciones debe estar entre 1 y 9007199254740991/i },
    { field: /máx\. funciones/i, value: '9007199254740992', error: /máx\. funciones debe estar entre 1 y 9007199254740991/i },
    { field: /máx\. bases de datos/i, value: '', error: /máx\. bases de datos es obligatorio/i },
    { field: /máx\. bases de datos/i, value: 'abc', error: /máx\. bases de datos debe ser un número entero/i },
    { field: /máx\. bases de datos/i, value: '0', error: /máx\. bases de datos debe estar entre 1 y 9007199254740991/i },
    { field: /máx\. bases de datos/i, value: '-1', error: /máx\. bases de datos debe estar entre 1 y 9007199254740991/i },
    { field: /máx\. bases de datos/i, value: '9007199254740992', error: /máx\. bases de datos debe estar entre 1 y 9007199254740991/i }
  ])('[RW-09] límites numéricos del workspace rechazan $value en $field — issue #807', async ({ field, value, error }) => {
    const user = userEvent.setup()
    render(<MemoryRouter><CreateWorkspaceWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await advanceToConfigStep(user)

    const input = screen.getByLabelText(field)
    await user.clear(input)
    if (value) await user.type(input, value)

    expect(screen.getByText(error)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('[RW-02] bloqueo por validación — RF-UI-025 / T02-AC2', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><CreateWorkspaceWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
  })

  it('[RW-06] error de backend preserva datos — RF-UI-025 / T02-AC6', async () => {
    const user = userEvent.setup()
    requestMock.mockRejectedValue(new Error('workspace failed'))
    render(<MemoryRouter><CreateWorkspaceWizard open onOpenChange={vi.fn()} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/nombre del workspace/i), 'Workspace Nuevo')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(await screen.findByText(/workspace failed/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    expect(screen.getByLabelText(/nombre del workspace/i)).toHaveValue('Workspace Nuevo')
  })

  it('[RW-07] cuota excedida bloquea el wizard — RF-UI-025 / T02-AC7', async () => {
    const user = userEvent.setup()
    useConsoleQuotasMock.mockReturnValue({ posture: { dimensions: [{ dimensionId: 'workspaces.count', isExceeded: true, remainingToHardLimit: 0 }] }, workspacePosture: null, loading: false })
    render(<MemoryRouter><CreateWorkspaceWizard open onOpenChange={vi.fn()} /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/nombre del workspace/i), 'Workspace Nuevo')
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
    expect(screen.getByText(/la cuota disponible para este recurso está agotada/i)).toBeInTheDocument()
  })

  it('[RW-08] sin permisos muestra mensaje de permisos insuficientes — RF-UI-025 / T02-AC8', () => {
    readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['member'] } })
    render(<MemoryRouter><CreateWorkspaceWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/acceso bloqueado/i)).toBeInTheDocument()
  })
})
