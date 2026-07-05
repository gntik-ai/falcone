import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PendingActivationPage } from './PendingActivationPage'

const fetchMock = vi.fn<typeof fetch>()

describe('PendingActivationPage', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('renderiza la vista canónica y el resumen del registro cuando hay contexto de navegación', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(200, {
        statusView: 'pending_activation',
        title: 'Tu registro está pendiente de activación',
        message: 'Estamos esperando la aprobación final para habilitar el acceso.',
        allowedActions: []
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    renderPage({
      registrationId: 'reg_pending123',
      state: 'pending_activation',
      activationMode: 'approval_required',
      createdAt: '2026-03-28T19:10:00.000Z',
      message: 'Tu registro está pendiente de revisión.'
    })

    expect(await screen.findByText(/estamos esperando la aprobación final para habilitar el acceso/i)).toBeInTheDocument()
    expect(screen.getByText(/reg_pending123/i)).toBeInTheDocument()
    expect(screen.queryByText(/^Estado:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Modo de activación:/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver a login/i })).toHaveAttribute('href', '/login')
  })

  it('[#730] no muestra artefactos internos de scaffolding (badge EP/US, rutas /v1/, dump de campos crudos)', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(200, {
        statusView: 'pending_activation',
        title: 'Tu registro está pendiente de activación',
        message: 'Estamos esperando la aprobación final para habilitar el acceso.',
        allowedActions: []
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    renderPage({
      registrationId: 'reg_pending123',
      state: 'pending_activation',
      statusView: 'pending_activation',
      activationMode: 'approval_required',
      createdAt: '2026-03-28T19:10:00.000Z',
      message: 'Tu registro está pendiente de revisión.'
    })

    await screen.findByText(/estamos esperando la aprobación final para habilitar el acceso/i)

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/EP-\d+\s*\/\s*US-UI/i)
    expect(text).not.toMatch(/\/v1\//)
    expect(text).not.toMatch(/Resumen del registro/i)
    expect(screen.getByText(/reg_pending123/i)).toBeInTheDocument()
  })

  it('degrada con copy segura cuando no puede resolver el status-view', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network failed'))
    vi.stubGlobal('fetch', fetchMock)

    renderPage({
      registrationId: 'reg_pending123',
      state: 'pending_activation',
      activationMode: 'approval_required',
      message: 'Tu registro sigue esperando aprobación.'
    })

    expect(await screen.findByText(/tu registro sigue esperando aprobación/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver a login/i })).toHaveAttribute('href', '/login')
  })

  it('sigue siendo útil cuando se visita sin contexto previo', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(200, {
        statusView: 'pending_activation',
        title: 'Tu registro está pendiente de activación',
        message: 'Estamos esperando la aprobación final para habilitar el acceso.',
        allowedActions: []
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect(await screen.findByText(/estamos esperando la aprobación final/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /revisar signup/i })).toHaveAttribute('href', '/signup')
  })
})

function renderPage(state?: Record<string, unknown>) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/signup/pending-activation', state }] }>
      <Routes>
        <Route path="/signup/pending-activation" element={<PendingActivationPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function createJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body
  } as Response
}
