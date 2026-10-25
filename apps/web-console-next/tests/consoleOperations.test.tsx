import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import * as transport from '@in-falcone/console-api/session'
import ConsoleOperationsPage, { OperationStatusBadge, statusTones } from '../src/pages/consoleOperations'
import { I18nProvider } from '@gntik-ai/ui'
import { OperationStatusBanner, summarizeDelta } from '../src/pages/consoleOperations/banner'
import { listOperations, normalizeFilters } from '../src/pages/consoleOperations/query'
import { reconcileOperations, type ReconciliationDelta } from '../src/pages/consoleOperations/reconcile-operations.runtime.mjs'
import { operations, running, completed, listBody, listResponse, reconciliationBody } from './parity/pages/console-operations.manifest'
import i18n from '../src/i18n'

const context = vi.hoisted(() => ({ activeTenantId: 'synthetic-tenant' as string | null, activeWorkspaceId: 'synthetic-workspace' as string | null }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context }))
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); context.activeTenantId = 'synthetic-tenant'; context.activeWorkspaceId = 'synthetic-workspace' })
function mockList(rows = operations) {
  return vi.spyOn(transport, 'requestConsoleSessionJson').mockImplementation(async (path, options) => {
    if (path === '/v1/console/session') return {} as never
    const body = options!.body as unknown as ReturnType<typeof listBody>
    const { limit, offset } = body.pagination
    const filters = body.filters
    const filtered = rows.filter((row) => (!filters.status || (Array.isArray(filters.status) ? filters.status.includes(row.status) : row.status === filters.status)) && (!filters.operationType || filters.operationType === row.operationType) && (!filters.workspaceId || row.workspaceId === filters.workspaceId))
    return listResponse(filtered.slice(offset, offset + limit), filtered.length, offset, limit) as never
  })
}
function open() { return render(<MemoryRouter><ConsoleOperationsPage /></MemoryRouter>) }
async function flush(ms = 0) { await act(async () => { if (ms) await vi.advanceTimersByTimeAsync(ms) }) }
async function select(name: string, option: string) { fireEvent.click(screen.getByRole('combobox', { name })); await act(async () => {}); fireEvent.pointerDown(screen.getByRole('option', { name: option })); fireEvent.click(screen.getByRole('option', { name: option })); await flush() }
const emptyDelta = (partial: Partial<ReconciliationDelta> = {}): ReconciliationDelta => ({ updated: [], added: [], terminal: [], unavailable: [], unchanged: [], ...partial })

test('F13/F16 renders 20 operations with statuses, actors, workspaces, locale dates and keyboard detail links', async () => {
  const request = mockList(); open(); await screen.findAllByRole('link', { name: operations[0].operationType })
  expect(screen.getByRole('heading', { name: 'Operaciones' })).toBeVisible()
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(21)
  expect(request).toHaveBeenCalledWith('/v1/async-operation-query', expect.objectContaining({ method: 'POST', body: listBody(), idempotent: true, signal: expect.any(AbortSignal) }))
  expect(screen.getAllByRole('link', { name: operations[0].operationType })[0]).toHaveAttribute('href', '/console/operations/op_1')
  expect(screen.getAllByText('—').length).toBe(10)
  expect(screen.getAllByText(new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(operations[0].createdAt))).length).toBe(20)
})

