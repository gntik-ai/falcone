import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/postgresApi', () => ({
  listRows: vi.fn(),
  listApiKeys: vi.fn(),
  insertRow: vi.fn(),
  updateRow: vi.fn(),
  deleteRow: vi.fn(),
  issueApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  previewRowsWithApiKey: vi.fn(),
  buildFrontendSnippet: vi.fn(() => 'FETCH_SNIPPET'),
  buildCurlSnippet: vi.fn(() => 'CURL_SNIPPET')
}))

import { PostgresDataEditor } from './PostgresDataEditor'
import {
  deleteRow,
  insertRow,
  issueApiKey,
  listApiKeys,
  listRows,
  previewRowsWithApiKey,
  updateRow
} from '@/services/postgresApi'

const mocked = {
  listRows: listRows as unknown as ReturnType<typeof vi.fn>,
  listApiKeys: listApiKeys as unknown as ReturnType<typeof vi.fn>,
  insertRow: insertRow as unknown as ReturnType<typeof vi.fn>,
  updateRow: updateRow as unknown as ReturnType<typeof vi.fn>,
  deleteRow: deleteRow as unknown as ReturnType<typeof vi.fn>,
  issueApiKey: issueApiKey as unknown as ReturnType<typeof vi.fn>,
  previewRowsWithApiKey: previewRowsWithApiKey as unknown as ReturnType<typeof vi.fn>
}

function renderEditor() {
  return render(
    <PostgresDataEditor workspaceId="ws1" databaseName="appdb" schemaName="public" tableName="notes" />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.listApiKeys.mockResolvedValue({ items: [] })
  mocked.listRows.mockResolvedValue({ items: [{ id: 'r1', body: 'hello' }], count: 1 })
})
afterEach(() => cleanup())

