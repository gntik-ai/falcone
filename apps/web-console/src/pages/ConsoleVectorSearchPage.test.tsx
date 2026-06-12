import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockUseConsoleContext = vi.fn()

vi.mock('@/lib/console-context', () => ({
  useConsoleContext: () => mockUseConsoleContext()
}))

// The console child only needs to render; its API calls are covered by its own test.
vi.mock('@/services/vectorSearchApi', () => ({
  knnSearch: vi.fn(),
  createVectorIndex: vi.fn(),
  deleteVectorIndex: vi.fn(),
  setEmbeddingProvider: vi.fn(),
  removeEmbeddingProvider: vi.fn()
}))

import { ConsoleVectorSearchPage } from './ConsoleVectorSearchPage'

beforeEach(() => {
  vi.clearAllMocks()
  mockUseConsoleContext.mockReturnValue({ activeTenantId: 'ten_alpha', activeWorkspaceId: 'wrk_alpha' })
})
afterEach(() => cleanup())

describe('ConsoleVectorSearchPage', () => {
  it('prompts to select a workspace when none is active', () => {
    mockUseConsoleContext.mockReturnValue({ activeTenantId: null, activeWorkspaceId: null })
    render(<ConsoleVectorSearchPage />)
    expect(screen.getByText(/Select a workspace to run vector-search operations\./i)).toBeInTheDocument()
  })

  it('shows a prompt to enter db/table before the console renders', () => {
    render(<ConsoleVectorSearchPage />)
    expect(screen.getByText(/Enter a database and table to begin\./i)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Vector search console/i })).toBeNull()
  })

  it('renders the three vector-search panels once a workspace + table are in scope', () => {
    render(<ConsoleVectorSearchPage />)
    fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'appdb' } })
    fireEvent.change(screen.getByLabelText('Table'), { target: { value: 'docs' } })
    expect(screen.getByRole('region', { name: /KNN search/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Vector index/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Embedding provider/i })).toBeInTheDocument()
  })
})
