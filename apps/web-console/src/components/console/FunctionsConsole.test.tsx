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

const render1 = () => render(<FunctionsConsole workspaceId="ws1" />)

beforeEach(() => {
  vi.clearAllMocks()
  mocked.listFunctions.mockResolvedValue({ items: [{ name: 'hello', runtime: 'nodejs' }] })
})
afterEach(() => cleanup())

describe('FunctionsConsole — richer UX', () => {
  it('loads functions, then lists them with a count', async () => {
    render1()
    expect(screen.getByText('Loading functions…')).toBeInTheDocument()
    expect(await screen.findByText(/hello/)).toBeInTheDocument()
    expect(screen.getByText('Functions (1)')).toBeInTheDocument()
  })

  it('shows an empty state with no functions', async () => {
    mocked.listFunctions.mockResolvedValue({ items: [] })
    render1()
    expect(await screen.findByText('No functions deployed yet.')).toBeInTheDocument()
  })

  it('invokes the selected function and shows the result', async () => {
    mocked.invokeFunction.mockResolvedValue({ result: { ok: true } })
    render1()
    await screen.findByText(/hello/)
    fireEvent.click(screen.getByRole('radio', { name: /hello/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Invoke' }))
    await waitFor(() => expect(mocked.invokeFunction).toHaveBeenCalledWith('ws1', 'hello', {}))
    expect(await screen.findByText(/"ok": true/)).toBeInTheDocument()
  })

  it('views activations for the selected function', async () => {
    mocked.listActivations.mockResolvedValue({ items: [{ activationId: 'a1', status: 'success', durationMs: 12 }] })
    render1()
    await screen.findByText(/hello/)
    fireEvent.click(screen.getByRole('radio', { name: /hello/ }))
    fireEvent.click(screen.getByRole('button', { name: 'View activations' }))
    expect(await screen.findByText(/a1 — success \(12ms\)/)).toBeInTheDocument()
  })

  it('requires a selection before invoking', async () => {
    render1()
    await screen.findByText(/hello/)
    fireEvent.click(screen.getByRole('button', { name: 'Invoke' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Select a function to invoke')
  })
})
