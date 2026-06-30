import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PublishFunctionWizard } from './PublishFunctionWizard'

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

async function advanceToRuntimeStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /siguiente/i }))
  await user.type(screen.getByLabelText(/^nombre$/i), 'hello')
  await user.click(screen.getByRole('button', { name: /siguiente/i }))
  await user.selectOptions(screen.getByLabelText(/runtime/i), 'nodejs:20')
}

describe('PublishFunctionWizard', () => {
  it('[#754] tenant_owner abre y completa el wizard de publicación sin bloqueo cliente', async () => {
    const user = userEvent.setup()
    readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles: ['tenant_owner'] } })
    requestMock.mockResolvedValue({ functionId: 'fn_tenant_owner' })

    render(<MemoryRouter><PublishFunctionWizard open onOpenChange={vi.fn()} /></MemoryRouter>)

    expect(screen.queryByText(/acceso bloqueado/i)).not.toBeInTheDocument()
    expect(screen.getByText(/publicar función/i)).toBeInTheDocument()
    expect(screen.getAllByText(/workspace/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/metadatos/i)).toBeInTheDocument()
    expect(screen.getByText(/runtime/i)).toBeInTheDocument()
    expect(screen.getByText(/trigger/i)).toBeInTheDocument()
    expect(screen.getByText(/resumen/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/^nombre$/i), 'hello')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/runtime/i), 'nodejs:20')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))

    expect(requestMock).toHaveBeenCalledWith('/v1/workspaces/wrk_a1/functions', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        name: 'hello',
        runtime: 'nodejs:20',
        limits: { memoryMb: 256, timeoutMs: 30000 }
      })
    }))
    expect(await screen.findByText(/recurso creado correctamente/i)).toBeInTheDocument()
  })

  it('[RW-02] bloqueo por validación — RF-UI-025 / T02-AC2', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><PublishFunctionWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
  })

  it('[RW-05] confirmación exitosa muestra feedback con ID y URL — RF-UI-025 / T02-AC5', async () => {
    const user = userEvent.setup()
    requestMock.mockResolvedValue({ functionId: 'fn_new' })
    render(<MemoryRouter><PublishFunctionWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/^nombre$/i), 'hello')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/runtime/i), 'nodejs:20')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(requestMock).toHaveBeenCalledWith('/v1/workspaces/wrk_a1/functions', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ limits: { memoryMb: 256, timeoutMs: 30000 } }) }))
    expect(await screen.findByText(/recurso creado correctamente/i)).toBeInTheDocument()
    expect(screen.getByText(/fn_new/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /abrir recurso/i })).toHaveAttribute('href', '/console/functions')
  })

  it.each([
    { field: /memoria/i, value: '', error: /memoria es obligatorio/i },
    { field: /memoria/i, value: 'abc', error: /memoria debe ser un número entero/i },
    { field: /memoria/i, value: '0', error: /memoria debe estar entre 128 y 2048/i },
    { field: /memoria/i, value: '-1', error: /memoria debe estar entre 128 y 2048/i },
    { field: /memoria/i, value: '2049', error: /memoria debe estar entre 128 y 2048/i },
    { field: /timeout/i, value: '', error: /timeout es obligatorio/i },
    { field: /timeout/i, value: 'abc', error: /timeout debe ser un número entero/i },
    { field: /timeout/i, value: '0', error: /timeout debe estar entre 1 y 900000/i },
    { field: /timeout/i, value: '-1', error: /timeout debe estar entre 1 y 900000/i },
    { field: /timeout/i, value: '900001', error: /timeout debe estar entre 1 y 900000/i }
  ])('[RW-09] límites numéricos de función rechazan $value en $field — issue #807', async ({ field, value, error }) => {
    const user = userEvent.setup()
    render(<MemoryRouter><PublishFunctionWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await advanceToRuntimeStep(user)

    const input = screen.getByLabelText(field)
    await user.clear(input)
    if (value) await user.type(input, value)

    expect(screen.getByText(error)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('[RW-06] error backend preserva datos — RF-UI-025 / T02-AC6', async () => {
    const user = userEvent.setup()
    requestMock.mockRejectedValue(new Error('fn failed'))
    render(<MemoryRouter><PublishFunctionWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.type(screen.getByLabelText(/^nombre$/i), 'hello')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.selectOptions(screen.getByLabelText(/runtime/i), 'nodejs:20')
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /siguiente/i }))
    await user.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(await screen.findByText(/fn failed/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    await user.click(screen.getByRole('button', { name: /anterior/i }))
    expect(screen.getByLabelText(/^nombre$/i)).toHaveValue('hello')
  })

  it.each([
    { label: 'tenant_member', platformRoles: ['tenant_member'] },
    { label: 'sin roles', platformRoles: [] }
  ])('[RW-08] $label muestra mensaje de permisos insuficientes — RF-UI-025 / T02-AC8', ({ platformRoles }) => {
    readConsoleShellSessionMock.mockReturnValue({ principal: { platformRoles } })
    render(<MemoryRouter><PublishFunctionWizard open onOpenChange={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/acceso bloqueado/i)).toBeInTheDocument()
  })
})
