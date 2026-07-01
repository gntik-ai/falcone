import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PasswordRecoveryPage } from './PasswordRecoveryPage'

const fetchMock = vi.fn<typeof fetch>()

describe('PasswordRecoveryPage', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('[#726] renderiza una vista real con acciones para continuar y volver a login', () => {
    renderPasswordRecoveryPage()

    expect(screen.getByRole('heading', { name: /recupera el acceso a in falcone console/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/usuario o correo de consola/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /enviar instrucciones/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver a login/i })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('heading', { name: /página no encontrada/i })).not.toBeInTheDocument()
  })

  it('envía la solicitud de recuperación al contrato público y muestra el estado aceptado', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(202, {
        recoveryRequestId: 'prr_abc123',
        status: 'pending_delivery',
        statusView: 'password_recovery',
        requestedAt: '2026-07-01T12:00:00.000Z',
        expiresAt: '2026-07-01T12:30:00.000Z',
        maskedDestination: 'o***@example.com'
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    renderPasswordRecoveryPage()

    fireEvent.change(screen.getByLabelText(/usuario o correo de consola/i), {
      target: { value: 'operaciones@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /enviar instrucciones/i }))

    expect(await screen.findByText(/solicitud de recuperación recibida/i)).toBeInTheDocument()
    expect(screen.getByText(/destino normalizado: o\*\*\*@example\.com/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/v1/auth/password-recovery-requests',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            usernameOrEmail: 'operaciones@example.com',
            deliveryChannel: 'email'
          })
        })
      )
    })
  })

  it('muestra recuperación no habilitada cuando el runtime responde 404', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(404, {
        status: 404,
        code: 'HTTP_404',
        message: 'Cannot POST /v1/auth/password-recovery-requests'
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    renderPasswordRecoveryPage()

    fireEvent.change(screen.getByLabelText(/usuario o correo de consola/i), {
      target: { value: 'operaciones@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: /enviar instrucciones/i }))

    expect(await screen.findByText(/recuperación no habilitada en este entorno/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /volver a login/i })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('heading', { name: /página no encontrada/i })).not.toBeInTheDocument()
  })
})

function renderPasswordRecoveryPage(initialEntry = '/password-recovery') {
  const router = createMemoryRouter(
    [
      {
        path: '/password-recovery',
        element: <PasswordRecoveryPage />
      },
      {
        path: '/login',
        element: <div>Login target</div>
      }
    ],
    {
      initialEntries: [initialEntry]
    }
  )

  render(<RouterProvider router={router} />)
}

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}
