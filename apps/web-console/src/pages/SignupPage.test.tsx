import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PendingActivationPage } from './PendingActivationPage'
import { SignupPage } from './SignupPage'

const fetchMock = vi.fn<typeof fetch>()

describe('SignupPage', () => {
  afterEach(() => {
    cleanup()
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('renderiza el formulario cuando la policy permite signup', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, enabledSignupPolicy({ minLength: 10 })))
    vi.stubGlobal('fetch', fetchMock)

    renderPage('/signup?tenant=ten_acme&workspaceId=wrk_console')

    expect(await screen.findByRole('heading', { name: /crea tu acceso a in falcone console/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/usuario/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/nombre visible/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/correo principal/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/ID de organización/i)).toHaveValue('ten_acme')
    expect(screen.getByLabelText(/ID de área de trabajo/i)).toHaveValue('wrk_console')
    expect(screen.getByLabelText(/contraseña/i)).toHaveAttribute('minlength', '10')
    expect(screen.getByText(/si tu organización requiere aprobación/i)).toBeInTheDocument()
    expect(screen.queryByText(/el shell autenticado/i)).not.toBeInTheDocument()
  })

  it('[#730] no muestra artefactos internos de scaffolding (badge EP/US, Realm/Client ID, rutas /v1/, roadmap)', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, enabledSignupPolicy({ minLength: 8 })))
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('heading', { name: /crea tu acceso a in falcone console/i })

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/EP-\d+\s*\/\s*US-UI/i)
    expect(text).not.toMatch(/\/v1\//)
    expect(text).not.toMatch(/llegarán en T\d/i)
    expect(screen.queryByText(/^Realm\b/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ID del cliente/i)).not.toBeInTheDocument()
  })

  it('muestra una pantalla informativa cuando la policy deshabilita signup', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(200, {
        selfServiceEnabled: false,
        mode: 'invitation',
        statusView: 'login',
        passwordPolicy: { minLength: 8 },
        message: 'El auto-registro está deshabilitado por política.'
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    expect((await screen.findAllByText(/el auto-registro está deshabilitado por política/i)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /crear solicitud de acceso/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ir al acceso de consola/i })).toHaveAttribute('href', '/login')
  })

  it('envía el signup y muestra feedback de éxito cuando la cuenta queda activa', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(200, enabledSignupPolicy({ minLength: 8 })))
      .mockResolvedValueOnce(
        createJsonResponse(201, {
          registrationId: 'reg_abc123',
          userId: 'usr_abc123',
          activationMode: 'self_service',
          state: 'active',
          statusView: 'login',
          createdAt: '2026-03-28T19:00:00.000Z',
          message: 'La cuenta ya puede continuar a login.'
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    renderPage('/signup?tenantId=ten_acme&workspaceId=wrk_console')
    await screen.findByRole('button', { name: /crear solicitud de acceso/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'Operaciones Plataforma' } })
    fireEvent.change(screen.getByLabelText(/correo principal/i), { target: { value: 'ops@example.com' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'Abcd1234' } })
    fireEvent.click(screen.getByRole('button', { name: /crear solicitud de acceso/i }))

    expect(await screen.findByRole('heading', { name: /tu cuenta está lista/i })).toBeInTheDocument()
    expect(screen.getByText(/reg_abc123/i)).toBeInTheDocument()
    expect(screen.queryByText(/^Estado:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Modo de activación:/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Vista de estado:/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /continuar hacia login/i })).toHaveAttribute('href', '/login')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/v1/auth/signups',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            username: 'operaciones',
            displayName: 'Operaciones Plataforma',
            primaryEmail: 'ops@example.com',
            password: 'Abcd1234',
            tenantId: 'ten_acme',
            workspaceId: 'wrk_console'
          }),
          headers: expect.any(Headers)
        })
      )
    })

    const [, requestInit] = fetchMock.mock.calls[1]
    const headers = requestInit?.headers as Headers
    expect(headers.get('X-API-Version')).toBe('2026-03-26')
    expect(headers.get('X-Correlation-Id')).toMatch(/^corr_/)
    expect(headers.get('Idempotency-Key')).toMatch(/^idem_/)
  })

  it('[#730] muestra una única confirmación (guía + referencia) y mueve el foco a ella tras un alta activa', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(200, enabledSignupPolicy({ minLength: 8 })))
      .mockResolvedValueOnce(
        createJsonResponse(201, {
          registrationId: 'reg_abc123',
          userId: 'usr_abc123',
          activationMode: 'self_service',
          state: 'active',
          statusView: 'login',
          createdAt: '2026-03-28T19:00:00.000Z',
          message: 'La cuenta ya puede continuar a login.'
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    renderPage('/signup?tenantId=ten_acme')
    await screen.findByRole('button', { name: /crear solicitud de acceso/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'Operaciones Plataforma' } })
    fireEvent.change(screen.getByLabelText(/correo principal/i), { target: { value: 'ops@example.com' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'Abcd1234' } })
    fireEvent.click(screen.getByRole('button', { name: /crear solicitud de acceso/i }))

    const heading = await screen.findByRole('heading', { name: /tu cuenta está lista/i })
    // Leads with the service's plain-language guidance and keeps the human-readable reference.
    expect(screen.getByText(/la cuenta ya puede continuar a login/i)).toBeInTheDocument()
    expect(screen.getByText(/reg_abc123/i)).toBeInTheDocument()
    // Exactly one success surface — no redundant second "success" banner.
    expect(screen.getByText(/tu cuenta está lista/i)).toBeInTheDocument()
    expect(screen.queryByText(/registro aceptado correctamente/i)).not.toBeInTheDocument()
    // Focus lands on the confirmation container so the next Tab reaches "Continuar hacia login".
    await waitFor(() => {
      // eslint-disable-next-line testing-library/no-node-access
      expect(heading.closest('div[tabindex="-1"]')).toHaveFocus()
    })
  })

  it('navega a activación pendiente cuando el signup queda pendiente', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(200, enabledSignupPolicy({ minLength: 8 })))
      .mockResolvedValueOnce(
        createJsonResponse(201, {
          registrationId: 'reg_pending123',
          userId: 'usr_pending123',
          activationMode: 'approval_required',
          state: 'pending_activation',
          statusView: 'pending_activation',
          createdAt: '2026-03-28T19:10:00.000Z',
          message: 'Tu registro está pendiente de revisión.'
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          statusView: 'pending_activation',
          title: 'Tu registro está pendiente de activación',
          message: 'Estamos esperando la aprobación final para habilitar el acceso.',
          allowedActions: []
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('button', { name: /crear solicitud de acceso/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'Operaciones Plataforma' } })
    fireEvent.change(screen.getByLabelText(/correo principal/i), { target: { value: 'ops@example.com' } })
    fireEvent.change(screen.getByLabelText(/ID de organización/i), { target: { value: 'ten_acme' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'super-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: /crear solicitud de acceso/i }))

    expect(await screen.findByText(/estamos esperando la aprobación final para habilitar el acceso/i)).toBeInTheDocument()
    expect(screen.getByText(/reg_pending123/i)).toBeInTheDocument()
  })

  it('muestra feedback cuando ya existe una cuenta con esos datos', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(200, enabledSignupPolicy({ minLength: 8 })))
      .mockResolvedValueOnce(
        createJsonResponse(409, {
          status: 409,
          code: 'AUTH_SIGNUP_CONFLICT',
          message: 'El username o email ya existe.',
          detail: {},
          requestId: 'req_12345678',
          correlationId: 'corr_12345678',
          resource: { path: '/v1/auth/signups' }
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('button', { name: /crear solicitud de acceso/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'Operaciones Plataforma' } })
    fireEvent.change(screen.getByLabelText(/correo principal/i), { target: { value: 'ops@example.com' } })
    fireEvent.change(screen.getByLabelText(/ID de organización/i), { target: { value: 'ten_acme' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'super-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: /crear solicitud de acceso/i }))

    expect(await screen.findByText(/el username o email ya existe/i)).toBeInTheDocument()
  })

  it('[#729] el formulario desactiva la validación nativa del navegador', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, enabledSignupPolicy({ minLength: 8 })))
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('button', { name: /crear solicitud de acceso/i })

    // eslint-disable-next-line testing-library/no-node-access
    const form = screen.getByLabelText(/usuario/i).closest('form')
    expect(form).toHaveAttribute('novalidate')
  })

  it('[#729] muestra mensajes de validación en español al enviar campos requeridos vacíos, sin llamar a la red', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, enabledSignupPolicy({ minLength: 8 })))
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('button', { name: /crear solicitud de acceso/i })

    fireEvent.click(screen.getByRole('button', { name: /crear solicitud de acceso/i }))

    const alerts = await screen.findAllByRole('alert')
    const requiredAlerts = alerts.filter((alert) => /este campo es obligatorio/i.test(alert.textContent ?? ''))
    // username, displayName, primaryEmail, tenantId, password
    expect(requiredAlerts).toHaveLength(5)

    expect(screen.getByLabelText(/usuario/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/nombre visible/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/correo principal/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/ID de organización/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/contraseña/i)).toHaveAttribute('aria-invalid', 'true')

    // Focus lands on the first invalid field in DOM order (username).
    expect(screen.getByLabelText(/usuario/i)).toHaveFocus()

    // Only the initial signup-policy fetch on mount happened — no signup attempt was submitted.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalledWith('/v1/auth/signups', expect.anything())
  })

  it('[#729] cuando solo falta la organización, el foco va a ese campo y el resto se envía', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, enabledSignupPolicy({ minLength: 8 })))
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('button', { name: /crear solicitud de acceso/i })

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })
    fireEvent.change(screen.getByLabelText(/nombre visible/i), { target: { value: 'Operaciones Plataforma' } })
    fireEvent.change(screen.getByLabelText(/correo principal/i), { target: { value: 'ops@example.com' } })
    fireEvent.change(screen.getByLabelText(/ID de organización/i), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'Abcd1234' } })
    fireEvent.click(screen.getByRole('button', { name: /crear solicitud de acceso/i }))

    expect(await screen.findByText(/este campo es obligatorio/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/ID de organización/i)).toHaveFocus()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('[#729] el error de un campo se limpia al editarlo', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(200, enabledSignupPolicy({ minLength: 8 })))
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByRole('button', { name: /crear solicitud de acceso/i })

    fireEvent.click(screen.getByRole('button', { name: /crear solicitud de acceso/i }))
    await screen.findAllByRole('alert')

    fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'operaciones' } })

    await waitFor(() => {
      expect(screen.getByLabelText(/usuario/i)).not.toHaveAttribute('aria-invalid', 'true')
    })
    // The other 4 field errors (independent) are still shown; only username's is gone.
    expect(
      screen.getAllByRole('alert').filter((el) => /este campo es obligatorio/i.test(el.textContent ?? ''))
    ).toHaveLength(4)
  })
})

function renderPage(initialEntry = '/signup') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/signup/pending-activation" element={<PendingActivationPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function enabledSignupPolicy({ minLength }: { minLength: number }) {
  return {
    selfServiceEnabled: true,
    mode: 'self_service',
    statusView: 'signup',
    passwordPolicy: { minLength },
    message: 'Self-service signup is enabled.'
  }
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