test('F14 normalizes filters, derives sorted unique types from the current page and resets offset', async () => {
  const request = mockList(); open(); await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' })); await flush()
  expect(request.mock.calls.at(-1)![1]!.body).toEqual(listBody({}, 20))
  await select('Tipo de operación', 'synthetic-workspace-create')
  expect(request.mock.calls.at(-1)![1]!.body).toEqual(listBody({ operationType: 'synthetic-workspace-create' }))
  fireEvent.click(screen.getByRole('combobox', { name: 'Tipo de operación' })); await flush()
  expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual(['Todos', 'synthetic-workspace-create'])
  fireEvent.pointerDown(screen.getByRole('option', { name: 'Todos' })); fireEvent.click(screen.getByRole('option', { name: 'Todos' })); await flush()
  await select('Estado', 'En curso')
  expect(request.mock.calls.at(-1)![1]!.body).toEqual(listBody({ status: 'running' }))
  const workspace = screen.getByRole('textbox', { name: 'Área de trabajo' }); workspace.focus()
  fireEvent.change(workspace, { target: { value: ' wrk_a ' } }); await flush()
  expect(request.mock.calls.at(-1)![1]!.body).toEqual(listBody({ status: 'running', workspaceId: 'wrk_a' }))
  expect(workspace).toHaveFocus()
  fireEvent.change(workspace, { target: { value: '' } }); await flush()
  expect(request.mock.calls.at(-1)![1]!.body).toEqual(listBody({ status: 'running' }))
  expect(normalizeFilters('', '  ', ' ')).toEqual({ status: undefined, operationType: undefined, workspaceId: undefined })
})

test('paging uses offsets 20 and 40 and recovers focus when the boundary disables its control', async () => {
  mockList(); open(); await flush()
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
  let next = screen.getByRole('button', { name: 'Siguiente' }); next.focus(); fireEvent.click(next); await flush()
  expect(next).toHaveFocus(); expect(screen.getByText('21–40 de 45', { selector: 'p' })).toBeVisible()
  fireEvent.click(next); await flush()
  expect(screen.getByText('41–45 de 45', { selector: 'p' })).toBeVisible()
  expect(next).toBeDisabled(); expect(screen.getByRole('button', { name: 'Página 3' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Página 1' })); await flush()
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
})

test('F15 shows a first-run state, filtered no-results and an action to clear filters', async () => {
  mockList([]); open(); await flush()
  expect(screen.getByText('No hay operaciones registradas para esta organización.')).toBeVisible()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } }); await flush()
  expect(screen.getByText('No se encontraron operaciones.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Borrar filtros' })); await flush()
  expect(screen.getByRole('textbox')).toHaveValue('')
})

test('loading is labelled and never flashes the skeleton during a poll', async () => {
  vi.useFakeTimers()
  const request = vi.spyOn(transport, 'requestConsoleSessionJson').mockImplementation(() => new Promise(() => {}))
  open()
  expect(screen.getByRole('status', { name: 'Cargando operaciones' })).toHaveAttribute('aria-busy', 'true')
  expect(request).toHaveBeenCalledTimes(1)
})

test.each([401, 403, 404, 500, 'network'])('handles %s without adding an auth guard or auth behavior', async (status) => {
  vi.useFakeTimers()
  const request = vi.spyOn(transport, 'requestConsoleSessionJson').mockRejectedValue(status === 'network' ? new TypeError('synthetic network') : { status, requestId: 'synthetic-request' })
  open(); await flush(4000)
  if (status === 401) {
    expect(request).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('No se pudieron cargar las operaciones.')).not.toBeInTheDocument()
  } else if (status === 403) expect(screen.getByText('No tienes permiso para ver esta página.')).toBeVisible()
  else if (status === 404) expect(screen.getByRole('link', { name: 'Volver al resumen' })).toHaveAttribute('href', '/console/overview')
  else {
    expect(request).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Se detuvieron los reintentos automáticos para evitar tráfico continuo. Reintenta cuando el servicio esté disponible.')).toBeVisible()
    if (status === 500) expect(screen.getByText('synthetic-request')).toBeVisible()
  }
})

test('polls pending/running at 30 seconds, retries at 1 and 3 seconds, retains stale data and stops polling', async () => {
  vi.useFakeTimers()
  const request = mockList([running]); open(); await flush()
  await flush(29_999); expect(request).toHaveBeenCalledTimes(1)
  request.mockRejectedValue(new TypeError('synthetic network'))
  await flush(1); expect(request).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('status', { name: 'Cargando operaciones' })).not.toBeInTheDocument()
  await flush(999); expect(request).toHaveBeenCalledTimes(2)
  await flush(1); expect(request).toHaveBeenCalledTimes(3)
  await flush(2999); expect(request).toHaveBeenCalledTimes(3)
  await flush(1); expect(request).toHaveBeenCalledTimes(4)
  expect(screen.getByText('La lista no está actualizada. Reintenta para actualizar las operaciones.')).toBeVisible()
  expect(screen.getByRole('table')).toBeVisible()
  await flush(60_000); expect(request).toHaveBeenCalledTimes(4)
})

