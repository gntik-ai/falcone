import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import * as transport from '@in-falcone/console-api/session'
import OperationDetailPage, { relativeTime, statusTones, levelTones } from '../src/pages/operationDetail'
import { queryOperation, useOperationQuery } from '../src/pages/operationDetail/query'
import { operation, entries, successResult, bodyFor } from './parity/pages/operationDetail.manifest'
import i18n from '../src/i18n'

const logsResponse = (offset = 0) => ({ queryType: 'logs', operationId: 'op_1', entries: entries.slice(offset, offset + 20), total: 45, pagination: { limit: 20, offset } })
function mockTransport(overrides: Record<string, unknown> = {}) {
  return vi.spyOn(transport, 'requestConsoleSessionJson').mockImplementation(async (_path, options) => {
    const body = options!.body as { queryType: string; pagination: { offset: number } }
    const value = overrides[body.queryType]
    if (value instanceof Error || (value && typeof value === 'object' && 'status' in value && !('operationId' in value))) throw value
    return (value ?? (body.queryType === 'detail' ? operation : body.queryType === 'result' ? successResult : logsResponse(body.pagination.offset))) as never
  })
}
function open(path = '/console/operations/op_1') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/console/operations/:operationId?" element={<OperationDetailPage />} />
    <Route path="/console/operations" element={<p>Operations destination</p>} />
  </Routes></MemoryRouter>)
}
afterEach(() => vi.useRealTimers())
async function settleRetries() { await act(async () => { await vi.advanceTimersByTimeAsync(4000) }) }

test('F17/F18/F19: metadata, status, 20 wrapped logs, timeline and result use the shared transport', async () => {
  const request = mockTransport()
  open()
  expect(await screen.findByText('synthetic-workspace-create')).toBeVisible()
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Detalle de operación')
  expect(screen.getAllByText('Completada').length).toBeGreaterThan(0)
  expect(document.querySelectorAll('.operation-metadata dt')).toHaveLength(8)
  expect(within(screen.getByRole('log')).getAllByRole('row')).toHaveLength(21)
  expect(screen.getByText(entries[0].message)).toBeVisible()
  expect(screen.getByRole('list', { name: 'Cronología' }).children).toHaveLength(3)
  for (const queryType of ['detail', 'logs', 'result']) expect(request).toHaveBeenCalledWith('/v1/async-operation-query', expect.objectContaining({ method: 'POST', body: bodyFor(queryType), idempotent: true, signal: expect.any(AbortSignal) }))
  fireEvent.click(screen.getByRole('tab', { name: 'Resultado' }))
  expect(screen.getByText(successResult.summary)).toBeVisible()
  expect(screen.getByText(/Completada el/)).toBeVisible()
})

test.each(['missing', '404', 'empty', '403', '500', 'network'])('F20/error precedence: %s', async (state) => {
  vi.useFakeTimers()
  const failure = state === 'network' ? new TypeError('synthetic network') : { status: Number(state), requestId: 'synthetic-request' }
  const request = mockTransport(state === 'empty' ? { detail: {} } : state === 'missing' ? {} : { detail: failure })
  open(state === 'missing' ? '/console/operations' : undefined)
  await settleRetries()
  if (state === 'missing') expect(request).not.toHaveBeenCalled()
  if (['missing', '404', 'empty'].includes(state)) expect(screen.getByRole('heading', { name: 'Operación no encontrada o no disponible.' })).toBeVisible()
  else if (state === '403') {
    expect(screen.getByText('No tienes permiso para ver esta operación.')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Solicitar/ })).not.toBeInTheDocument()
  } else {
    expect(screen.getByRole('heading', { name: 'No se pudo cargar: Metadatos' })).toBeVisible()
    expect(screen.queryByText('Operación no encontrada o no disponible.')).not.toBeInTheDocument()
    expect(request.mock.calls.filter(([, options]) => (options!.body as { queryType: string }).queryType === 'detail')).toHaveLength(3)
    if (state === '500') expect(screen.getByText('synthetic-request')).toBeVisible()
  }
})

