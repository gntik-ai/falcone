import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/services/postgresApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/postgresApi')>()
  return {
    ...actual, // keep buildFrontendSnippet (pure)
    listRows: vi.fn(),
    listApiKeys: vi.fn(),
    issueApiKey: vi.fn(),
    insertRow: vi.fn(),
    deleteRow: vi.fn(),
    revokeApiKey: vi.fn()
  }
})

import { PostgresDataEditor } from '@/components/console/PostgresDataEditor'
import * as api from '@/services/postgresApi'

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>

const props = { workspaceId: 'ws1', databaseName: 'appdb', schemaName: 'app1', tableName: 'items' }

beforeEach(() => {
  mocked.listRows.mockResolvedValue({ items: [{ id: 'r1', name: 'alpha' }] })
  mocked.listApiKeys.mockResolvedValue({ items: [] })
  mocked.issueApiKey.mockResolvedValue({ id: 'k1', key: 'flc_anon_secret123', prefix: 'flc_anon_secr', keyType: 'anon', scopes: ['data:read'] })
  mocked.insertRow.mockResolvedValue({ item: { id: 'r2' } })
  mocked.deleteRow.mockResolvedValue({ affected: 1 })
  mocked.revokeApiKey.mockResolvedValue({ id: 'k1', revoked: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PostgresDataEditor', () => {
  it('loads and renders rows for the table', async () => {
    render(<PostgresDataEditor {...props} />)
    expect(await screen.findByText('alpha')).toBeInTheDocument()
    expect(mocked.listRows).toHaveBeenCalledWith('ws1', 'appdb', 'app1', 'items', {
      countMode: 'exact',
      pageSize: 25,
      after: undefined,
      filters: []
    })
  })

  it('inserts a row from the JSON editor', async () => {
    render(<PostgresDataEditor {...props} />)
    await screen.findByText('alpha')
    fireEvent.change(screen.getByLabelText('New row (JSON)'), { target: { value: '{"name":"beta"}' } })
    fireEvent.click(screen.getByText('Insert'))
    await waitFor(() => expect(mocked.insertRow).toHaveBeenCalledWith('ws1', 'appdb', 'app1', 'items', { name: 'beta' }))
  })

  it('surfaces invalid JSON without calling the API', async () => {
    render(<PostgresDataEditor {...props} />)
    await screen.findByText('alpha')
    fireEvent.change(screen.getByLabelText('New row (JSON)'), { target: { value: 'not json' } })
    fireEvent.click(screen.getByText('Insert'))
    expect(await screen.findByRole('alert')).toHaveTextContent('New row: Not valid JSON')
    expect(mocked.insertRow).not.toHaveBeenCalled()
  })

  it('deletes a row by its id primary key', async () => {
    render(<PostgresDataEditor {...props} />)
    await screen.findByText('alpha')
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(mocked.deleteRow).toHaveBeenCalledWith('ws1', 'appdb', 'app1', 'items', { id: 'r1' }))
  })

  it('issues an anon key and shows it once with a copy-paste snippet', async () => {
    render(<PostgresDataEditor {...props} />)
    await screen.findByText('alpha')
    fireEvent.click(screen.getByText('Issue anon key'))
    await waitFor(() => expect(mocked.issueApiKey).toHaveBeenCalledWith('ws1', 'anon'))
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('flc_anon_secret123')
    // the snippet embeds the key via the apikey header + the workspace-scoped rows URL
    expect(status).toHaveTextContent("apikey: 'flc_anon_secret123'")
    expect(status).toHaveTextContent('/v1/postgres/workspaces/ws1/data/appdb/schemas/app1/tables/items/rows')
  })
})
