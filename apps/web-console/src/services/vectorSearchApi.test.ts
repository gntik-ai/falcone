import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/console-session', () => ({
  requestConsoleSessionJson: vi.fn().mockResolvedValue({})
}))

import { requestConsoleSessionJson } from '@/lib/console-session'
import {
  createVectorIndex,
  deleteVectorIndex,
  knnSearch,
  removeEmbeddingProvider,
  setEmbeddingProvider
} from './vectorSearchApi'

const mock = requestConsoleSessionJson as unknown as ReturnType<typeof vi.fn>
const lastCall = () => mock.mock.calls[mock.mock.calls.length - 1]

beforeEach(() => {
  mock.mockClear()
  mock.mockResolvedValue({})
})

describe('vectorSearchApi — KNN search (workspace-scoped data route)', () => {
  const base = '/v1/postgres/workspaces/ws1/data/appdb/schemas/public/tables/docs/search'

  it('knnSearch → POST {data}/search with queryVector + metric + topK', async () => {
    await knnSearch('ws1', 'appdb', 'public', 'docs', {
      queryVector: [0.1, 0.2, 0.3],
      vectorColumn: 'embedding',
      metric: 'cosine',
      topK: 5
    })
    expect(lastCall()).toEqual([
      base,
      {
        method: 'POST',
        body: { queryVector: [0.1, 0.2, 0.3], vectorColumn: 'embedding', metric: 'cosine', topK: 5 }
      }
    ])
  })

  it('knnSearch → POST {data}/search with queryText (no queryVector)', async () => {
    await knnSearch('ws1', 'appdb', 'public', 'docs', {
      queryText: 'similar things',
      vectorColumn: 'embedding'
    })
    expect(lastCall()).toEqual([
      base,
      { method: 'POST', body: { queryText: 'similar things', vectorColumn: 'embedding' } }
    ])
  })

  it('knnSearch forwards filter + select for hybrid search', async () => {
    await knnSearch('ws1', 'appdb', 'public', 'docs', {
      queryVector: [1, 2],
      vectorColumn: 'embedding',
      filter: { status: 'active' },
      select: ['id', 'title']
    })
    expect(lastCall()).toEqual([
      base,
      {
        method: 'POST',
        body: { queryVector: [1, 2], vectorColumn: 'embedding', filter: { status: 'active' }, select: ['id', 'title'] }
      }
    ])
  })

  it('knnSearch escapes path segments', async () => {
    await knnSearch('ws/1', 'app db', 'pub/lic', 'do cs', { queryVector: [1], vectorColumn: 'e' })
    expect(lastCall()[0]).toBe(
      '/v1/postgres/workspaces/ws%2F1/data/app%20db/schemas/pub%2Flic/tables/do%20cs/search'
    )
  })
})

describe('vectorSearchApi — vector index (database-scoped DDL route)', () => {
  const base = '/v1/postgres/databases/appdb/schemas/public/tables/docs/vector-indexes'

  it('createVectorIndex → POST vector-indexes; defaults indexType to hnsw', async () => {
    await createVectorIndex('appdb', 'public', 'docs', { column: 'embedding' })
    expect(lastCall()).toEqual([
      base,
      { method: 'POST', body: { indexType: 'hnsw', column: 'embedding' } }
    ])
  })

  it('createVectorIndex forwards ivfflat + metric + indexName', async () => {
    await createVectorIndex('appdb', 'public', 'docs', {
      column: 'embedding',
      indexType: 'ivfflat',
      metric: 'l2',
      indexName: 'docs_embedding_ivf'
    })
    expect(lastCall()).toEqual([
      base,
      {
        method: 'POST',
        body: { indexType: 'ivfflat', column: 'embedding', metric: 'l2', indexName: 'docs_embedding_ivf' }
      }
    ])
  })

  it('deleteVectorIndex → DELETE vector-indexes/{indexName} (escaped)', async () => {
    await deleteVectorIndex('appdb', 'public', 'docs', 'docs embedding idx')
    expect(lastCall()).toEqual([`${base}/docs%20embedding%20idx`, { method: 'DELETE' }])
  })
})

describe('vectorSearchApi — embedding provider (workspace-scoped)', () => {
  const base = '/v1/workspaces/ws1/embedding-provider'

  it('setEmbeddingProvider → PUT embedding-provider with secretRef (no raw key)', async () => {
    await setEmbeddingProvider('ws1', {
      providerType: 'openai',
      model: 'text-embedding-3-small',
      endpoint: 'https://api.example.com/v1',
      dimension: 1536,
      secretRef: 'openai-embeddings-secret'
    })
    expect(lastCall()).toEqual([
      base,
      {
        method: 'PUT',
        body: {
          providerType: 'openai',
          model: 'text-embedding-3-small',
          endpoint: 'https://api.example.com/v1',
          dimension: 1536,
          secretRef: 'openai-embeddings-secret'
        }
      }
    ])
  })

  it('setEmbeddingProvider omits optional endpoint/dimension when absent', async () => {
    await setEmbeddingProvider('ws1', {
      providerType: 'openai',
      model: 'text-embedding-3-small',
      secretRef: 'openai-embeddings-secret'
    })
    expect(lastCall()).toEqual([
      base,
      {
        method: 'PUT',
        body: { providerType: 'openai', model: 'text-embedding-3-small', secretRef: 'openai-embeddings-secret' }
      }
    ])
  })

  it('removeEmbeddingProvider → DELETE embedding-provider', async () => {
    await removeEmbeddingProvider('ws1')
    expect(lastCall()).toEqual([base, { method: 'DELETE' }])
  })

  it('setEmbeddingProvider escapes the workspace id', async () => {
    await setEmbeddingProvider('ws/1', { providerType: 'openai', model: 'm', secretRef: 's' })
    expect(lastCall()[0]).toBe('/v1/workspaces/ws%2F1/embedding-provider')
  })
})
