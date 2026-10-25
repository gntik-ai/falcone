import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { App } from '../src/App'
import i18n from '../src/i18n'
import { login, strictFetch, tenantUrl } from './shell-support'
import { listBody, listResponse, operations } from './parity/pages/console-operations.manifest'
import { bodyFor, entries, operation, successResult } from './parity/pages/operationDetail.manifest'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())

test.each(['es', 'en'])('row links keep the next basename and open the migrated detail through the shell in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  login(['platform_auditor'])
  requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [] },
    'POST /v1/async-operation-query': (init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      switch (body.queryType) {
        case 'list': return Response.json(listResponse([operations[0]]))
        case 'detail': return Response.json(operation)
        case 'logs': return Response.json({ queryType: 'logs', operationId: 'op_1', entries: entries.slice(0, 20), total: entries.length, pagination: body.pagination })
        case 'result': return Response.json(successResult)
        default: throw new Error(`Unexpected query type: ${body.queryType}`)
      }
    },
  })
  render(<MemoryRouter basename="/next" initialEntries={['/next/console/operations']}><App /></MemoryRouter>)
  const table = await screen.findByRole('table', {}, { timeout: 10_000 })
  const link = within(table).getByRole('link', { name: operations[0].operationType })
  expect(link).toHaveAttribute('href', '/next/console/operations/op_1')
  link.focus()
  expect(link).toHaveFocus()
  const documentLocation = window.location.href
  expect(fireEvent.click(link)).toBe(false)
  expect(await screen.findByRole('heading', { level: 1, name: locale === 'es' ? 'Detalle de operación' : 'Operation detail' }, { timeout: 10_000 })).toBeVisible()
  expect(screen.getByRole('link', { name: locale === 'es' ? 'Volver a operaciones' : 'Back to operations' })).toHaveAttribute('href', '/next/console/operations')
  expect(window.location.href).toBe(documentLocation)
  const bodies = requests.mock.mock.calls.filter(([path]) => path === '/v1/async-operation-query').map(([, init]) => JSON.parse(String(init?.body)))
  expect(bodies).toEqual([listBody(), bodyFor('detail'), bodyFor('logs'), bodyFor('result')])
}, 15_000)

function CurrentLocation() {
  const { pathname } = useLocation()
  return <output aria-label="Current location">{pathname}</output>
}

test.each(['/', '/next'])('401 refresh uses the shared shell and preserves the operations intent at basename %s', async (basename) => {
  const session = login(['platform_auditor'])
  requests = strictFetch({
    [`GET ${tenantUrl}`]: { items: [] },
    'POST /v1/auth/login-sessions/synthetic-session/refresh': session,
    'POST /v1/async-operation-query': () => Response.json({ code: 'HTTP_401', message: 'Synthetic unauthorized query' }, { status: 401 }),
  })
  const path = `${basename === '/' ? '' : basename}/console/operations`
  render(<MemoryRouter basename={basename} initialEntries={[path]}><CurrentLocation /><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Acceso' })).toBeVisible()
  expect(screen.getByLabelText('Current location')).toHaveTextContent('/login')
  await waitFor(() => expect(JSON.parse(sessionStorage.getItem('in-falcone.console-protected-route')!)).toBe(path))
  expect(requests.mock.mock.calls.filter(([url]) => url === '/v1/auth/login-sessions/synthetic-session/refresh')).toHaveLength(1)
  const queries = requests.mock.mock.calls.filter(([url]) => url === '/v1/async-operation-query').map(([, init]) => JSON.parse(String(init?.body)))
  expect(queries).toEqual([listBody(), listBody()])
})
