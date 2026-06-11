import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/mongoApi', () => ({
  listDocuments: vi.fn(),
  insertDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  previewDocumentsWithApiKey: vi.fn(),
  buildMongoFrontendSnippet: vi.fn(() => 'MONGO_FETCH_SNIPPET'),
  buildMongoCurlSnippet: vi.fn(() => 'MONGO_CURL_SNIPPET')
}))
vi.mock('@/services/postgresApi', () => ({
  issueApiKey: vi.fn()
}))

import { MongoDataEditor } from './MongoDataEditor'
import { deleteDocument, insertDocument, listDocuments, previewDocumentsWithApiKey, updateDocument } from '@/services/mongoApi'
import { issueApiKey } from '@/services/postgresApi'

const mocked = {
  listDocuments: listDocuments as unknown as ReturnType<typeof vi.fn>,
  insertDocument: insertDocument as unknown as ReturnType<typeof vi.fn>,
  updateDocument: updateDocument as unknown as ReturnType<typeof vi.fn>,
  deleteDocument: deleteDocument as unknown as ReturnType<typeof vi.fn>,
  previewDocumentsWithApiKey: previewDocumentsWithApiKey as unknown as ReturnType<typeof vi.fn>,
  issueApiKey: issueApiKey as unknown as ReturnType<typeof vi.fn>
}

function renderEditor() {
  return render(<MongoDataEditor workspaceId="ws1" databaseName="appdb" collectionName="notes" />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.listDocuments.mockResolvedValue({ items: [{ _id: 'd1', body: 'hello' }] })
})
afterEach(() => cleanup())

describe('MongoDataEditor — richer UX', () => {
  it('shows a loading state, then the documents with a count', async () => {
    renderEditor()
    expect(screen.getByText('Loading documents…')).toBeInTheDocument()
    expect(await screen.findByText(/"body":"hello"/)).toBeInTheDocument()
    expect(screen.getByText('Documents (1)')).toBeInTheDocument()
  })

  it('shows an empty state when there are no documents', async () => {
    mocked.listDocuments.mockResolvedValue({ items: [] })
    renderEditor()
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument()
  })

  it('validates new-document JSON before inserting', async () => {
    renderEditor()
    await screen.findByText(/"body":"hello"/)
    fireEvent.change(screen.getByLabelText('New document (JSON)'), { target: { value: '[]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('New document: Expected a JSON object')
    expect(mocked.insertDocument).not.toHaveBeenCalled()
  })

  it('inserts a valid document and reloads', async () => {
    mocked.insertDocument.mockResolvedValue({ item: {} })
    renderEditor()
    await screen.findByText(/"body":"hello"/)
    fireEvent.change(screen.getByLabelText('New document (JSON)'), { target: { value: '{"body":"new"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    await waitFor(() => expect(mocked.insertDocument).toHaveBeenCalledWith('ws1', 'appdb', 'notes', { body: 'new' }))
    expect(mocked.listDocuments).toHaveBeenCalledTimes(2)
  })

  it('edits a document in place → updateDocument with the _id excluded', async () => {
    mocked.updateDocument.mockResolvedValue({ item: {} })
    renderEditor()
    await screen.findByText(/"body":"hello"/)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const textarea = await screen.findByLabelText('Document (JSON)')
    fireEvent.change(textarea, { target: { value: '{"_id":"d1","body":"edited"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocked.updateDocument).toHaveBeenCalledWith('ws1', 'appdb', 'notes', 'd1', { body: 'edited' })
    )
  })

  it('applies a JSON filter and requeries', async () => {
    renderEditor()
    await screen.findByText(/"body":"hello"/)
    fireEvent.change(screen.getByLabelText(/Filter \(MongoDB query JSON\)/), { target: { value: '{"status":"active"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filter' }))
    await waitFor(() =>
      expect(mocked.listDocuments).toHaveBeenLastCalledWith(
        'ws1', 'appdb', 'notes', expect.objectContaining({ filter: { status: 'active' } })
      )
    )
  })

  it('rejects an invalid filter JSON without querying', async () => {
    renderEditor()
    await screen.findByText(/"body":"hello"/)
    mocked.listDocuments.mockClear()
    fireEvent.change(screen.getByLabelText(/Filter \(MongoDB query JSON\)/), { target: { value: '{bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Filter: Not valid JSON')
    expect(mocked.listDocuments).not.toHaveBeenCalled()
  })

  it('paginates with the keyset cursor', async () => {
    mocked.listDocuments.mockResolvedValue({ items: [{ _id: 'd1', body: 'hello' }], page: { after: 'CUR1' } })
    renderEditor()
    await screen.findByText(/"body":"hello"/)
    const next = screen.getByRole('button', { name: 'Next' })
    expect(next).not.toBeDisabled()
    fireEvent.click(next)
    await waitFor(() =>
      expect(mocked.listDocuments).toHaveBeenLastCalledWith('ws1', 'appdb', 'notes', expect.objectContaining({ after: 'CUR1' }))
    )
  })

  it('deletes a document by _id', async () => {
    mocked.deleteDocument.mockResolvedValue({ deleted: true })
    renderEditor()
    await screen.findByText(/"body":"hello"/)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocked.deleteDocument).toHaveBeenCalledWith('ws1', 'appdb', 'notes', 'd1'))
  })

  it('issues an anon key with embed snippets and runs a read-only preview AS the key', async () => {
    mocked.issueApiKey.mockResolvedValue({ id: 'k1', key: 'flc_anon_secret', prefix: 'flc_anon_s', keyType: 'anon', scopes: [] })
    mocked.previewDocumentsWithApiKey.mockResolvedValue({ items: [{ _id: 'p1', body: 'as-anon' }] })
    renderEditor()
    await screen.findByText(/"body":"hello"/)
    fireEvent.click(screen.getByRole('button', { name: 'Issue anon key' }))
    expect(await screen.findByText('flc_anon_secret')).toBeInTheDocument()
    expect(screen.getByText('MONGO_FETCH_SNIPPET')).toBeInTheDocument()
    expect(screen.getByText('MONGO_CURL_SNIPPET')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run read-only preview' }))
    await waitFor(() =>
      expect(mocked.previewDocumentsWithApiKey).toHaveBeenCalledWith('flc_anon_secret', 'ws1', 'appdb', 'notes', { pageSize: 10 })
    )
    expect(await screen.findByText(/"body":"as-anon"/)).toBeInTheDocument()
  })
})
