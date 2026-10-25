import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { App } from '../src/App'
import { login, strictFetch, tenantUrl } from './shell-support'
let requests: ReturnType<typeof strictFetch>
beforeEach(() => { login(); requests = strictFetch({ [`GET ${tenantUrl}`]: { items: [] } }) })
afterEach(() => requests.verify())

test.runIf(process.env.SHELL_TEST_FIXTURES === 'true')('a render failure leaves translated 500 and navigation without exception text', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  render(<MemoryRouter initialEntries={['/console/__fixture/throw']}><App /></MemoryRouter>)
  expect((await screen.findAllByText('500', { exact: true }))[0]).toBeVisible()
  expect(document.body).not.toHaveTextContent(/req_8f2c41d07a9b|503|acme-web/)
  expect(screen.getByRole('navigation', { name: 'Navegación de consola' })).toBeVisible()
  expect(document.body).not.toHaveTextContent('synthetic-render-failure')
})

test.runIf(process.env.SHELL_TEST_FIXTURES === 'true').each(['link', 'button'] as const)('pending lazy fixture navigation works through a %s', async (role) => {
  render(<MemoryRouter initialEntries={['/console/__fixture/home']}><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Prueba de navegación' })
  fireEvent.click(screen.getByRole(role, { name: role === 'link' ? 'Enlace diferido' : 'Navegar diferido' }))
  expect(await screen.findByRole('heading', { name: 'Destino diferido' })).toBeVisible()
  expect(screen.queryByText('500', { exact: true })).not.toBeInTheDocument()
})
