import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/vectorSearchApi', () => ({
  knnSearch: vi.fn(),
  createVectorIndex: vi.fn(),
  deleteVectorIndex: vi.fn(),
  setEmbeddingProvider: vi.fn(),
  removeEmbeddingProvider: vi.fn()
}))

import { VectorSearchConsole } from './VectorSearchConsole'
import {
  createVectorIndex,
  deleteVectorIndex,
  knnSearch,
  removeEmbeddingProvider,
  setEmbeddingProvider
} from '@/services/vectorSearchApi'

const mocked = {
  knnSearch: knnSearch as unknown as ReturnType<typeof vi.fn>,
  createVectorIndex: createVectorIndex as unknown as ReturnType<typeof vi.fn>,
  deleteVectorIndex: deleteVectorIndex as unknown as ReturnType<typeof vi.fn>,
  setEmbeddingProvider: setEmbeddingProvider as unknown as ReturnType<typeof vi.fn>,
  removeEmbeddingProvider: removeEmbeddingProvider as unknown as ReturnType<typeof vi.fn>
}

function renderConsole() {
  return render(
    <VectorSearchConsole workspaceId="ws1" databaseName="appdb" schemaName="public" tableName="docs" />
  )
}

function apiError(status: number, code: string, message: string) {
  return { status, code, message }
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => cleanup())