test('terminal operations do not poll; unmount clears an active poll', async () => {
  vi.useFakeTimers(); const request = mockList([completed]); const view = open(); await flush()
  await flush(60_000); expect(request).toHaveBeenCalledTimes(1)
  view.unmount()
  request.mockResolvedValue(listResponse([running]) as never)
  const active = open(); await flush(); active.unmount(); await flush(60_000)
  expect(request).toHaveBeenCalledTimes(2)
})

test('manual retry retains the current filtered page request and focuses the caption only on success', async () => {
  vi.useFakeTimers(); const request = mockList(operations.map((row) => ({ ...row, status: 'running' }))); open(); await flush()
  await select('Estado', 'En curso')
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' })); await flush()
  request.mockRejectedValue({ status: 500 }); await flush(34_000)
  const button = screen.getByRole('button', { name: 'Reintentar' }); button.focus(); fireEvent.click(button); await flush(4000)
  expect(button).toHaveFocus()
  request.mockResolvedValue(listResponse([running], 45, 20) as never)
  fireEvent.click(button); await flush()
  expect(request.mock.calls.at(-1)![1]!.body).toEqual(listBody({ status: 'running' }, 20))
  expect(document.querySelector('caption')).toHaveFocus()
})

test.each(['es', 'en'])('independent terminal, added, unavailable, zero and nonterminal copy oracles in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const t = i18n.getFixedT(locale, 'pages.console-operations-page')
  expect(summarizeDelta(emptyDelta(), t)).toBe('')
  expect(summarizeDelta(emptyDelta({ updated: [running] }), t)).toBe('')
  for (const [status, singularEs, pluralEs, wordEn] of [
    ['completed', 'completada', 'completadas', 'completed'], ['failed', 'falló', 'fallaron', 'failed'],
    ['timed_out', 'expirada', 'expiradas', 'timed out'], ['cancelled', 'cancelada', 'canceladas', 'cancelled'],
  ] as const) {
    const row = { ...running, status }
    for (const count of [1, 2]) expect(summarizeDelta(emptyDelta({ terminal: Array(count).fill(row), added: [running] }), t)).toBe(locale === 'es'
      ? `${count} ${count === 1 ? 'operación' : 'operaciones'} ${count === 1 ? singularEs : pluralEs} mientras estabas desconectado.`
      : `${count} ${count === 1 ? 'operation' : 'operations'} ${wordEn} while you were offline.`)
  }
  expect(summarizeDelta(emptyDelta({ terminal: [completed, { ...completed, status: 'failed' }], unavailable: ['a', 'b'], added: [running] }), t)).toBe(locale === 'es'
    ? '1 operación completada, 1 operación falló mientras estabas desconectado. 2 operaciones ya no están disponibles (eliminadas o purgadas).'
    : '1 operation completed, 1 operation failed while you were offline. 2 operations are no longer available (deleted or purged).')
  for (const count of [1, 2]) {
    expect(summarizeDelta(emptyDelta({ unavailable: Array(count).fill('a'), added: [running] }), t)).toBe(locale === 'es'
      ? count === 1 ? '1 operación ya no está disponible (eliminadas o purgadas).' : '2 operaciones ya no están disponibles (eliminadas o purgadas).'
      : count === 1 ? '1 operation is no longer available (deleted or purged).' : '2 operations are no longer available (deleted or purged).')
    expect(summarizeDelta(emptyDelta({ added: Array(count).fill(running) }), t)).toBe(locale === 'es'
      ? count === 1 ? '1 nueva operación detectada al reconectar.' : '2 nuevas operaciones detectadas al reconectar.'
      : count === 1 ? '1 new operation detected on reconnect.' : '2 new operations detected on reconnect.')
  }
})

