import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { persistConsoleShellSession, clearConsoleShellSession } from '@/lib/console-session'
import type { ConsoleLoginSession } from '@/lib/console-auth'
import { ConsoleInvitationList } from './ConsoleInvitationList'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearConsoleShellSession() })
it('lists pending and expired invitations and permits revoke and one-time resend', async () => {
  const expiry = '2099-01-01T00:00:00Z'
  persistConsoleShellSession({ sessionId: 'test-session', authenticationState: 'active', statusView: 'login',
    issuedAt: '2026-01-01T00:00:00Z', lastActivityAt: '2026-01-01T00:00:00Z', idleExpiresAt: expiry,
    expiresAt: expiry, refreshExpiresAt: expiry, sessionPolicy: {},
    tokenSet: { accessToken: 'test-only', refreshToken: 'test-only-refresh', tokenType: 'Bearer', scope: 'openid',
      expiresAt: expiry, refreshExpiresAt: expiry, expiresIn: 3600, refreshExpiresIn: 7200 }
  } satisfies ConsoleLoginSession)
  const items = [
    { id: 'inv_pending', role: 'workspace_admin', workspaceId: 'wrk_alpha', status: 'pending', expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'inv_expired', role: 'workspace_viewer', workspaceId: 'wrk_alpha', status: 'expired', expiresAt: '2000-01-01T00:00:00Z', createdAt: '1999-01-01T00:00:00Z' }
  ]
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    let response: unknown = { items }
    if (url.endsWith('/revocation')) { items[0].status = 'revoked'; response = items[0] }
    if (url.endsWith('/resend')) response = { ...items[1], token: 'a'.repeat(43), status: 'pending', expiresAt: '2099-01-01T00:00:00Z' }
    return new Response(JSON.stringify(response), { status: options?.method === 'POST' ? 202 : 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<ConsoleInvitationList tenantId="ten_alpha" reloadKey={0} />)
  expect(await screen.findByText('inv_pending')).toBeInTheDocument()
  expect(screen.getByText('inv_expired')).toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Revocar inv_pending' }))
  expect(await screen.findByText('revoked')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Reenviar inv_expired' }))
  await user.type(screen.getByLabelText('Email de la invitación'), 'guest@example.com')
  await user.click(screen.getByRole('button', { name: 'Generar enlace nuevo' }))
  expect(await screen.findByLabelText('Enlace de un solo uso')).toHaveValue(`${window.location.origin}/invitations/ten_alpha/inv_expired#token=${'a'.repeat(43)}`)
})