describe('VectorSearchConsole — KNN search panel', () => {
  it('runs a query-vector search and renders a results table with a distance column', async () => {
    mocked.knnSearch.mockResolvedValue({
      items: [
        { id: 'a', title: 'closest', distance: 0.05 },
        { id: 'b', title: 'farther', distance: 0.42 }
      ]
    })
    renderConsole()
    fireEvent.change(screen.getByLabelText('Query vector (JSON array)'), { target: { value: '[0.1, 0.2, 0.3]' } })
    fireEvent.change(screen.getByLabelText(/Vector column/i), { target: { value: 'embedding' } })
    fireEvent.change(screen.getByLabelText(/Top-K/i), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() =>
      expect(mocked.knnSearch).toHaveBeenCalledWith(
        'ws1',
        'appdb',
        'public',
        'docs',
        expect.objectContaining({ queryVector: [0.1, 0.2, 0.3], metric: 'cosine', topK: 5, vectorColumn: 'embedding' })
      )
    )
    const table = await screen.findByRole('table', { name: /KNN results/i })
    expect(within(table).getByText('distance')).toBeInTheDocument()
    expect(within(table).getByText('closest')).toBeInTheDocument()
    expect(within(table).getByText('0.05')).toBeInTheDocument()
  })

  it('rejects an invalid query-vector JSON before calling the API', async () => {
    renderConsole()
    fireEvent.change(screen.getByLabelText('Query vector (JSON array)'), { target: { value: '[1, 2,' } })
    fireEvent.change(screen.getByLabelText(/Vector column/i), { target: { value: 'embedding' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Query vector/i)
    expect(mocked.knnSearch).not.toHaveBeenCalled()
  })

  it('runs a query-text search (no queryVector)', async () => {
    mocked.knnSearch.mockResolvedValue({ items: [{ id: 'a', distance: 0.1 }] })
    renderConsole()
    fireEvent.click(screen.getByRole('radio', { name: /Use query text/i }))
    fireEvent.change(screen.getByLabelText(/^Query text$/i), { target: { value: 'find similar' } })
    fireEvent.change(screen.getByLabelText(/Vector column/i), { target: { value: 'embedding' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(mocked.knnSearch).toHaveBeenCalledWith(
        'ws1',
        'appdb',
        'public',
        'docs',
        expect.objectContaining({ queryText: 'find similar', vectorColumn: 'embedding' })
      )
    )
    expect(mocked.knnSearch.mock.calls[0][4]).not.toHaveProperty('queryVector')
  })

  it('applies a scalar filter for hybrid search', async () => {
    mocked.knnSearch.mockResolvedValue({ items: [] })
    renderConsole()
    fireEvent.change(screen.getByLabelText('Query vector (JSON array)'), { target: { value: '[1, 2]' } })
    fireEvent.change(screen.getByLabelText(/Vector column/i), { target: { value: 'embedding' } })
    fireEvent.change(screen.getByLabelText(/Filter column/i), { target: { value: 'status' } })
    fireEvent.change(screen.getByLabelText(/Filter value/i), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(mocked.knnSearch).toHaveBeenCalledWith(
        'ws1',
        'appdb',
        'public',
        'docs',
        expect.objectContaining({ filter: { status: 'active' } })
      )
    )
  })

  it('surfaces EMBEDDING_PROVIDER_MISSING (422) with a link to the provider panel', async () => {
    mocked.knnSearch.mockRejectedValue(apiError(422, 'EMBEDDING_PROVIDER_MISSING', 'No embedding provider configured for this workspace'))
    renderConsole()
    fireEvent.click(screen.getByRole('radio', { name: /Use query text/i }))
    fireEvent.change(screen.getByLabelText(/^Query text$/i), { target: { value: 'hello' } })
    fireEvent.change(screen.getByLabelText(/Vector column/i), { target: { value: 'embedding' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('EMBEDDING_PROVIDER_MISSING')
    expect(within(alert).getByRole('button', { name: /Configure embedding provider/i })).toBeInTheDocument()
  })

  it('surfaces a dimension-mismatch error (400) as an inline banner with the message', async () => {
    mocked.knnSearch.mockRejectedValue(apiError(400, 'VECTOR_DIMENSION_MISMATCH', 'query vector has 2 dimensions, column expects 1536'))
    renderConsole()
    fireEvent.change(screen.getByLabelText('Query vector (JSON array)'), { target: { value: '[1, 2]' } })
    fireEvent.change(screen.getByLabelText(/Vector column/i), { target: { value: 'embedding' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('query vector has 2 dimensions, column expects 1536')
  })
})

describe('VectorSearchConsole — vector index panel', () => {
  it('creates an HNSW cosine index and shows a success confirmation', async () => {
    mocked.createVectorIndex.mockResolvedValue({ executed: true, executionMode: 'execute', statements: ['CREATE INDEX ...'] })
    renderConsole()
    const panel = screen.getByRole('region', { name: /Vector index/i })
    fireEvent.change(within(panel).getByLabelText(/Index column/i), { target: { value: 'embedding' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Create index' }))
    await waitFor(() =>
      expect(mocked.createVectorIndex).toHaveBeenCalledWith(
        'appdb',
        'public',
        'docs',
        expect.objectContaining({ column: 'embedding', indexType: 'hnsw', metric: 'cosine' })
      )
    )
    expect(await within(panel).findByRole('status')).toHaveTextContent(/index/i)
  })

  it('surfaces an index-create error as an inline banner', async () => {
    mocked.createVectorIndex.mockRejectedValue(apiError(400, 'BAD_REQUEST', 'column "embedding" is not a vector type'))
    renderConsole()
    const panel = screen.getByRole('region', { name: /Vector index/i })
    fireEvent.change(within(panel).getByLabelText(/Index column/i), { target: { value: 'embedding' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Create index' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('column "embedding" is not a vector type')
  })

  it('deletes a vector index by name and shows a success confirmation', async () => {
    mocked.deleteVectorIndex.mockResolvedValue({ executed: true })
    renderConsole()
    const panel = screen.getByRole('region', { name: /Vector index/i })
    fireEvent.change(within(panel).getByLabelText(/Delete index name/i), { target: { value: 'docs_embedding_idx' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Delete index' }))
    await waitFor(() =>
      expect(mocked.deleteVectorIndex).toHaveBeenCalledWith('appdb', 'public', 'docs', 'docs_embedding_idx')
    )
    expect(await within(panel).findByRole('status')).toHaveTextContent(/deleted/i)
  })
})

describe('VectorSearchConsole — embedding provider panel', () => {
  it('sets the provider with a secretRef and shows a success confirmation', async () => {
    mocked.setEmbeddingProvider.mockResolvedValue({ providerType: 'openai', model: 'text-embedding-3-small', secretRef: 'emb-secret' })
    renderConsole()
    const panel = screen.getByRole('region', { name: /Embedding provider/i })
    fireEvent.change(within(panel).getByLabelText(/Provider type/i), { target: { value: 'openai' } })
    fireEvent.change(within(panel).getByLabelText(/Model/i), { target: { value: 'text-embedding-3-small' } })
    fireEvent.change(within(panel).getByLabelText(/Secret Reference/i), { target: { value: 'emb-secret' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save provider' }))
    await waitFor(() =>
      expect(mocked.setEmbeddingProvider).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({ providerType: 'openai', model: 'text-embedding-3-small', secretRef: 'emb-secret' })
      )
    )
    // The credential field is the secretRef NAME, and the call body carries no raw key value.
    expect(mocked.setEmbeddingProvider.mock.calls[0][1]).not.toHaveProperty('apiKey')
    expect(within(panel).getByLabelText(/Secret Reference/i)).toHaveAttribute('type', 'text')
    expect(await within(panel).findByRole('status')).toHaveTextContent(/provider/i)
  })

  it('shows the re-index warning returned when a provider is replaced', async () => {
    mocked.setEmbeddingProvider.mockResolvedValue({
      providerType: 'openai',
      model: 'text-embedding-3-large',
      secretRef: 'emb-secret',
      warning: 'Embedding provider replaced. Existing vectors may require re-indexing.'
    })
    renderConsole()
    const panel = screen.getByRole('region', { name: /Embedding provider/i })
    fireEvent.change(within(panel).getByLabelText(/Provider type/i), { target: { value: 'openai' } })
    fireEvent.change(within(panel).getByLabelText(/Model/i), { target: { value: 'text-embedding-3-large' } })
    fireEvent.change(within(panel).getByLabelText(/Secret Reference/i), { target: { value: 'emb-secret' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save provider' }))
    expect(await within(panel).findByText(/may require re-indexing/i)).toBeInTheDocument()
  })

  it('removes the provider after a destructive confirmation', async () => {
    mocked.removeEmbeddingProvider.mockResolvedValue({ removed: true })
    renderConsole()
    const panel = screen.getByRole('region', { name: /Embedding provider/i })
    fireEvent.click(within(panel).getByRole('button', { name: 'Remove provider' }))
    // A destructive confirmation appears; confirm it.
    const confirm = await screen.findByRole('button', { name: /^(Remove|Confirm|Eliminar|Confirmar)$/i })
    fireEvent.click(confirm)
    await waitFor(() => expect(mocked.removeEmbeddingProvider).toHaveBeenCalledWith('ws1'))
    expect(await within(panel).findByRole('status')).toHaveTextContent(/removed/i)
  })

  it('surfaces a provider-config error as an inline banner', async () => {
    mocked.setEmbeddingProvider.mockRejectedValue(apiError(422, 'INVALID_PROVIDER', 'unsupported providerType "bogus"'))
    renderConsole()
    const panel = screen.getByRole('region', { name: /Embedding provider/i })
    fireEvent.change(within(panel).getByLabelText(/Provider type/i), { target: { value: 'bogus' } })
    fireEvent.change(within(panel).getByLabelText(/Model/i), { target: { value: 'm' } })
    fireEvent.change(within(panel).getByLabelText(/Secret Reference/i), { target: { value: 's' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Save provider' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('unsupported providerType "bogus"')
  })

  it('never renders a raw-key input (no type=password, no "API key value" field)', () => {
    const { container } = renderConsole()
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByLabelText(/API key value/i)).toBeNull()
    expect(screen.queryByLabelText(/secret value/i)).toBeNull()
    // The only credential field is the secretRef NAME.
    const panel = screen.getByRole('region', { name: /Embedding provider/i })
    expect(within(panel).getByLabelText(/Secret Reference/i)).toBeInTheDocument()
  })
})
