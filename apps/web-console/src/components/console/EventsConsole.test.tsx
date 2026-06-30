import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/eventsApi', () => ({
  listTopics: vi.fn(),
  createTopic: vi.fn(),
  publishMessage: vi.fn(),
  consumeMessages: vi.fn()
}))

import { EventsConsole } from './EventsConsole'
import { consumeMessages, createTopic, listTopics, publishMessage } from '@/services/eventsApi'

const mocked = {
  listTopics: listTopics as unknown as ReturnType<typeof vi.fn>,
  createTopic: createTopic as unknown as ReturnType<typeof vi.fn>,
  publishMessage: publishMessage as unknown as ReturnType<typeof vi.fn>,
  consumeMessages: consumeMessages as unknown as ReturnType<typeof vi.fn>
}

const render1 = () => render(<EventsConsole workspaceId="ws1" />)
const renderReadOnly = () => render(<EventsConsole workspaceId="ws1" canManageEvents={false} />)

beforeEach(() => {
  vi.clearAllMocks()
  mocked.listTopics.mockResolvedValue({ items: [{ topic: 'orders' }] })
})
afterEach(() => cleanup())

describe('EventsConsole — richer UX', () => {
  it('loads topics, then lists them with a count', async () => {
    render1()
    expect(screen.getByText('Loading topics…')).toBeInTheDocument()
    expect(await screen.findByText('orders')).toBeInTheDocument()
    expect(screen.getByText('Topics (1)')).toBeInTheDocument()
  })

  it('shows an empty state with no topics', async () => {
    mocked.listTopics.mockResolvedValue({ items: [] })
    render1()
    expect(await screen.findByText('No topics yet.')).toBeInTheDocument()
  })

  it('publishes a message to the selected topic', async () => {
    mocked.publishMessage.mockResolvedValue({ offset: 5 })
    render1()
    await screen.findByText('orders')
    fireEvent.click(screen.getByRole('radio', { name: /orders/ }))
    fireEvent.change(screen.getByLabelText(/Message \(JSON/), { target: { value: '{"value":{"a":1}}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(mocked.publishMessage).toHaveBeenCalledWith('ws1', 'orders', { value: { a: 1 } }))
    expect(await screen.findByRole('status')).toHaveTextContent('Published to "orders"')
  })

  it('consumes messages and shows an empty note when none', async () => {
    mocked.consumeMessages.mockResolvedValue({ items: [] })
    render1()
    await screen.findByText('orders')
    fireEvent.click(screen.getByRole('radio', { name: /orders/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Poll messages' }))
    expect(await screen.findByText('No messages.')).toBeInTheDocument()
  })

  it('creates a topic and reloads', async () => {
    mocked.createTopic.mockResolvedValue({ topic: 'events' })
    render1()
    await screen.findByText('orders')
    fireEvent.change(screen.getByLabelText('New topic'), { target: { value: 'events' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create topic' }))
    await waitFor(() => expect(mocked.createTopic).toHaveBeenCalledWith('ws1', 'events'))
    expect(mocked.listTopics).toHaveBeenCalledTimes(2)
  })

  it('does not offer create or publish actions to non-admin roles', async () => {
    renderReadOnly()
    await screen.findByText('orders')
    expect(screen.queryByRole('button', { name: 'Create topic' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Poll messages' })).toBeInTheDocument()
  })
})