test('banner dismisses on click and at exactly 30 seconds, with an empty delta rendering nothing', async () => {
  vi.useFakeTimers(); const dismiss = vi.fn(); const close = vi.fn()
  const view = render(<I18nProvider locale="es"><OperationStatusBanner delta={emptyDelta({ terminal: [completed] })} onDismiss={dismiss} onClose={close} /></I18nProvider>)
  expect(screen.getByRole('status')).toHaveTextContent('1 operación completada mientras estabas desconectado.')
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar' })); expect(close).toHaveBeenCalledTimes(1)
  await flush(29_000); expect(dismiss).not.toHaveBeenCalled()
  await flush(1000); expect(dismiss).toHaveBeenCalledTimes(1)
  view.rerender(<OperationStatusBanner delta={emptyDelta()} onDismiss={dismiss} onClose={close} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test.each(['true', 'false'])('reconnect debounces both events, reconciles, refetches on change; flag %s only controls banner', async (flag) => {
  vi.useFakeTimers(); vi.stubEnv('VITE_CONSOLE_RECONNECT_SYNC_ENABLED', flag)
  const request = mockList([running]); open(); await flush()
  request.mockImplementation(async (path, options) => {
    if (path === '/v1/console/session') return {} as never
    const body = options!.body as unknown as ReturnType<typeof listBody>
    return listResponse(Array.isArray(body.filters.status) ? [completed, { ...running, operationId: 'op_added' }] : [completed]) as never
  })
  const start = request.mock.calls.length
  fireEvent.online(window); fireEvent(document, new Event('visibilitychange'))
  await flush(499); expect(request).toHaveBeenCalledTimes(start)
  await flush(1)
  expect(request.mock.calls.slice(start).map(([path, options]) => [path, options?.body])).toEqual([
    ['/v1/console/session', undefined], ['/v1/async-operation-query', reconciliationBody()], ['/v1/async-operation-query', listBody()],
  ])
  const copy = '1 operación completada mientras estabas desconectado.'
  if (flag === 'false') expect(screen.queryByText(copy)).not.toBeInTheDocument()
  else {
    expect(screen.getByText(copy)).toBeVisible()
    await flush(29_000); expect(screen.getByText(copy)).toBeVisible()
    await flush(1000); expect(screen.queryByText(copy)).not.toBeInTheDocument()
    fireEvent.online(window); await flush(500)
    // The current terminal row is not present among active results in a real response; unchanged here has no message.
  }
})

test('no tenant, hidden visibility and unchanged reconciliation add no inappropriate requests', async () => {
  vi.useFakeTimers(); context.activeTenantId = null
  const request = mockList([running]); const view = open(); await flush()
  fireEvent.online(window); fireEvent(document, new Event('visibilitychange')); await flush(2000)
  expect(request).toHaveBeenCalledTimes(1); view.unmount()
  context.activeTenantId = 'synthetic-tenant'; const active = open(); await flush()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  fireEvent(document, new Event('visibilitychange')); await flush(2000); expect(request).toHaveBeenCalledTimes(2)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  fireEvent(document, new Event('visibilitychange')); await flush(500)
  expect(request).toHaveBeenCalledTimes(4) // session, active list; no refetch for unchanged.
  active.unmount()
})

test.each(['debounce', 'session', 'reconciliation'])('unmount during %s cancels timers and aborts requests without follow-up', async (stage) => {
  vi.useFakeTimers(); const request = mockList([running]); const view = open(); await flush()
  let signal: AbortSignal | undefined
  request.mockImplementation(async (path, options) => {
    signal = options?.signal ?? undefined
    if (stage === 'session' || path !== '/v1/console/session') return await new Promise(() => {})
    return {} as never
  })
  fireEvent.online(window)
  if (stage !== 'debounce') await flush(500)
  const count = request.mock.calls.length
  view.unmount(); await flush(2000)
  expect(request).toHaveBeenCalledTimes(count)
  if (stage !== 'debounce') expect(signal?.aborted).toBe(true)
})

test('reconciliation pages by items received until total and refetches only on a delta', async () => {
  vi.useFakeTimers(); const request = mockList([running]); open(); await flush()
  const remote = [running, ...Array.from({ length: 100 }, (_, i) => ({ ...running, operationId: `added_${i}` }))]
  request.mockImplementation(async (path, options) => {
    if (path === '/v1/console/session') return {} as never
    const body = options!.body as unknown as ReturnType<typeof listBody>
    return (Array.isArray(body.filters.status) ? listResponse(remote.slice(body.pagination.offset, body.pagination.offset + 100), 101) : listResponse([running])) as never
  })
  fireEvent.online(window); await flush(500)
  const bodies = request.mock.calls.map(([, options]) => options?.body)
  expect(bodies).toContainEqual(reconciliationBody()); expect(bodies).toContainEqual(reconciliationBody(100))
  expect(reconcileOperations(new Map([[running.operationId, running]]), [completed]).terminal).toEqual([completed])
})

test.each(['es', 'en'].flatMap((locale) => Object.keys(statusTones).map((status) => [locale, status])))('status badge %s/%s has kit tone and an independent translated label', async (locale, status) => {
  await i18n.changeLanguage(locale)
  const labels = locale === 'es' ? ['Pendiente', 'En curso', 'Completada', 'Fallida', 'Expirada', 'Cancelada'] : ['Pending', 'Running', 'Completed', 'Failed', 'Timed out', 'Cancelled']
  render(<I18nProvider locale={locale}><OperationStatusBadge status={status as keyof typeof statusTones} /></I18nProvider>)
  const tag = screen.getByText(labels[Object.keys(statusTones).indexOf(status)])
  expect(tag).toHaveAttribute('data-status', status)
  expect(tag.className).toContain(`bg-${statusTones[status as keyof typeof statusTones] === 'neutral' ? 'muted-foreground' : statusTones[status as keyof typeof statusTones]}`)
})

test('the list transport sends normalized query and pagination field for field', async () => {
  const request = mockList()
  await listOperations(normalizeFilters('running', ' type ', ' wrk_a '), 20)
  expect(request).toHaveBeenLastCalledWith('/v1/async-operation-query', { method: 'POST', body: listBody({ status: 'running', operationType: 'type', workspaceId: 'wrk_a' }, 20), idempotent: true, signal: undefined })
})

test('English page copy, visible filter labels, dates and pagination use independent oracles', async () => {
  await i18n.changeLanguage('en')
  mockList(); open(); await flush()
  expect(screen.getByRole('heading', { name: 'Operations' })).toBeVisible()
  expect(screen.getByText('View the progress and results of asynchronous operations for the active organization.')).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Status' })).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Operation type' })).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Workspace' })).toHaveAttribute('placeholder', 'wrk_demo')
  expect(screen.getByText('1–20 of 45', { selector: 'p' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  expect(screen.getAllByText('Jun 1, 2026, 10:00 AM')).toHaveLength(20)
})

test('nonterminal reconciliation changes refetch the list without a callout', async () => {
  vi.useFakeTimers(); const request = mockList([running]); open(); await flush()
  request.mockImplementation(async (path) => (path === '/v1/console/session' ? {} : listResponse([{ ...running, status: 'pending' }])) as never)
  fireEvent.online(window); await flush(500)
  expect(request).toHaveBeenCalledTimes(4)
  expect(screen.getByText('Pendiente')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument()
})

test.each(['session', 'reconciliation'])('a completed %s response after unmount cannot start a follow-up request', async (stage) => {
  vi.useFakeTimers(); const request = mockList([running]); const view = open(); await flush()
  let release!: (value: unknown) => void
  request.mockImplementation(async (path) => {
    if (stage === 'reconciliation' && path === '/v1/console/session') return {} as never
    return await new Promise<unknown>((resolve) => { release = resolve }) as never
  })
  fireEvent.online(window); await flush(500)
  const count = request.mock.calls.length
  view.unmount(); release(listResponse([completed])); await flush(2000)
  expect(request).toHaveBeenCalledTimes(count)
})
