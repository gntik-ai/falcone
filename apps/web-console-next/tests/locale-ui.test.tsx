import { login, strictFetch } from './shell-support'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { App } from '../src/App'
import { changeLocale } from '../src/i18n'

test.each([
  ['es', 'Acerca de', 'Consola', 'Bienvenida', 'Esta página estará disponible próximamente.'],
  ['en', 'About', 'Console', 'Welcome', 'This page will be available soon.']
] as const)('shell and lazy welcome copy render in %s', async (locale, about, consoleName, title, body) => {
  await changeLocale(locale)
  render(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByText(about)).toBeVisible()
  expect(screen.getByRole('img', { name: consoleName })).toBeVisible()
  expect(await screen.findByRole('heading', { name: title })).toBeVisible()
  expect(screen.getByText(body)).toBeVisible()
})

test('user menu changes the shell and route copy without navigation', async () => {
  render(<MemoryRouter initialEntries={['/console/overview']}><App /></MemoryRouter>)
  expect(localStorage.getItem('falcone-next-locale')).toBeNull()
  expect(await screen.findByRole('heading', { name: 'Resumen' })).toBeVisible()
  expect(screen.getByRole('navigation', { name: 'Ruta de navegación' })).toBeVisible()
  expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Menú de usuario' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Idioma' }), { target: { value: 'en' } })
  expect(await screen.findByRole('heading', { name: 'Overview' })).toBeVisible()
  expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
  expect(screen.queryByRole('navigation', { name: 'Ruta de navegación' })).not.toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'About' })).toBeVisible()
  expect(document.documentElement.lang).toBe('en')
  expect(localStorage.getItem('falcone-next-locale')).toBe('en')
})

test('settings switch changes both controls', async () => {
  render(<MemoryRouter initialEntries={['/console/settings']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Ajustes de consola' })).toBeVisible()
  fireEvent.click(screen.getByRole('combobox', { name: 'Idioma de la interfaz' }))
  const option = within(await screen.findByRole('listbox')).getByRole('option', { name: 'Inglés' })
  fireEvent.pointerDown(option)
  fireEvent.click(option)
  expect(await screen.findByRole('heading', { name: 'Console settings' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
  expect(screen.getByRole('combobox', { name: 'Interface language' })).toBeVisible()
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Language', hidden: true })).toHaveValue('en'))
})

test.each([['es', 'Página no encontrada'], ['en', 'Page not found']] as const)('unknown routes render localized 404 in %s', async (locale, title) => {
  await changeLocale(locale)
  render(<MemoryRouter initialEntries={['/missing']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: title })).toBeVisible()
})

let requests: ReturnType<typeof strictFetch>
beforeEach(() => { login(['tenant_owner']); requests = strictFetch({}) })
afterEach(() => requests.verify())
