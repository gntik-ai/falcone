import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspaceDocSections } from '@/components/console/WorkspaceDocSections'

beforeEach(() => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe('WorkspaceDocSections', () => {
  it('renders service panels and copies snippet', async () => {
    render(<WorkspaceDocSections enabledServices={[{ serviceKey: 'postgres-database', category: 'data', label: 'PostgreSQL', endpoint: 'pg.example.test', port: 5432, resourceName: 'app_db', snippets: [{ id: 's1', label: 'Node.js', code: 'const x = 1', hasPlaceholderSecrets: true, secretPlaceholderRef: 'ref' }] }]} />)
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument()
    expect(screen.getByText('Punto de conexión: pg.example.test')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Copiar'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const x = 1')
  })

  it('renders empty state', () => {
    render(<WorkspaceDocSections enabledServices={[]} />)
    expect(screen.getByText(/aún no hay servicios habilitados/i)).toBeInTheDocument()
  })
})
