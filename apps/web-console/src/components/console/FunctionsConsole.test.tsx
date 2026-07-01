import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/functionsApi', () => ({
  listFunctions: vi.fn(),
  deployFunction: vi.fn(),
  invokeFunction: vi.fn(),
  listActivations: vi.fn()
}))

import { FunctionsConsole } from './FunctionsConsole'
import { deployFunction, invokeFunction, listActivations, listFunctions } from '@/services/functionsApi'

const mocked = {
  listFunctions: listFunctions as unknown as ReturnType<typeof vi.fn>,
  deployFunction: deployFunction as unknown as ReturnType<typeof vi.fn>,
  invokeFunction: invokeFunction as unknown as ReturnType<typeof vi.fn>,
  listActivations: listActivations as unknown as ReturnType<typeof vi.fn>
}

const render1 = () => render(<FunctionsConsole tenantId="ten_1" workspaceId="ws1" />)
const functionItem = {
  resourceId: 'res_fn_1',
  actionName: 'hello',
  execution: { runtime: 'nodejs:20', entrypoint: 'main' },
  source: { kind: 'inline_code', inlineCode: 'exports.main=()=>({ok:true})' },
  activationPolicy: {
    logsAccess: 'workspace_developers',
    resultAccess: 'workspace_developers',
    rerunPolicy: 'manual_only',
    retentionHours: 168
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.listFunctions.mockResolvedValue({ items: [functionItem] })
  mocked.deployFunction.mockResolvedValue(functionItem)
})
afterEach(() => cleanup())

describe('FunctionsConsole — richer UX', () => {
  it('loads functions, then lists them with a count', async () => {
    render1()
    expect(screen.getByRole('status', { name: 'Cargando funciones…' })).toBeInTheDocument()
    expect(await screen.findByText('hello')).toBeInTheDocument()
    expect(screen.getByText('nodejs:20')).toBeInTheDocument()
    expect(screen.getByText('Funciones (1)')).toBeInTheDocument()
  })

  it('shows an empty state with no functions', async () => {
    mocked.listFunctions.mockResolvedValue({ items: [] })
    render1()
    expect(await screen.findByRole('status', { name: 'No hay funciones desplegadas todavía.' })).toBeInTheDocument()
  })

  it('invokes the selected function and shows the result', async () => {
    mocked.invokeFunction.mockResolvedValue({ result: { ok: true } })
    render1()
    await screen.findByText('hello')
    fireEvent.click(screen.getByRole('radio', { name: /hello \(nodejs:20\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Invocar' }))
    await waitFor(() => expect(mocked.invokeFunction).toHaveBeenCalledWith('res_fn_1', {}))
    expect(await screen.findByText(/"ok": true/)).toBeInTheDocument()
  })

  it('views activations for the selected function', async () => {
    mocked.listActivations.mockResolvedValue({ items: [{ activationId: 'a1', status: 'success', durationMs: 12 }] })
    render1()
    await screen.findByText('hello')
    fireEvent.click(screen.getByRole('radio', { name: /hello \(nodejs:20\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Ver activaciones' }))
    await waitFor(() => expect(mocked.listActivations).toHaveBeenCalledWith('res_fn_1'))
    expect(await screen.findByText('a1')).toBeInTheDocument()
    expect(screen.getByText(/success/)).toBeInTheDocument()
    expect(screen.getByText(/\(12ms\)/)).toBeInTheDocument()
  })

  it('shows an activations empty state after a successful lookup with no records', async () => {
    mocked.listActivations.mockResolvedValue({ items: [] })
    render1()
    await screen.findByText('hello')
    fireEvent.click(screen.getByRole('radio', { name: /hello \(nodejs:20\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Ver activaciones' }))
    await waitFor(() => expect(mocked.listActivations).toHaveBeenCalledWith('res_fn_1'))
    expect(await screen.findByRole('status', { name: 'No hay activaciones para esta función.' })).toBeInTheDocument()
  })

  it('requires a selection before invoking', async () => {
    render1()
    await screen.findByText('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Invocar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Selecciona una función para invocar')
  })

  it('deploy validation accepts actionName from contract-shaped JSON', async () => {
    render1()
    await screen.findByText('hello')
    fireEvent.change(screen.getByLabelText('Especificación de función (JSON)'), {
      target: { value: '{"actionName":"from-contract","runtime":"nodejs:20","code":"exports.main=()=>({ok:true})"}' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar' }))
    await waitFor(() => expect(mocked.deployFunction).toHaveBeenCalledWith('ws1', expect.objectContaining({
      actionName: 'from-contract'
    }), 'ten_1'))
  })

  it('deploy validation still accepts legacy name from the simple JSON editor', async () => {
    render1()
    await screen.findByText('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar' }))
    await waitFor(() => expect(mocked.deployFunction).toHaveBeenCalledWith('ws1', expect.objectContaining({
      name: 'hello'
    }), 'ten_1'))
  })

  it('rejects deploy JSON with neither actionName nor legacy name', async () => {
    render1()
    await screen.findByText('hello')
    fireEvent.change(screen.getByLabelText('Especificación de función (JSON)'), {
      target: { value: '{"runtime":"nodejs:20","code":"exports.main=()=>({ok:true})"}' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('La especificación de despliegue debe incluir "actionName" o el campo heredado "name"')
    expect(mocked.deployFunction).not.toHaveBeenCalled()
  })

  it('does not pass undefined to invoke or activations for a contract-shaped list item', async () => {
    mocked.invokeFunction.mockResolvedValue({ result: { ok: true } })
    mocked.listActivations.mockResolvedValue({ items: [] })
    render1()
    await screen.findByText('hello')
    fireEvent.click(screen.getByRole('radio', { name: /hello \(nodejs:20\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Invocar' }))
    await waitFor(() => expect(mocked.invokeFunction).toHaveBeenCalledWith('res_fn_1', {}))
    await screen.findByText(/"ok": true/)
    fireEvent.click(screen.getByRole('button', { name: 'Ver activaciones' }))
    await waitFor(() => expect(mocked.listActivations).toHaveBeenCalledWith('res_fn_1'))
    expect(mocked.invokeFunction.mock.calls.flat()).not.toContain(undefined)
    expect(mocked.listActivations.mock.calls.flat()).not.toContain(undefined)
  })
})
