import { click, create, fail, ready, remove, selectBucket, selectObject, setup, upload } from './consoleStorage-support'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { buildConsoleRefreshSessionFixture } from '@in-falcone/console-api/fixtures'
import { readConsoleShellSession, readProtectedRouteIntent } from '@in-falcone/console-api/session'
import ConsoleStoragePage from '../src/pages/consoleStorage'
import { ProtectedRoute } from '../src/shell/session'
import type { EndpointResponse } from './parity/manifest'

import { endpoints } from './parity/pages/console-storage-page.manifest'
let server: ReturnType<typeof setup>
afterEach(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) }); server?.verify() })
function open() {
  render(<MemoryRouter initialEntries={['/console/storage']}><Routes><Route path="/console/storage" element={<ProtectedRoute><ConsoleStoragePage /></ProtectedRoute>} /><Route path="/login" element={<h1>synthetic-login</h1>} /></Routes></MemoryRouter>)
}
async function activate(section: string) {
  if (['buckets', 'usage'].includes(section)) return
  if (section === 'create') { await ready(); create(); return }
  if (section === 'export') { await ready(); click('Exportar media-assets'); return }
  if (section === 'delete') { await ready(); remove(); return }
  if (section === 'objects') { await ready(); click('media-assets'); return }
  if (section === 'metadata') { await selectBucket(); click('media/hero.png'); return }
  if (section === 'upload') { await selectBucket(); upload(); return }
  await selectObject(); fireEvent.click(screen.getByRole('tab', { name: 'URLs prefirmadas' })); click('Generar URL de descarga prefirmada')
}
for (const section of ['buckets', 'usage', 'objects', 'metadata', 'presign', 'create', 'upload', 'export', 'delete']) for (const outcome of ['ok', 'replay-401', 'rejected'] as const) test(`${section} 401 ${outcome} uses only the session refresh and one identical replay`, async () => {
  const endpoint = endpoints[section]; let attempts = 0
  server = setup(); const original = readConsoleShellSession()!
  const fresh = buildConsoleRefreshSessionFixture(); fresh.principal = original.principal
  const refreshPath = `/v1/auth/login-sessions/${original.sessionId}/refresh`
  const success = endpoint.fixtures.success as EndpointResponse
  server = setup({
    [`${endpoint.method} ${endpoint.path}`]: () => ++attempts === 1 || outcome !== 'ok' ? fail(401)() : Response.json(success.body),
    [`POST ${refreshPath}`]: () => outcome === 'rejected' ? fail(401)() : Response.json(fresh),
  })
  if (section === 'export') { URL.createObjectURL = () => 'blob:synthetic'; URL.revokeObjectURL = () => {}; Object.defineProperty(HTMLAnchorElement.prototype, 'click', { configurable: true, value: () => {} }) }
  open(); await activate(section)
  if (outcome === 'ok') {
    await waitFor(() => expect(attempts).toBe(2))
    if (section === 'buckets') await ready()
    else if (section === 'usage') await screen.findByRole('meter')
    else if (section === 'objects') await screen.findByRole('button', { name: 'media/hero.png' })
    else if (section === 'metadata') await screen.findByText('abcdef1234567890abcdef1234567890')
    else if (section === 'presign') await screen.findByTestId('storage-presigned-result')
    else await screen.findByText(section === 'create' ? 'Bucket creado: media-assets.' : section === 'upload' ? 'Objeto subido: hello.txt (5 B).' : section === 'export' ? 'Exportados 1 objeto(s) (manifiesto manifest-synthetic).' : 'Bucket "media-assets" eliminado.')
  }
  else { await screen.findByRole('heading', { name: 'synthetic-login' }); expect(readProtectedRouteIntent()).toBe('/console/storage') }
  await waitFor(() => expect(server.mock.mock.calls.filter(([path]) => path === refreshPath)).toHaveLength(1))
  const calls = server.mock.mock.calls.filter(([path]) => path === endpoint.path)
  expect(calls).toHaveLength(outcome === 'rejected' ? 1 : 2)
  if (outcome !== 'rejected') {
    expect(calls[1][1]?.method).toBe(calls[0][1]?.method); expect(calls[1][1]?.body).toBe(calls[0][1]?.body)
    // Compare only in memory; no token value is recorded as an assertion artifact.
    expect(new Headers(calls[1][1]?.headers).get('Authorization') === `Bearer ${fresh.tokenSet?.accessToken}`).toBe(true)
  }
})
for (const action of ['create', 'upload', 'export', 'delete']) for (const outcome of ['ok', 'replay-401', 'rejected'] as const) test(`${action} retry ${outcome} stays disabled and has the qualified replay count`, async () => {
  const endpoint = endpoints[action]; const retryEndpoint = action === 'create' ? endpoints.buckets : endpoint
  let attempts = 0; let writes = 0; let retryStarted = false
  server = setup(); const original = readConsoleShellSession()!
  const fresh = buildConsoleRefreshSessionFixture(); fresh.principal = original.principal
  const refreshPath = `/v1/auth/login-sessions/${original.sessionId}/refresh`
  const success = retryEndpoint.fixtures.success as EndpointResponse
  server = setup({
    [`${endpoint.method} ${endpoint.path}`]: () => { writes++; if (action === 'create') throw new TypeError('synthetic-network'); if (!retryStarted) return fail(500)(); return ++attempts === 1 || outcome !== 'ok' ? fail(401)() : Response.json(success.body) },
    ...(action === 'create' ? { [`GET ${endpoints.buckets.path}`]: () => !retryStarted ? Response.json(success.body) : ++attempts === 1 || outcome !== 'ok' ? fail(401)() : Response.json(success.body) } : {}),
    [`POST ${refreshPath}`]: () => outcome === 'rejected' ? fail(401)() : Response.json(fresh),
  })
  if (action === 'export') { URL.createObjectURL = () => 'blob:synthetic'; URL.revokeObjectURL = () => {}; Object.defineProperty(HTMLAnchorElement.prototype, 'click', { configurable: true, value: () => {} }) }
  open(); await activate(action)
  const panel = await screen.findByTestId(`storage-failure-${action}`)
  retryStarted = true; click('Reintentar', panel)
  const retry = panel.querySelector<HTMLButtonElement>('button[aria-busy="true"]')
  expect(retry?.disabled || retry?.getAttribute('aria-disabled') === 'true').toBe(true)
  if (outcome !== 'ok') await screen.findByRole('heading', { name: 'synthetic-login' })
  else if (action === 'create') await screen.findByText(/No se puede confirmar si el bucket se creó/)
  else await screen.findByText(action === 'upload' ? 'Objeto subido: hello.txt (5 B).' : action === 'export' ? 'Exportados 1 objeto(s) (manifiesto manifest-synthetic).' : 'Bucket "media-assets" eliminado.')
  await waitFor(() => expect(attempts).toBe(outcome === 'rejected' ? 1 : 2))
  expect(server.mock.mock.calls.filter(([path]) => path === refreshPath)).toHaveLength(1)
  if (action === 'create') expect(writes).toBe(1)
  const calls = server.mock.mock.calls.filter(([path]) => path === retryEndpoint.path).slice(1)
  expect(calls).toHaveLength(outcome === 'rejected' ? 1 : 2)
  if (calls.length === 2) { expect(calls[1][1]?.body).toBe(calls[0][1]?.body); expect(calls[1][1]?.method).toBe(calls[0][1]?.method) }
})

test('a session replay of DELETE answered 404 is reported deleted without another DELETE', async () => {
  let attempts = 0
  server = setup(); const session = readConsoleShellSession()!
  const fresh = buildConsoleRefreshSessionFixture(); fresh.principal = session.principal
  const endpoint = endpoints.delete
  server = setup({ [`DELETE ${endpoint.path}`]: () => fail(++attempts === 1 ? 401 : 404)(), [`POST /v1/auth/login-sessions/${session.sessionId}/refresh`]: fresh })
  open(); await activate('delete'); expect(await screen.findByText('Bucket "media-assets" eliminado.')).toBeVisible(); expect(attempts).toBe(2)
})
