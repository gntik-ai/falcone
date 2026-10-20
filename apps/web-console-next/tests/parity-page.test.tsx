import { fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import PageEndpoint from '../src/shell/fixtures/PageEndpoint'
import { createParityNetwork } from './parity/network'
import { login, renderWithSession, strictFetch } from './shell-support'

let requests: ReturnType<typeof strictFetch>
afterEach(() => requests?.verify())

test.each(['workspace_admin', 'workspace_viewer'] as const)('a registered page shows loading, error and retry data for %s', async (role) => {
  login([role])
  const network = createParityNetwork(role)
  network.registerEndpoints({ page: { method: 'GET', path: '/v1/synthetic-page', fixtures: { success: { title: 'Synthetic page data' } } } })
  network.setVariants({ page: { delayMs: 50, sequence: ['500', 'success'] } })
  requests = strictFetch({ 'GET /v1/synthetic-page': async () => {
    const response = await network.respond('GET', '/v1/synthetic-page')
    return Response.json(response!.body, { status: response!.status })
  } })
  renderWithSession(<PageEndpoint />)
  expect(screen.getByRole('heading', { name: 'Cargando' })).toBeVisible()
  expect(await screen.findByRole('heading', { name: 'Error del servidor' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
  expect(screen.getByRole('heading', { name: 'Cargando' })).toBeVisible()
  expect(await screen.findByRole('heading', { name: 'Synthetic page data' })).toBeVisible()
  expect(screen.getByText(role)).toBeVisible()
  expect(requests.mock).toHaveBeenCalledTimes(2)
})
