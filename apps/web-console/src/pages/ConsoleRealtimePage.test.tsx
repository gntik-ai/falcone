import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsoleRealtimePage, mapChannelTypes } from './ConsoleRealtimePage'

const requestConsoleSessionJsonMock = vi.fn()
const panelSpy = vi.fn()

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: (...args: unknown[]) => requestConsoleSessionJsonMock(...args)
}))

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => ({
    activeWorkspaceId: 'ws-fallback',
    capabilities: { realtime: true },
    capabilitiesLoading: false
  })
}))

vi.mock('@/components/console/snippets/RealtimeSnippetsPanel', () => ({
  RealtimeSnippetsPanel: (props: unknown) => {
    panelSpy(props)
    return <div>Realtime panel mock</div>
  }
}))

describe('ConsoleRealtimePage', () => {
  beforeEach(() => {
    requestConsoleSessionJsonMock.mockReset()
    panelSpy.mockReset()
  })

  function renderPage(path = '/console/workspaces/ws_123/realtime') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/console/workspaces/:workspaceId/realtime" element={<ConsoleRealtimePage />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('muestra loading mientras carga', () => {
    requestConsoleSessionJsonMock.mockReturnValue(new Promise(() => undefined))
    renderPage()
    expect(screen.getByTestId('realtime-loading-skeleton')).toBeInTheDocument()
  })

  it('renderiza panel con props correctas en éxito', async () => {
    requestConsoleSessionJsonMock.mockResolvedValue({
      workspaceId: 'ws_123',
      realtimeEndpointUrl: 'wss://rt.example.test',
      features: { realtime: true },
      dataSources: [{ type: 'postgresql' }]
    })

    renderPage()

    expect(await screen.findByText('Realtime panel mock')).toBeInTheDocument()
    expect(panelSpy).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_123',
      realtimeEndpoint: 'wss://rt.example.test',
      channelTypes: ['postgresql-changes'],
      realtimeEnabled: true
    }))
  })

  it('renderiza error si falla la carga', async () => {
    // [#743] a network/unknown-status failure must render the shared, localized error state —
    // never the raw thrown message.
    requestConsoleSessionJsonMock.mockRejectedValue(new Error('boom'))
    renderPage()
    const alert = await waitFor(() => screen.getByRole('alert'))
    expect(alert).toHaveTextContent(/no se pudo cargar la configuración realtime del área de trabajo/i)
    expect(alert.textContent ?? '').not.toMatch(/boom/i)
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()
  })

  it('[#743] el botón Reintentar de la carga fallida vuelve a solicitar la configuración realtime', async () => {
    requestConsoleSessionJsonMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
      workspaceId: 'ws_123',
      realtimeEndpointUrl: 'wss://rt.example.test',
      features: { realtime: true },
      dataSources: []
    })
    const user = userEvent.setup()

    renderPage()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /reintentar/i }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(await screen.findByText('Realtime panel mock')).toBeInTheDocument()
    expect(requestConsoleSessionJsonMock).toHaveBeenCalledTimes(2)
  })

  it('mapea correctamente tipos de canal', () => {
    expect(mapChannelTypes([{ type: 'postgresql' }, { type: 'mongodb' }, { type: 'unknown' }])).toEqual(['postgresql-changes', 'mongodb-changes'])
  })

  it('pasa realtimeEnabled false cuando el feature está desactivado', async () => {
    requestConsoleSessionJsonMock.mockResolvedValue({
      workspaceId: 'ws_123',
      realtimeEndpointUrl: 'wss://rt.example.test',
      features: { realtime: false },
      dataSources: [{ type: 'postgresql' }]
    })

    renderPage()
    await screen.findByText('Realtime panel mock')
    expect(panelSpy).toHaveBeenCalledWith(expect.objectContaining({ realtimeEnabled: false }))
  })

  it('renderiza la página con configuración realtime vacía en lugar de error', async () => {
    requestConsoleSessionJsonMock.mockResolvedValue({
      workspaceId: 'ws_123',
      realtimeEndpointUrl: null,
      features: { realtime: false },
      dataSources: []
    })

    renderPage()

    expect(await screen.findByText('Tiempo real del área de trabajo')).toBeInTheDocument()
    expect(screen.getByText('Realtime panel mock')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(panelSpy).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_123',
      realtimeEndpoint: null,
      channelTypes: [],
      realtimeEnabled: false
    }))
  })
})