test('401 remains owned by the shell and is never shown as not found or a query failure', async () => {
  mockTransport({ detail: { status: 401 } }); open()
  await act(async () => {})
  expect(screen.queryByText('Operación no encontrada o no disponible.')).not.toBeInTheDocument()
  expect(screen.queryByText(/No se pudo cargar/)).not.toBeInTheDocument()
})

test('logs fail independently, retry keeps its body, focuses recovery and leaves result available', async () => {
  vi.useFakeTimers()
  const request = mockTransport({ logs: { status: 500, requestId: 'synthetic-request' } })
  open(); await settleRetries()
  expect(screen.getByText('synthetic-workspace-create')).toBeVisible()
  const button = screen.getByRole('button', { name: 'Reintentar' }); button.focus()
  fireEvent.click(button); await settleRetries()
  expect(button).toHaveFocus()
  request.mockImplementation(async (_path, options) => {
    const body = options!.body as { queryType: string; pagination: { offset: number } }
    return (body.queryType === 'logs' ? logsResponse(body.pagination.offset) : operation) as never
  })
  fireEvent.click(button); await act(async () => {})
  expect(screen.getByRole('heading', { name: 'Registros resumidos' })).toHaveFocus()
  const last = request.mock.calls.at(-1)!
  expect(last[1]!.body).toEqual(bodyFor('logs'))
  fireEvent.click(screen.getByRole('tab', { name: 'Resultado' }))
  expect(screen.getByText(successResult.summary)).toBeVisible()
})

test('paging sends offsets 20/40/0, with disabled previous and next at the boundaries', async () => {
  const request = mockTransport(); open()
  await screen.findByText(entries[0].message)
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  await screen.findByText(entries[20].message)
  expect(request).toHaveBeenLastCalledWith('/v1/async-operation-query', expect.objectContaining({ body: bodyFor('logs', 20) }))
  screen.getByRole('button', { name: 'Siguiente' }).focus()
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
  await screen.findByText(entries[40].message)
  expect(screen.getByRole('button', { name: 'Página 3' })).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Página 1' }))
  await screen.findByText(entries[0].message)
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
})

test('network failure clears previously loaded logs and manual retry uses the current offset', async () => {
  vi.useFakeTimers()
  let fail = false
  const request = vi.spyOn(transport, 'requestConsoleSessionJson').mockImplementation(async (_path, options) => {
    const body = options!.body as { pagination: { offset: number } }
    if (fail) throw new TypeError('synthetic network')
    return logsResponse(body.pagination.offset) as never
  })
  function Probe() {
    const query = useOperationQuery<ReturnType<typeof logsResponse>>('logs', 'op_1', 20)
    return <><button onClick={() => void query.refetch()}>Reload</button><span>{query.data?.entries[0].message}</span><span>{query.error ? 'Error' : ''}</span></>
  }
  render(<Probe />); await act(async () => {})
  expect(screen.getByText(entries[20].message)).toBeVisible()
  fail = true; fireEvent.click(screen.getByRole('button')); await settleRetries()
  expect(screen.queryByText(entries[20].message)).not.toBeInTheDocument()
  expect(screen.getByText('Error')).toBeVisible()
  expect(request.mock.calls.at(-1)![1]!.body).toEqual(bodyFor('logs', 20))
})

test.each(['es', 'en'])('all status and level labels, relative dates and pagination are localized in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  mockTransport(); open(); await screen.findByText(entries[0].message)
  const t = i18n.getFixedT(locale, 'operationDetail')
  for (const status of Object.keys(statusTones)) expect(t(`status.${status}`)).not.toMatch(/^status\./)
  for (const level of Object.keys(levelTones)) expect(screen.getAllByText(t(`level.${level}`)).length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: t('previous') })).toBeDisabled()
  expect(screen.getByText(t('range', { from: 1, to: 20, total: 45 }))).toBeVisible()
  expect(relativeTime('2026-06-01T11:55:00Z', locale, Date.parse('2026-06-01T12:00:00Z'))).toBe(locale === 'es' ? 'hace 5 minutos' : '5 minutes ago')
})

