import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestConsoleSessionJson } from '@/lib/console-session'
import {
  canManageWorkspaceDocNotes,
  createDocNote,
  deleteDocNote,
  fetchWorkspaceDocs,
  updateDocNote
} from '@/lib/console-workspace-docs'

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: vi.fn().mockResolvedValue({})
}))

const requestMock = requestConsoleSessionJson as unknown as ReturnType<typeof vi.fn>
const lastCall = () => requestMock.mock.calls[requestMock.mock.calls.length - 1]

beforeEach(() => {
  requestMock.mockClear()
  requestMock.mockResolvedValue({})
})

describe('console-workspace-docs', () => {
  it('routes all workspace docs requests through the authenticated console session helper', async () => {
    await fetchWorkspaceDocs('wrk-1')
    expect(lastCall()).toEqual(['/v1/workspaces/wrk-1/docs'])

    await createDocNote('wrk-1', 'new note')
    expect(lastCall()).toEqual([
      '/v1/workspaces/wrk-1/docs/notes',
      { method: 'POST', body: { content: 'new note' } }
    ])

    await updateDocNote('wrk-1', 'note-1', 'updated note')
    expect(lastCall()).toEqual([
      '/v1/workspaces/wrk-1/docs/notes/note-1',
      { method: 'PUT', body: { content: 'updated note' } }
    ])

    await deleteDocNote('wrk-1', 'note-1')
    expect(lastCall()).toEqual([
      '/v1/workspaces/wrk-1/docs/notes/note-1',
      { method: 'DELETE' }
    ])
  })

  it('allows note management only for workspace note manager roles', () => {
    expect(canManageWorkspaceDocNotes(['workspace_admin'])).toBe(true)
    expect(canManageWorkspaceDocNotes(['workspace_owner'])).toBe(true)
    expect(canManageWorkspaceDocNotes(['workspace_viewer'])).toBe(false)
    expect(canManageWorkspaceDocNotes(['developer_external'])).toBe(false)
    expect(canManageWorkspaceDocNotes(['superadmin'])).toBe(false)
    expect(canManageWorkspaceDocNotes(undefined)).toBe(false)
  })
})
