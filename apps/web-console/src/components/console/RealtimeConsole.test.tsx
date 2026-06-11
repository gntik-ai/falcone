import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/realtimeApi', () => ({
  subscribeRealtimeChanges: vi.fn()
}))

import { RealtimeConsole } from './RealtimeConsole'
import { subscribeRealtimeChanges } from '@/services/realtimeApi'

const mocked = subscribeRealtimeChanges as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

function fillForm() {
  fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'appdb' } })
  fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'notes' } })
  fireEvent.change(screen.getByLabelText('Anon key'), { target: { value: 'flc_anon_x' } })
}

describe('RealtimeConsole', () => {
  it('requires database, collection, and an anon key before subscribing', () => {
    render(<RealtimeConsole workspaceId="ws1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Database, collection, and an anon key are required')
    expect(mocked).not.toHaveBeenCalled()
  })

  it('subscribes with the workspace + form values and renders streamed changes', async () => {
    let onChange: ((c: unknown) => void) | undefined
    mocked.mockImplementation((params: { onChange: (c: unknown) => void }) => {
      onChange = params.onChange
      return { close: vi.fn() }
    })
    render(<RealtimeConsole workspaceId="ws1" />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))

    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        apiKey: 'flc_anon_x',
        target: { source: 'mongo', databaseName: 'appdb', collectionName: 'notes' }
      })
    )
    expect(screen.getByText(/Listening…/)).toBeInTheDocument()

    // a change arrives on the stream
    act(() => onChange?.({ type: 'insert', documentId: 'd1', document: { _id: 'd1', body: 'live' } }))
    expect(await screen.findByText(/"body":"live"/)).toBeInTheDocument()
    expect(screen.getByText('insert')).toBeInTheDocument()
  })

  it('subscribes to a Postgres table when the source is switched', () => {
    mocked.mockReturnValue({ close: vi.fn() })
    render(<RealtimeConsole workspaceId="ws1" />)
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'postgres' } })
    fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'appdb' } })
    fireEvent.change(screen.getByLabelText('Schema'), { target: { value: 'public' } })
    fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'notes' } })
    fireEvent.change(screen.getByLabelText('Anon key'), { target: { value: 'flc_anon_x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        target: { source: 'postgres', databaseName: 'appdb', schemaName: 'public', tableName: 'notes' }
      })
    )
  })

  it('Stop closes the subscription', () => {
    const close = vi.fn()
    mocked.mockReturnValue({ close })
    render(<RealtimeConsole workspaceId="ws1" />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(close).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()
  })
})
