import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ConsoleDocsPage } from '@/pages/ConsoleDocsPage'

const sessionMocks = vi.hoisted(() => ({
  readConsoleShellSession: vi.fn(),
  requestConsoleSessionJson: vi.fn()
}))

vi.mock('@/lib/console-session', () => ({
  readConsoleShellSession: sessionMocks.readConsoleShellSession,
  requestConsoleSessionJson: sessionMocks.requestConsoleSessionJson
}))

beforeEach(() => {
  sessionMocks.readConsoleShellSession.mockReturnValue(createSession(['workspace_admin']))
  sessionMocks.requestConsoleSessionJson.mockResolvedValue(createDocsResponse())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ConsoleDocsPage', () => {
  it('calls workspace docs through the authenticated console session and renders a 200 response', async () => {
    renderDocsPage()

    expect(await screen.findByRole('heading', { name: /área de trabajo/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /áreas de trabajo/i })).toBeInTheDocument()
    expect(screen.getByText(/URL base: https:\/\/api\.example\.test/i)).toBeInTheDocument()
    expect(sessionMocks.requestConsoleSessionJson).toHaveBeenCalledWith('/v1/workspaces/wrk-1/docs')
  })

  it('shows create, edit, and delete note affordances to workspace admins', async () => {
    sessionMocks.requestConsoleSessionJson.mockResolvedValue(createDocsResponse([createNote()]))

    renderDocsPage()

    expect(await screen.findByLabelText('Nota nueva')).toBeInTheDocument()
    expect(screen.getByLabelText('Editar note-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Agregar nota/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Guardar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Eliminar/i })).toBeInTheDocument()
  })

  it('renders docs and notes read-only for roles that cannot manage notes', async () => {
    sessionMocks.readConsoleShellSession.mockReturnValue(createSession(['workspace_viewer']))
    sessionMocks.requestConsoleSessionJson.mockResolvedValue(createDocsResponse([createNote()]))

    renderDocsPage()

    expect(await screen.findByText('customer checklist')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nota nueva')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Editar note-1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Agregar nota/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Guardar/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Eliminar/i })).not.toBeInTheDocument()
  })
})

function renderDocsPage() {
  render(
    <MemoryRouter initialEntries={['/console/workspaces/wrk-1/docs']}>
      <Routes>
        <Route path="/console/workspaces/:workspaceId/docs" element={<ConsoleDocsPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function createDocsResponse(customNotes: Array<ReturnType<typeof createNote>> = []) {
  return {
    workspaceId: 'wrk-1',
    tenantId: 'ten-1',
    generatedAt: '2026-06-30T00:00:00.000Z',
    baseUrl: 'https://api.example.test',
    authInstructions: {
      method: 'bearer_oidc',
      tokenEndpoint: 'https://iam.example.test/token',
      clientIdPlaceholder: '<YOUR_CLIENT_ID>',
      clientSecretPlaceholder: '<YOUR_CLIENT_SECRET>',
      scopeHint: 'openid',
      consoleRef: 'Settings'
    },
    enabledServices: [],
    customNotes
  }
}

function createNote() {
  return {
    noteId: 'note-1',
    content: 'customer checklist',
    authorId: 'usr-1',
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z'
  }
}

function createSession(platformRoles: string[]) {
  return {
    sessionId: 'sess-1',
    authenticationState: 'active',
    statusView: 'login',
    issuedAt: '2026-06-30T00:00:00.000Z',
    expiresAt: '2026-06-30T01:00:00.000Z',
    refreshExpiresAt: '2026-06-30T02:00:00.000Z',
    principal: {
      displayName: 'Operator',
      primaryEmail: 'operator@example.test',
      state: 'active',
      userId: 'usr-1',
      username: 'operator',
      platformRoles
    }
  }
}