describe('PostgresDataEditor — richer UX', () => {
  it('shows a loading state, then the rows with an exact count', async () => {
    renderEditor()
    expect(screen.getByText('Cargando filas…')).toBeInTheDocument()
    expect(await screen.findByText('hello')).toBeInTheDocument()
    expect(screen.getByText('Filas (1)')).toBeInTheDocument()
  })

  it('shows an empty state when there are no rows', async () => {
    mocked.listRows.mockResolvedValue({ items: [], count: 0 })
    renderEditor()
    expect(await screen.findByText('Todavía no hay filas.')).toBeInTheDocument()
  })

  it('validates new-row JSON before inserting', async () => {
    renderEditor()
    await screen.findByText('hello')
    fireEvent.change(screen.getByLabelText('Fila nueva (JSON)'), { target: { value: '{bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insertar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Fila nueva: Not valid JSON')
    expect(mocked.insertRow).not.toHaveBeenCalled()
  })

  it('inserts a valid row and reloads', async () => {
    mocked.insertRow.mockResolvedValue({ item: {} })
    renderEditor()
    await screen.findByText('hello')
    fireEvent.change(screen.getByLabelText('Fila nueva (JSON)'), { target: { value: '{"body":"new"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insertar' }))
    await waitFor(() => expect(mocked.insertRow).toHaveBeenCalledWith('ws1', 'appdb', 'public', 'notes', { body: 'new' }))
    expect(mocked.listRows).toHaveBeenCalledTimes(2) // initial + after insert
  })

  it('edits a row in place → updateRow with changes (id excluded)', async () => {
    mocked.updateRow.mockResolvedValue({ item: {}, affected: 1 })
    renderEditor()
    await screen.findByText('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const textarea = await screen.findByLabelText('Fila (JSON)')
    fireEvent.change(textarea, { target: { value: '{"id":"r1","body":"edited"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mocked.updateRow).toHaveBeenCalledWith('ws1', 'appdb', 'public', 'notes', { id: 'r1' }, { body: 'edited' })
    )
  })

  it('deletes a row by id', async () => {
    mocked.deleteRow.mockResolvedValue({ affected: 1 })
    renderEditor()
    await screen.findByText('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(mocked.deleteRow).toHaveBeenCalledWith('ws1', 'appdb', 'public', 'notes', { id: 'r1' }))
  })

  it('adds a filter and requeries the rows with it', async () => {
    renderEditor()
    await screen.findByText('hello')
    fireEvent.change(screen.getByLabelText('Columna'), { target: { value: 'status' } })
    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Añadir filtro' }))
    await waitFor(() =>
      expect(mocked.listRows).toHaveBeenLastCalledWith(
        'ws1', 'appdb', 'public', 'notes',
        expect.objectContaining({ filters: [{ columnName: 'status', operator: 'eq', value: 'active' }] })
      )
    )
    expect(screen.getByText(/status eq active/)).toBeInTheDocument()
  })

  it('changing the page size requeries from the first page', async () => {
    renderEditor()
    await screen.findByText('hello')
    fireEvent.change(screen.getByLabelText('Tamaño de página'), { target: { value: '50' } })
    await waitFor(() =>
      expect(mocked.listRows).toHaveBeenLastCalledWith(
        'ws1', 'appdb', 'public', 'notes', expect.objectContaining({ pageSize: 50, after: undefined })
      )
    )
  })

  it('paginates with the keyset cursor (Next enabled only when a cursor is returned)', async () => {
    mocked.listRows.mockResolvedValue({ items: [{ id: 'r1', body: 'hello' }], count: 5, page: { after: 'CUR1' } })
    renderEditor()
    await screen.findByText('hello')
    const next = screen.getByRole('button', { name: 'Siguiente' })
    expect(next).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    fireEvent.click(next)
    await waitFor(() =>
      expect(mocked.listRows).toHaveBeenLastCalledWith(
        'ws1', 'appdb', 'public', 'notes', expect.objectContaining({ after: 'CUR1' })
      )
    )
    expect(screen.getByRole('button', { name: 'Anterior' })).not.toBeDisabled()
  })

  it('issues an anon key and reveals the plaintext once with copy + embed snippets', async () => {
    mocked.issueApiKey.mockResolvedValue({ id: 'k1', key: 'flc_anon_secret', prefix: 'flc_anon_s', keyType: 'anon', scopes: [] })
    renderEditor()
    await screen.findByText('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Emitir clave anónima' }))
    expect(await screen.findByText('flc_anon_secret')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copiar clave' })).toBeInTheDocument()
    // fetch + curl embed snippets are shown
    expect(screen.getByText('FETCH_SNIPPET')).toBeInTheDocument()
    expect(screen.getByText('CURL_SNIPPET')).toBeInTheDocument()
  })

  it('runs a read-only preview AS the issued anon key and shows the rows', async () => {
    mocked.issueApiKey.mockResolvedValue({ id: 'k1', key: 'flc_anon_secret', prefix: 'flc_anon_s', keyType: 'anon', scopes: [] })
    mocked.previewRowsWithApiKey.mockResolvedValue({ items: [{ id: 'r9', body: 'as-anon' }] })
    renderEditor()
    await screen.findByText('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Emitir clave anónima' }))
    await screen.findByText('flc_anon_secret')
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar vista previa de solo lectura' }))
    await waitFor(() =>
      expect(mocked.previewRowsWithApiKey).toHaveBeenCalledWith('flc_anon_secret', 'ws1', 'appdb', 'public', 'notes', { pageSize: 10 })
    )
    expect(await screen.findByText('as-anon')).toBeInTheDocument()
    expect(screen.getByText(/Vista previa con esta clave: 1 fila/)).toBeInTheDocument()
  })
})

// #757: the editor must render every control via the shared design-system primitives
// (Button/Input/Select/Textarea/Table) — no native/unstyled <button>/<input>/<select>/<table>.
describe('PostgresDataEditor — design system (#757)', () => {
  it('renders every button, field and table via the shared design-system primitives', async () => {
    mocked.issueApiKey.mockResolvedValue({ id: 'k1', key: 'flc_anon_secret', prefix: 'flc_anon_s', keyType: 'anon', scopes: [] })
    mocked.previewRowsWithApiKey.mockResolvedValue({ items: [{ id: 'r9', body: 'as-anon' }] })
    const { container } = renderEditor()
    await screen.findByText('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Emitir clave anónima' }))
    await screen.findByText('flc_anon_secret')
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar vista previa de solo lectura' }))
    await screen.findByText('as-anon')

    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of Array.from(buttons)) {
      expect(button.className).toMatch(/focus-visible:ring-offset-background/)
    }

    const fields = container.querySelectorAll('input, select, textarea')
    expect(fields.length).toBeGreaterThan(0)
    for (const field of Array.from(fields)) {
      expect(field.className).toMatch(/rounded-xl border border-input/)
    }

    const tables = container.querySelectorAll('table')
    expect(tables.length).toBeGreaterThan(0)
    for (const table of Array.from(tables)) {
      expect(table.getAttribute('data-slot')).toBe('table')
    }
  })
})
