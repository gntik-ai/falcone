import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceDocNotes } from '@/components/console/WorkspaceDocNotes'

afterEach(() => cleanup())

describe('WorkspaceDocNotes', () => {
  it('admin sees add button', () => {
    render(<WorkspaceDocNotes notes={[]} workspaceId="wrk-1" canManageNotes onCreate={vi.fn()} />)
    expect(screen.getByText('Agregar nota')).toBeInTheDocument()
  })

  it('viewer sees readonly note', () => {
    render(<WorkspaceDocNotes notes={[{ noteId: 'n1', content: 'hola', authorId: 'u1', createdAt: '', updatedAt: '' }]} workspaceId="wrk-1" canManageNotes={false} />)
    expect(screen.getByText('hola')).toBeInTheDocument()
  })

  it('admin can submit draft', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<WorkspaceDocNotes notes={[]} workspaceId="wrk-1" canManageNotes onCreate={onCreate} />)
    fireEvent.change(screen.getByLabelText('Nota nueva'), { target: { value: 'nota' } })
    fireEvent.click(screen.getByText('Agregar nota'))
    expect(onCreate).toHaveBeenCalledWith('nota')
  })
})
