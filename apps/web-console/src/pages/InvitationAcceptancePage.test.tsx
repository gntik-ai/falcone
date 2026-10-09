import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { InvitationAcceptancePage } from './InvitationAcceptancePage'

const token = 'a'.repeat(43)
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear() })
it('submits invitation proof only in the body and shows completed acceptance', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'accepted' }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  render(<MemoryRouter initialEntries={[`/invitations/ten_alpha/inv_975#token=${token}`]}><Routes><Route path="/invitations/:tenantId/:invitationId" element={<InvitationAcceptancePage />} /></Routes></MemoryRouter>)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'guest@example.com')
  await user.type(screen.getByLabelText('Contraseña'), 'CorrectHorse12')
  await user.click(screen.getByRole('button', { name: 'Aceptar invitación' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Invitación aceptada')
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe('/v1/tenants/ten_alpha/invitations/inv_975/acceptance')
  expect(JSON.parse(init.body as string)).toEqual({ token, email: 'guest@example.com', password: 'CorrectHorse12' })
  expect(window.location.hash).toBe('')
  expect(window.localStorage.length).toBe(0)
})
it('refuses a page without proof without calling the API', () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  render(<MemoryRouter initialEntries={['/invitations/ten_alpha/inv_975']}><Routes><Route path="/invitations/:tenantId/:invitationId" element={<InvitationAcceptancePage />} /></Routes></MemoryRouter>)
  expect(screen.getByRole('alert')).toHaveTextContent('Enlace de invitación no válido')
  expect(fetchMock).not.toHaveBeenCalled()
})
