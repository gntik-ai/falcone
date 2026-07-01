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

describe('EventsConsole — UX enriquecida', () => {
  it('carga tópicos y los lista con el contador', async () => {
    render1()
    expect(screen.getByText('Cargando tópicos…')).toBeInTheDocument()
    expect(await screen.findByText('orders')).toBeInTheDocument()
    expect(screen.getByText('Tópicos (1)')).toBeInTheDocument()
  })

  it('muestra el empty state sin tópicos', async () => {
    mocked.listTopics.mockResolvedValue({ items: [] })
    render1()
    expect(await screen.findByText('Todavía no hay tópicos.')).toBeInTheDocument()
  })

  it('publica un mensaje en el tópico seleccionado', async () => {
    mocked.publishMessage.mockResolvedValue({ offset: 5 })
    render1()
    await screen.findByText('orders')
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /orders/ }))
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText(/Mensaje \(JSON/), { target: { value: '{"value":{"a":1}}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    await waitFor(() => expect(mocked.publishMessage).toHaveBeenCalledWith('ws1', 'orders', { value: { a: 1 } }))
    expect(await screen.findByRole('status')).toHaveTextContent('Publicado en "orders"')
  })

  it('consumes messages and shows an empty note when none', async () => {
    mocked.consumeMessages.mockResolvedValue({ items: [] })
    render1()
    await screen.findByText('orders')
    fireEvent.click(screen.getByRole('radio', { name: /orders/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Consultar mensajes' }))
    expect(await screen.findByText('No hay mensajes.')).toBeInTheDocument()
  })

  it('crea un tópico y recarga', async () => {
    mocked.createTopic.mockResolvedValue({ topic: 'events' })
    render1()
    await screen.findByText('orders')
    fireEvent.change(screen.getByLabelText('Nuevo tópico'), { target: { value: 'events' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear tópico' }))
    await waitFor(() => expect(mocked.createTopic).toHaveBeenCalledWith('ws1', 'events'))
    expect(mocked.listTopics).toHaveBeenCalledTimes(2)
  })

  it('does not offer create or publish actions to non-admin roles', async () => {
    renderReadOnly()
    await screen.findByText('orders')
    expect(screen.getByText(/Las escrituras de eventos están restringidas/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Nuevo tópico')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Mensaje \(JSON/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Crear tópico' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument()
    const pollButton = screen.getByRole('button', { name: 'Consultar mensajes' })
    expect(pollButton).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /orders/ }))
    expect(pollButton).toBeEnabled()
  })
})