test('missing optional ids use dashes; copying announces feedback and keeps focus', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  mockTransport({ detail: { ...operation, workspaceId: null, sagaId: null } }); open()
  await screen.findByText('synthetic-workspace-create')
  expect(screen.getAllByText('—')).toHaveLength(2)
  const button = screen.getByRole('button', { name: 'Copiar ID de correlación' }); button.focus(); fireEvent.click(button)
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(operation.correlationId))
  expect(button).toHaveFocus()
  expect(screen.getByText('Copiado')).toBeInTheDocument()
})

test.each(['success', 'failure', 'pending'])('result %s and empty logs have explicit content', async (kind) => {
  mockTransport({ logs: { ...logsResponse(), entries: [], total: 0 }, result: { ...successResult, resultType: kind, failureReason: 'Synthetic failure reason', retryable: true, completedAt: kind === 'pending' ? null : successResult.completedAt } })
  open(); await screen.findByText('La operación aún no ha comenzado a ejecutarse.')
  fireEvent.click(screen.getByRole('tab', { name: 'Resultado' }))
  expect(screen.getByText(kind === 'success' ? successResult.summary : kind === 'failure' ? 'Synthetic failure reason' : 'La operación aún está en curso.')).toBeVisible()
  if (kind === 'failure') expect(screen.getByText('Esta operación puede reintentarse.')).toBeVisible()
})

test('detail, result and log requests include the exact default pagination', async () => {
  const request = mockTransport()
  for (const [type, offset] of [['detail', 0], ['result', 0], ['logs', 0], ['logs', 20]] as const) {
    await queryOperation(type, 'op_1', offset)
    expect(request).toHaveBeenLastCalledWith('/v1/async-operation-query', { method: 'POST', body: bodyFor(type, offset), idempotent: true, signal: undefined })
  }
})

test.each(['es', 'en'].flatMap((locale) => Object.keys(statusTones).map((status) => [locale, status])))('renders status %s/%s with the correct tone and translated label', async (locale, status) => {
  await i18n.changeLanguage(locale)
  mockTransport({ detail: { ...operation, status } }); open()
  await screen.findByText('synthetic-workspace-create')
  const tag = document.querySelector(`[data-status="${status}"]`)!
  expect(tag).toHaveTextContent(i18n.t(`status.${status}`, { ns: 'operationDetail' }))
  const tone = statusTones[status as keyof typeof statusTones]
  expect(tag.className).toContain(`bg-${tone === 'neutral' ? 'muted-foreground' : tone}`)
})

test('result failure retries independently and preserves the result request shape', async () => {
  vi.useFakeTimers()
  const request = mockTransport({ result: { status: 500, requestId: 'synthetic-result-request' } })
  open(); await settleRetries()
  expect(screen.getByText(entries[0].message)).toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: 'Resultado' }))
  expect(screen.getByText('synthetic-result-request')).toBeVisible()
  request.mockResolvedValue(successResult as never)
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })); await act(async () => {})
  expect(screen.getByRole('heading', { name: 'Resultado', level: 2 })).toHaveFocus()
  expect(request.mock.calls.at(-1)![1]!.body).toEqual(bodyFor('result'))
})

test('initial skeleton announcements are unique for metadata, timeline, logs and result', async () => {
  vi.spyOn(transport, 'requestConsoleSessionJson').mockImplementation(() => new Promise(() => {}))
  open()
  for (const label of ['Cargando metadatos.', 'Cargando cronología.', 'Cargando registros resumidos.', 'Cargando resultado.']) expect(screen.getAllByText(label)).toHaveLength(1)
})

test('the back link navigates to the operations list under the next basename', async () => {
  mockTransport()
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/operations/op_1']}><Routes>
    <Route path="/console/operations/:operationId" element={<OperationDetailPage />} />
    <Route path="/console/operations" element={<h1>Operations destination</h1>} />
  </Routes></MemoryRouter>)
  await screen.findByText('synthetic-workspace-create')
  fireEvent.click(screen.getByRole('link', { name: 'Volver a operaciones' }))
  expect(screen.getByRole('heading', { name: 'Operations destination' })).toBeVisible()
})
